const $ = (selector) => document.querySelector(selector);
const loginPanel = $('#login-panel');
const appPanel = $('#staff-app');
const loginError = $('#login-error');
const loginButton = $('#login-button');
const orderDialog = $('#staff-order-dialog');
const paymentDialog = $('#payment-dialog');
const menuItemDialog = $('#menu-item-dialog');
const menuItemForm = $('#menu-item-form');
const tableQrDialog = $('#table-qr-dialog');
const money = new Intl.NumberFormat('es-NI', { style: 'currency', currency: 'NIO' });
const statusLabels = { recibido: 'Recibido', en_preparacion: 'En preparación', listo: 'Listo', entregado: 'Entregado' };
const nextStep = { recibido: ['en_preparacion', 'Iniciar preparación'], en_preparacion: ['listo', 'Marcar como listo'], listo: ['entregado', 'Confirmar entrega'] };

let services;
let staffUser;
let orders = [];
let currentFilter = 'activas';
let selectedOrderId = null;
let unsubscribeOrders = null;
let unsubscribeVisits = null;
let unsubscribeRequests = null;
let unsubscribeTables = null;
let unsubscribeClosedVisits = null;
let unsubscribeMenuItems = null;
let activeVisits = [];
let tableDocs = [];
let closedVisits = [];
let assistanceRequests = [];
let reminderTimer = null;
let firstRequestSnapshot = true;
let soundsEnabled = localStorage.getItem('mesaexpress-sounds-enabled') !== 'false';
let audioContext = null;
let paymentVisitId = null;
let paymentOperationId = null;
let pendingMenuItemId = null;
let editingMenuItemId = null;
let menuItems = [];
let generatedTableLink = '';
let qrGeneratorPromise = null;
const newRequestIds = new Set();
const knownRequestStatuses = new Map();
let authChangeVersion = 0;
let firstSnapshot = true;
let inFlightOrderId = null;
const newOrderIds = new Set();
const expiredNewOrderTimers = new Map();

function formatCents(value) {
  const cents = Number(value);
  return Number.isSafeInteger(cents) ? money.format(cents / 100) : money.format(0);
}

function orderTime(timestamp) {
  if (!timestamp?.toDate) return 'Hora pendiente';
  return new Intl.DateTimeFormat('es-NI', { hour: '2-digit', minute: '2-digit' }).format(timestamp.toDate());
}

function setFeedback(title, detail, error = false) {
  const feedback = $('#orders-feedback');
  feedback.hidden = false;
  feedback.classList.toggle('staff-feedback-error', error);
  const strong = document.createElement('strong'); strong.textContent = title;
  const paragraph = document.createElement('p'); paragraph.textContent = detail;
  const copy = document.createElement('div'); copy.append(strong, paragraph);
  feedback.replaceChildren(error ? Object.assign(document.createElement('span'), { className: 'feedback-symbol', textContent: '!' }) : Object.assign(document.createElement('span'), { className: 'staff-spinner' }), copy);
}

function showLogin(message = '') {
  loginPanel.hidden = false;
  appPanel.hidden = true;
  loginError.textContent = message;
}

function showDashboard() {
  loginPanel.hidden = true;
  appPanel.hidden = false;
  $('#staff-welcome').textContent = staffUser?.displayName ? `Sesión activa · ${staffUser.displayName}` : 'Sesión de personal autorizada';
}

function isVisible(order) {
  return currentFilter === 'activas' ? order.status !== 'entregado' : order.status === currentFilter;
}

function timestampDate(value) { return value?.toDate ? value.toDate() : null; }

function normalizedTableId(value) {
  const raw = String(value ?? '');
  return /^\d{1,3}$/.test(raw) ? raw.padStart(2, '0') : raw;
}

function nextAvailableTableNumber(additionalTaken = []) {
  const taken = new Set(tableDocs.map((table) => Number(table.number ?? table.id)));
  additionalTaken.forEach((number) => taken.add(Number(number)));
  for (let number = 1; number <= 999; number += 1) {
    if (!taken.has(number)) return number;
  }
  return null;
}

function suggestTableNumber(additionalTaken = []) {
  const input = $('#new-table-number');
  if (!input) return;
  const previousSuggestion = input.dataset.suggestion ?? '';
  if (input.value && input.value !== previousSuggestion) return;
  const next = nextAvailableTableNumber(additionalTaken);
  input.value = next === null ? '' : String(next);
  input.dataset.suggestion = input.value;
  input.placeholder = next === null ? 'No hay números libres' : 'Ej. 4';
}

function staffNotice(message, kind = 'order') {
  const notice = $('#staff-notification');
  notice.hidden = false; notice.className = `staff-notification notification-${kind}`; notice.textContent = message;
  if (soundsEnabled && audioContext && ['order', 'request'].includes(kind)) {
    const now = audioContext.currentTime;
    const playTone = (frequency, offset, length) => {
      const oscillator = audioContext.createOscillator(); const gain = audioContext.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = frequency; gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, now + offset + 0.015); gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + length);
      oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.start(now + offset); oscillator.stop(now + offset + length + 0.02);
    };
    if (kind === 'request') { playTone(880, 0, 0.12); playTone(587, 0.16, 0.18); }
    else playTone(660, 0, 0.22);
  }
}

function ordersForVisit(visit) {
  const visitStartedAt = timestampDate(visit.startedAt)?.getTime();
  return orders.filter((order) => {
    // A known visitId is authoritative. Only legacy orders without one may
    // use table/time matching; otherwise an earlier visit can leak into this bill.
    if (typeof order.visitId === 'string' && order.visitId) return order.visitId === visit.id;
    if (normalizedTableId(order.tableId) !== normalizedTableId(visit.tableId)) return false;
    const orderCreatedAt = timestampDate(order.createdAt)?.getTime();
    return visitStartedAt !== undefined && orderCreatedAt !== undefined && orderCreatedAt >= visitStartedAt;
  });
}

function visitBalance(visit) {
  const ordersDue = ordersForVisit(visit).filter((order) => order.paymentStatus !== 'paid')
    .reduce((sum, order) => sum + (Number(order.totalCents) || 0), 0);
  return Math.max(Number(visit.balanceDueCents) || 0, ordersDue);
}

function visitTotal(visit) {
  const ordersTotal = ordersForVisit(visit).reduce((sum, order) => sum + (Number(order.totalCents) || 0), 0);
  return Math.max(Number(visit.totalCents) || 0, ordersTotal);
}

function isUnresolvedBillRequest(item) {
  return item.type === 'bill' && item.status === 'attended' && !item.resolvedByPaymentId;
}

function belongsToVisit(item, visit) {
  if (typeof item.visitId === 'string' && item.visitId) return item.visitId === visit.id;
  return normalizedTableId(item.tableId) === normalizedTableId(visit.tableId);
}

function needsStaffAttention(item) {
  return item.status === 'pending' || isUnresolvedBillRequest(item);
}

function openMenuItemForm(item = null) {
  menuItemForm.reset();
  editingMenuItemId = item?.id ?? null;
  pendingMenuItemId = null;
  $('#menu-item-title').textContent = item ? 'Editar platillo' : 'Agregar platillo';
  $('#save-menu-item').textContent = item ? 'Guardar cambios' : 'Guardar platillo';
  $('#menu-item-feedback').textContent = '';
  $('#menu-name').value = item?.name ?? '';
  $('#menu-description').value = item?.description ?? '';
  $('#menu-category').value = item?.category ?? '';
  const cents = Number(item?.priceCents ?? Math.round(Number(item?.price ?? 0) * 100));
  $('#menu-price').value = item ? (cents / 100).toFixed(2) : '';
  $('#menu-options').value = (item?.customizationOptions ?? []).flatMap((group) => group.options ?? []).join(', ');
  $('#menu-image').value = item?.imageUrl ?? '';
  $('#menu-available').checked = item ? item.available === true : true;
  menuItemDialog.showModal();
}

function renderMenuItems() {
  const container = $('#staff-menu-items');
  const queryText = $('#menu-search').value.trim().toLocaleLowerCase('es');
  const availability = $('#menu-availability-filter').value;
  const filtered = menuItems.filter((item) => {
    const matchesText = `${item.name ?? ''} ${item.category ?? ''} ${item.description ?? ''}`.toLocaleLowerCase('es').includes(queryText);
    return matchesText && (availability === 'all' || (availability === 'available' ? item.available === true : item.available !== true));
  });
  container.replaceChildren();
  $('#menu-feedback').hidden = filtered.length > 0;
  if (!filtered.length) {
    const title = document.createElement('strong'); title.textContent = menuItems.length ? 'No hay platillos que coincidan' : 'Todavía no hay platillos';
    const copy = document.createElement('p'); copy.textContent = menuItems.length ? 'Prueba otra búsqueda o cambia el filtro.' : 'Agrega el primer platillo para que aparezca en el menú.';
    $('#menu-feedback').replaceChildren(title, copy);
    return;
  }
  filtered.forEach((item) => {
    const card = document.createElement('article'); card.className = 'staff-menu-card';
    const top = document.createElement('div'); top.className = 'staff-menu-card-top';
    const titleWrap = document.createElement('div');
    const title = document.createElement('h3'); title.textContent = item.name || 'Platillo';
    const category = document.createElement('p'); category.className = 'staff-menu-category'; category.textContent = item.category || 'Sin categoría';
    titleWrap.append(title, category);
    const state = document.createElement('span'); state.className = `menu-availability-badge ${item.available === true ? 'is-available' : 'is-unavailable'}`; state.textContent = item.available === true ? 'Disponible' : 'Oculto';
    top.append(titleWrap, state);
    const description = document.createElement('p'); description.className = 'staff-menu-description'; description.textContent = item.description || 'Sin descripción';
    const price = document.createElement('strong'); price.className = 'staff-menu-price'; price.textContent = formatCents(Number.isSafeInteger(item.priceCents) ? item.priceCents : Math.round(Number(item.price ?? 0) * 100));
    const actions = document.createElement('div'); actions.className = 'staff-menu-actions';
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'staff-detail-button'; edit.textContent = 'Editar'; edit.addEventListener('click', () => openMenuItemForm(item));
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'staff-detail-button menu-delete-button'; remove.textContent = 'Eliminar';
    remove.addEventListener('click', async () => {
      if (!window.confirm(`¿Eliminar “${item.name}” del menú?`)) return;
      remove.disabled = true; remove.textContent = 'Eliminando…';
      try {
        const { deleteDoc, doc } = services.firestore;
        await deleteDoc(doc(services.db, 'platillos', item.id));
        staffNotice('Platillo eliminado del menú.', 'success');
      }
      catch (error) { console.error('No se pudo eliminar el platillo.', error); staffNotice(error?.message ?? 'No se pudo eliminar el platillo.', 'error'); remove.disabled = false; remove.textContent = 'Eliminar'; }
    });
    actions.append(edit, remove); card.append(top, description, price, actions); container.append(card);
  });
}

function subscribeMenuItems() {
  unsubscribeMenuItems?.();
  const { collection, onSnapshot } = services.firestore;
  unsubscribeMenuItems = onSnapshot(collection(services.db, 'platillos'), (snapshot) => {
    menuItems = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'es'));
    renderMenuItems();
  }, (error) => {
    console.error('No se pudieron cargar los platillos.', error);
    $('#menu-feedback').hidden = false; $('#menu-feedback').textContent = 'No se pudieron cargar los platillos. Revisa las reglas y la autorización de personal.';
  });
}

async function enableSounds() {
  if (soundsEnabled) {
    soundsEnabled = false; localStorage.setItem('mesaexpress-sounds-enabled', 'false'); updateSoundControl(); return;
  }
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Audio no compatible');
    audioContext ??= new AudioContextClass();
    await audioContext.resume(); soundsEnabled = true; localStorage.setItem('mesaexpress-sounds-enabled', 'true'); updateSoundControl();
  } catch (error) {
    console.error('No se pudieron habilitar los sonidos.', error);
    soundsEnabled = false; localStorage.setItem('mesaexpress-sounds-enabled', 'false'); updateSoundControl('Audio no disponible');
  }
}

function updateSoundControl(message = '') {
  const button = $('#enable-sounds');
  button.classList.toggle('sound-toggle-on', soundsEnabled);
  button.classList.toggle('sound-toggle-off', !soundsEnabled);
  button.setAttribute('aria-pressed', String(soundsEnabled));
  const title = message || (soundsEnabled ? 'Sonido activado' : 'Sonido desactivado');
  const titleElement = button.querySelector('strong');
  const detailElement = button.querySelector('small');
  if (titleElement) titleElement.textContent = title;
  if (detailElement) detailElement.textContent = soundsEnabled ? 'Avisos de pedidos y solicitudes' : 'Haz clic para volver a activarlo';
  if (!titleElement) button.textContent = title;
}

async function unlockDefaultSound() {
  if (!soundsEnabled || audioContext?.state === 'running') return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Audio no compatible');
    audioContext ??= new AudioContextClass();
    await audioContext.resume();
  } catch (error) {
    console.info('El navegador no habilitó el audio todavía.', error);
  }
}

function renderActiveTables() {
  const container = $('#active-tables'); container.replaceChildren();
  const now = Date.now();
  const pending = assistanceRequests.filter(needsStaffAttention);
  const reminders = activeVisits.filter((visit) => {
    const delivered = timestampDate(visit.lastOrderDeliveredAt);
    return delivered && now - delivered.getTime() >= 30 * 60 * 1000
      && !pending.some((item) => belongsToVisit(item, visit) && item.type === 'bill')
      && timestampDate(visit.reminderAttendedFor)?.getTime() !== delivered.getTime();
  });
  $('#table-reminder-count').textContent = String(reminders.length); $('#table-reminder-count').hidden = !reminders.length;
  if (!tableDocs.length) { $('#tables-feedback').hidden = false; $('#tables-feedback').textContent = 'Todavía no hay mesas. Usa «Agregar una mesa nueva» al final de esta sección para empezar.'; renderClosedVisits(); return; }
  $('#tables-feedback').hidden = true;
  tableDocs.slice().sort((a, b) => String(a.number ?? a.id).localeCompare(String(b.number ?? b.id), 'es')).forEach((tableDoc) => {
    const tableId = tableDoc.id;
    const tableVisits = activeVisits
      .filter((item) => normalizedTableId(item.tableId) === normalizedTableId(tableId))
      .sort((a, b) => (timestampDate(b.startedAt)?.getTime() ?? 0) - (timestampDate(a.startedAt)?.getTime() ?? 0));
    const visit = activeVisits.find((item) => item.id === tableDoc.activeVisitId) ?? tableVisits[0];
    const qrButton = document.createElement('button'); qrButton.type = 'button'; qrButton.className = 'staff-detail-button'; qrButton.dataset.tableQr = tableId; qrButton.textContent = 'Ver / imprimir QR'; qrButton.addEventListener('click', () => openTableQr(tableDoc));
    if (!visit) {
      const card = document.createElement('article'); card.className = 'active-table-card inactive-table-card';
      const heading = document.createElement('div'); heading.className = 'active-table-heading';
      const name = document.createElement('h3'); name.textContent = `Mesa ${String(tableDoc.number ?? tableId).padStart(2, '0')}`;
      const hasQr = /^[a-f0-9]{64}$/i.test(String(tableDoc.qrTokenHash ?? ''))
        && typeof tableDoc.qrToken === 'string' && tableDoc.qrToken.length >= 32;
      const state = document.createElement('span'); state.className = 'table-closed-state'; state.textContent = tableDoc.enabled !== true ? 'Deshabilitada' : hasQr ? 'Disponible' : 'QR pendiente'; heading.append(name, state); card.append(heading);
      card.append(qrButton);
      if (tableDoc.enabled === true && !hasQr) { const hint = document.createElement('p'); hint.className = 'request-time'; hint.textContent = 'Esta mesa necesita un QR nuevo antes de recibir pedidos.'; card.append(hint); }
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'staff-detail-button table-delete-button'; remove.textContent = 'Eliminar mesa';
      remove.addEventListener('click', async () => {
        const label = `Mesa ${String(tableDoc.number ?? tableId).padStart(2, '0')}`;
        if (!window.confirm(`¿Eliminar ${label}? Se conservará su historial de pedidos y visitas.`)) return;
        remove.disabled = true;
        try {
          const { deleteDoc, doc, writeBatch } = services.firestore;
          const batch = writeBatch(services.db);
          batch.delete(doc(services.db, 'tables', tableId));
          if (typeof tableDoc.qrToken === 'string' && tableDoc.qrToken) batch.delete(doc(services.db, 'tableAccess', tableDoc.qrToken));
          await batch.commit();
          staffNotice(`${label} eliminada.`, 'success');
        } catch (error) { console.error('No se pudo eliminar la mesa.', error); staffNotice(error?.message ?? 'No se pudo eliminar la mesa.', 'error'); remove.disabled = false; }
      });
      card.append(remove);
      container.append(card); return;
    }
    const visitOrders = ordersForVisit(visit);
    const delivered = timestampDate(visit.lastOrderDeliveredAt);
    const overdue = reminders.some((item) => item.id === visit.id);
    const bill = pending.find((item) => belongsToVisit(item, visit) && item.type === 'bill');
    const card = document.createElement('article'); card.className = `active-table-card${overdue ? ' table-reminder-card' : ''}`;
    const heading = document.createElement('div'); heading.className = 'active-table-heading';
    const name = document.createElement('h3'); name.textContent = `Mesa ${String(visit.tableId ?? '—').padStart(2, '0')}`;
    const state = document.createElement('span'); state.className = 'table-open-state'; state.textContent = 'Cuenta abierta'; heading.append(name, state); card.append(heading);
    card.append(qrButton);
    const details = document.createElement('div'); details.className = 'active-table-details';
    [['Pedidos', String(visitOrders.length)], ['Acumulado', formatCents(visitTotal(visit))], ['Saldo pendiente', formatCents(visitBalance(visit))], ['Última entrega', delivered ? orderTime(visit.lastOrderDeliveredAt) : 'Sin entregas']].forEach(([label, value]) => {
      const row = document.createElement('p'); const key = document.createElement('span'); key.textContent = label; const val = document.createElement('strong'); val.textContent = value; row.append(key, val); details.append(row);
    });
    if (bill) { const marker = document.createElement('p'); marker.className = 'table-bill-pending'; marker.textContent = 'Cuenta solicitada · pendiente'; details.append(marker); }
    card.append(details);
    if (overdue) {
      const reminder = document.createElement('p'); reminder.className = 'table-reminder-copy'; reminder.textContent = `Revisar Mesa ${String(visit.tableId).padStart(2, '0')}: han transcurrido 30 minutos desde la última entrega.`;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'staff-detail-button'; button.textContent = 'Marcar recordatorio atendido';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const { doc, serverTimestamp, updateDoc } = services.firestore;
          await updateDoc(doc(services.db, 'visits', visit.id), { reminderAttendedFor: visit.lastOrderDeliveredAt, reminderAttendedAt: serverTimestamp(), reminderAttendedBy: staffUser.uid, updatedAt: serverTimestamp() });
        } catch (error) { console.error(error); staffNotice(error?.message ?? 'No se pudo guardar el recordatorio atendido.', 'error'); button.disabled = false; }
      });
      card.append(reminder, button);
    }
    const pay = document.createElement('button'); pay.type = 'button'; pay.className = 'staff-primary payment-open-button'; pay.disabled = visitBalance(visit) <= 0; pay.textContent = pay.disabled ? 'Sin saldo pendiente' : 'Registrar pago y cerrar cuenta';
    pay.addEventListener('click', () => openPayment(visit.id)); card.append(pay);
    container.append(card);
  });
  renderClosedVisits();
}

function renderClosedVisits() {
  const container = $('#closed-visits'); container.replaceChildren();
  closedVisits.slice().sort((a, b) => (timestampDate(b.closedAt)?.getTime() ?? 0) - (timestampDate(a.closedAt)?.getTime() ?? 0)).slice(0, 8).forEach((visit) => {
    const card = document.createElement('article'); card.className = 'closed-visit-card';
    const name = document.createElement('strong'); name.textContent = `Mesa ${String(visit.tableId ?? '—').padStart(2, '0')}`;
    const total = document.createElement('span'); total.textContent = `Pagado: ${formatCents(visit.amountPaidCents)}`;
    const time = document.createElement('time'); time.textContent = orderTime(visit.closedAt);
    card.append(name, total, time); container.append(card);
  });
  if (!container.childElementCount) { const empty = document.createElement('p'); empty.className = 'closed-visits-empty'; empty.textContent = 'Las visitas cerradas aparecerán aquí.'; container.append(empty); }
}

function openPayment(visitId) {
  const visit = activeVisits.find((item) => item.id === visitId); if (!visit) return;
  if (paymentVisitId !== visitId || !paymentOperationId) paymentOperationId = crypto.randomUUID();
  paymentVisitId = visitId;
  $('#payment-summary').textContent = `Mesa ${String(visit.tableId).padStart(2, '0')} · saldo a cobrar ${formatCents(visitBalance(visit))}. Al confirmar, se registra el pago completo y se cierra la cuenta.`;
  $('#payment-feedback').textContent = ''; $('#record-payment').disabled = false;
  paymentDialog.showModal();
}

async function submitPayment() {
  if (!paymentVisitId) return;
  const button = $('#record-payment'); button.disabled = true; button.textContent = 'Registrando…';
  try {
    const visit = activeVisits.find((item) => item.id === paymentVisitId);
    if (!visit) throw new Error('La visita ya no está activa. Actualiza la pantalla e inténtalo de nuevo.');
    const { collection, doc, getDocs, query, runTransaction, serverTimestamp, where } = services.firestore;
    const visitRef = doc(services.db, 'visits', visit.id);
    const paymentRef = doc(services.db, 'payments', paymentOperationId);
    const ordersQuery = query(collection(services.db, 'orders'), where('visitId', '==', visit.id));
    const requestsQuery = query(collection(services.db, 'assistanceRequests'), where('tableId', '==', visit.tableId));
    const [orderQuerySnapshot, requestQuerySnapshot] = await Promise.all([getDocs(ordersQuery), getDocs(requestsQuery)]);
    const orderRefs = orderQuerySnapshot.docs.map((item) => item.ref);
    const requestRefs = requestQuerySnapshot.docs.map((item) => item.ref);
    const table = tableDocs.find((item) => normalizedTableId(item.id) === normalizedTableId(visit.tableId));
    const accessRef = table?.qrToken ? doc(services.db, 'tableAccess', table.qrToken) : null;
    const tableRef = table ? doc(services.db, 'tables', table.id) : null;
    await runTransaction(services.db, async (transaction) => {
      const visitSnapshot = await transaction.get(visitRef);
      const paymentSnapshot = await transaction.get(paymentRef);
      const orderSnapshots = await Promise.all(orderRefs.map((orderRef) => transaction.get(orderRef)));
      const requestSnapshots = await Promise.all(requestRefs.map((requestRef) => transaction.get(requestRef)));
      const accessSnapshot = accessRef ? await transaction.get(accessRef) : null;
      const tableSnapshot = tableRef ? await transaction.get(tableRef) : null;
      if (paymentSnapshot.exists()) {
        if (paymentSnapshot.data().visitId === visit.id) return;
        throw new Error('El identificador del pago ya está asociado a otra cuenta.');
      }
      if (!visitSnapshot.exists() || visitSnapshot.data().status !== 'open') throw new Error('La cuenta de esta mesa ya está cerrada.');
      const ordersToPay = orderSnapshots.filter((item) => item.exists() && item.data().paymentStatus !== 'paid');
      const undelivered = ordersToPay.filter((item) => item.data().status !== 'entregado');
      if (undelivered.length) throw new Error(`No se puede cerrar la cuenta: faltan pedidos por entregar (${undelivered.map((item) => `#${item.data().orderNumber ?? item.id.slice(0, 6)}`).join(', ')}).`);
      const balanceDueCents = ordersToPay.reduce((sum, item) => sum + (Number(item.data().totalCents) || 0), 0);
      if (!Number.isSafeInteger(balanceDueCents) || balanceDueCents <= 0) throw new Error('La visita no tiene un saldo pendiente que cobrar.');
      const now = serverTimestamp();
      transaction.set(paymentRef, {
        visitId: visit.id, tableId: visit.tableId, amountCents: balanceDueCents,
        method: $('#payment-method').value, status: 'recorded', createdAt: now,
        recordedBy: staffUser.uid, recordedByEmail: staffUser.email ?? null,
      });
      const previousPaid = Number(visitSnapshot.data().amountPaidCents ?? 0);
      transaction.update(visitRef, {
        totalCents: Math.max(Number(visitSnapshot.data().totalCents ?? 0), previousPaid + balanceDueCents),
        amountPaidCents: previousPaid + balanceDueCents, balanceDueCents: 0,
        paymentStatus: 'paid', status: 'closed', closedAt: now, updatedAt: now, closedBy: staffUser.uid,
      });
      ordersToPay.forEach((item) => transaction.update(item.ref, { paymentStatus: 'paid', paymentId: paymentOperationId, paidAt: now, updatedAt: now }));
      requestSnapshots.filter((item) => item.exists()
        && (!item.data().visitId || item.data().visitId === visit.id)
        && item.data().type === 'bill'
        && (item.data().status === 'pending' || (item.data().status === 'attended' && !item.data().resolvedByPaymentId)))
        .forEach((item) => transaction.update(item.ref, { status: 'attended', attendedAt: now, attendedBy: staffUser.uid, resolvedByPaymentId: paymentOperationId, updatedAt: now }));
      if (accessSnapshot?.exists() && accessSnapshot.data().activeVisitId === visit.id) transaction.update(accessRef, { activeVisitId: null, updatedAt: now });
      if (tableSnapshot?.exists() && tableSnapshot.data().activeVisitId === visit.id) transaction.update(tableRef, { activeVisitId: null, updatedAt: now });
    });
    paymentDialog.close(); staffNotice('Pago registrado y visita cerrada.', 'success'); paymentVisitId = null; paymentOperationId = null;
  } catch (error) {
    console.error('No se pudo registrar el pago.', error);
    $('#payment-feedback').textContent = error?.message ?? 'No se pudo registrar el pago. Puedes reintentar.';
  } finally { button.disabled = false; button.textContent = 'Registrar pago completo y cerrar cuenta'; }
}

async function submitMenuItem(event) {
  event.preventDefault();
  if (!menuItemForm.reportValidity()) return;
  const button = $('#save-menu-item');
  const price = Number($('#menu-price').value);
  const priceCents = Math.round(price * 100);
  const options = [...new Set($('#menu-options').value.split(',').map((value) => value.trim()).filter(Boolean))];
  if (!Number.isFinite(price) || price <= 0 || !Number.isSafeInteger(priceCents)) {
    $('#menu-item-feedback').textContent = 'Escribe un precio válido en córdobas.'; return;
  }
  if (options.length > 12 || options.some((value) => value.length > 60)) {
    $('#menu-item-feedback').textContent = 'Usa hasta 12 opciones, separadas por comas y de máximo 60 caracteres.'; return;
  }
  pendingMenuItemId ??= crypto.randomUUID();
  button.disabled = true; button.textContent = 'Guardando…'; $('#menu-item-feedback').textContent = '';
  try {
    const payload = { name: $('#menu-name').value.trim(), description: $('#menu-description').value.trim(), category: $('#menu-category').value, priceCents, imageUrl: $('#menu-image').value.trim(), options, available: $('#menu-available').checked };
    const { collection, doc, serverTimestamp, setDoc, updateDoc } = services.firestore;
    const itemData = {
      name: payload.name, description: payload.description, category: payload.category,
      priceCents: payload.priceCents, imageUrl: payload.imageUrl,
      customizationOptions: options.length ? [{ name: 'Personalización', options, required: false }] : [],
      available: payload.available, updatedAt: serverTimestamp(),
    };
    if (editingMenuItemId) {
      await updateDoc(doc(services.db, 'platillos', editingMenuItemId), itemData);
    } else {
      pendingMenuItemId ??= crypto.randomUUID();
      await setDoc(doc(collection(services.db, 'platillos'), pendingMenuItemId), {
        ...itemData, createdBy: staffUser.uid, createdAt: serverTimestamp(),
      });
    }
    const wasEditing = Boolean(editingMenuItemId);
    menuItemDialog.close(); menuItemForm.reset(); $('#menu-available').checked = true; pendingMenuItemId = null; editingMenuItemId = null;
    staffNotice(wasEditing ? 'Cambios del platillo guardados.' : 'Platillo agregado al menú.', 'success');
  } catch (error) {
    console.error('No se pudo guardar el platillo.', error);
    $('#menu-item-feedback').textContent = error?.message ?? 'No se pudo guardar el platillo. Puedes reintentar.';
  } finally { button.disabled = false; button.textContent = editingMenuItemId ? 'Guardar cambios' : 'Guardar platillo'; }
}

function createQrToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function copyTextToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(value); return true; } catch { /* Use the compatible fallback below. */ }
  }
  const field = document.createElement('textarea');
  field.value = value; field.setAttribute('readonly', '');
  field.style.position = 'fixed'; field.style.opacity = '0'; field.style.pointerEvents = 'none';
  document.body.append(field); field.select(); field.setSelectionRange(0, field.value.length);
  const copied = document.execCommand('copy'); field.remove();
  if (!copied) throw new Error('El navegador no permitió copiar el enlace. Selecciónalo y cópialo manualmente.');
  return true;
}

async function drawTableQr(canvas, link) {
  qrGeneratorPromise ??= import('https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm');
  const qr = await qrGeneratorPromise;
  const drawQr = qr.toCanvas ?? qr.default?.toCanvas;
  if (!drawQr) throw new Error('No se pudo cargar el generador del código QR.');
  await drawQr(canvas, link, { width: 280, margin: 2, errorCorrectionLevel: 'M' });
}

function tableMenuUrl(tableId, token) {
  const url = new URL('./menu.html', window.location.href);
  url.search = '';
  url.searchParams.set('mesa', tableId);
  url.searchParams.set('token', token);
  return url.href;
}

async function showTableQrDialog(label, link) {
  await drawTableQr($('#managed-table-qr-canvas'), link);
  $('#managed-table-qr-title').textContent = `${label} · Código QR`;
  $('#managed-table-qr-url').value = link;
  $('#managed-table-qr-download').onclick = () => {
    const canvas = $('#managed-table-qr-canvas');
    const download = document.createElement('a');
    download.href = canvas.toDataURL('image/png');
    download.download = `${label.toLowerCase().replace(/\s+/g, '-')}-qr.png`;
    download.click();
  };
  $('#managed-table-qr-print').onclick = () => window.print();
  tableQrDialog.showModal();
}

async function openTableQr(tableDoc) {
  const button = document.querySelector(`[data-table-qr="${CSS.escape(tableDoc.id)}"]`);
  if (button) { button.disabled = true; button.textContent = 'Preparando QR…'; }
  try {
    let token = tableDoc.qrToken;
    let tokenChanged = false;
    if (typeof token !== 'string' || token.length < 32) {
      if (!window.confirm(`La Mesa ${String(tableDoc.number ?? tableDoc.id).padStart(2, '0')} no tiene guardado su código QR anterior. Al continuar, los QR impresos antes dejarán de funcionar. ¿Generar uno nuevo?`)) return;
      token = createQrToken();
      tokenChanged = true;
    }
    if (tokenChanged || !tableDoc.qrToken) {
      const { doc, runTransaction, serverTimestamp } = services.firestore;
      const tableRef = doc(services.db, 'tables', tableDoc.id);
      const accessRef = doc(services.db, 'tableAccess', token);
      await runTransaction(services.db, async (transaction) => {
        const currentTable = await transaction.get(tableRef);
        if (!currentTable.exists()) throw new Error('No encontramos esta mesa.');
        const now = serverTimestamp();
        transaction.update(tableRef, { qrToken: token, qrTokenHash: await hashQrToken(token), updatedAt: now });
        transaction.set(accessRef, { tableId: tableDoc.id, activeVisitId: currentTable.data().activeVisitId ?? null, enabled: currentTable.data().enabled === true, updatedAt: now });
      });
    } else {
      const { doc, getDoc, setDoc, serverTimestamp } = services.firestore;
      const accessRef = doc(services.db, 'tableAccess', token);
      const accessSnapshot = await getDoc(accessRef);
      if (!accessSnapshot.exists()) await setDoc(accessRef, {
        tableId: tableDoc.id, activeVisitId: tableDoc.activeVisitId ?? null,
        enabled: tableDoc.enabled === true, updatedAt: serverTimestamp(),
      });
    }
    const link = tableMenuUrl(tableDoc.id, token);
    const label = `Mesa ${String(tableDoc.number ?? tableDoc.id).padStart(2, '0')}`;
    await showTableQrDialog(label, link);
  } catch (error) {
    console.error('No se pudo abrir el QR de la mesa.', error);
    staffNotice(error?.message ?? 'No se pudo generar el código QR.', 'error');
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Ver / imprimir QR'; }
  }
}

async function hashQrToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function submitTableSetup(event) {
  event.preventDefault();
  const form = $('#table-setup-form');
  if (!form.reportValidity()) return;
  const button = $('#create-table-button');
  const feedback = $('#table-setup-feedback');
  const rawNumber = Number($('#new-table-number').value);
  if (!Number.isInteger(rawNumber) || rawNumber < 1 || rawNumber > 999) {
    feedback.textContent = 'El número de mesa debe estar entre 1 y 999.';
    return;
  }
  const tableId = String(rawNumber).padStart(2, '0');
  const { collection, doc, runTransaction, serverTimestamp } = services.firestore;
  const tableRef = doc(collection(services.db, 'tables'), tableId);
  button.disabled = true; button.textContent = 'Creando mesa…'; feedback.textContent = '';
  $('#table-qr-result').hidden = true;
  try {
    const token = createQrToken();
    const qrTokenHash = await hashQrToken(token);
    const accessRef = doc(services.db, 'tableAccess', token);
    const menuUrl = new URL(tableMenuUrl(tableId, token));
    await runTransaction(services.db, async (transaction) => {
      const existing = await transaction.get(tableRef);
      if (existing.exists()) {
        const error = new Error(`La mesa ${tableId} ya existe.`);
        error.code = 'table-already-exists';
        throw error;
      }
      transaction.set(tableRef, {
        number: rawNumber,
        enabled: true,
        activeVisitId: null,
        qrToken: token,
        qrTokenHash,
        createdBy: staffUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      transaction.set(accessRef, { tableId, activeVisitId: null, enabled: true, updatedAt: serverTimestamp() });
    });
    generatedTableLink = menuUrl.href;
    $('#table-qr-title').textContent = `Mesa ${tableId} lista`;
    $('#table-qr-url').value = generatedTableLink;
    $('#open-table-menu').href = generatedTableLink;
    $('#table-qr-result').hidden = false;
      feedback.textContent = 'Mesa creada y guardada en Firebase. Los pedidos podrán llegar al escanear el QR.';
    $('#new-table-number').value = '';
    $('#new-table-number').dataset.suggestion = '';
    suggestTableNumber([rawNumber]);
    try {
      await drawTableQr($('#table-qr-canvas'), generatedTableLink);
    } catch (qrError) {
      console.warn('Se creó la mesa pero no se pudo dibujar el QR.', qrError);
      feedback.textContent = 'Mesa creada. No se pudo generar la imagen QR; puedes copiar el enlace y abrirlo en el dispositivo cliente.';
    }
  } catch (error) {
    console.error('No se pudo preparar la mesa.', error);
    if (error?.code === 'table-already-exists') {
      $('#new-table-number').value = '';
      $('#new-table-number').dataset.suggestion = '';
      suggestTableNumber([rawNumber]);
      feedback.textContent = `${error.message} Actualicé la sugerencia al siguiente número libre.`;
    } else {
      feedback.textContent = error?.message ?? 'No se pudo crear la mesa. Revisa el acceso a Firestore.';
    }
  } finally {
    button.disabled = false; button.innerHTML = 'Crear mesa y QR <span aria-hidden="true">→</span>';
  }
}

function renderAssistanceRequests() {
  const container = $('#staff-requests'); container.replaceChildren();
  const pending = assistanceRequests.filter(needsStaffAttention).sort((a, b) => (timestampDate(a.createdAt)?.getTime() ?? 0) - (timestampDate(b.createdAt)?.getTime() ?? 0));
  $('#request-count').textContent = String(pending.length); $('#request-count').hidden = !pending.length;
  if (!pending.length) { $('#requests-feedback').hidden = false; $('#requests-feedback').textContent = 'No hay solicitudes pendientes.'; return; }
  $('#requests-feedback').hidden = true;
  pending.forEach((item) => {
    const card = document.createElement('article'); card.className = `staff-request-card request-${item.type}${newRequestIds.has(item.id) ? ' staff-request-new' : ''}`;
    const heading = document.createElement('div'); heading.className = 'active-table-heading';
    const name = document.createElement('h3'); name.textContent = `Mesa ${String(item.tableId ?? '—').padStart(2, '0')}`;
    const type = document.createElement('span'); type.className = 'request-type'; type.textContent = item.type === 'bill' ? 'Cuenta' : 'Ayuda'; heading.append(name, type); card.append(heading);
    const time = document.createElement('p'); time.className = 'request-time'; time.textContent = `Solicitada ${orderTime(item.createdAt)}`; card.append(time);
    if (item.type === 'bill') {
      const matchingVisits = activeVisits
        .filter((visit) => normalizedTableId(visit.tableId) === normalizedTableId(item.tableId))
        .sort((a, b) => (timestampDate(b.startedAt)?.getTime() ?? 0) - (timestampDate(a.startedAt)?.getTime() ?? 0));
      const tableVisit = activeVisits.find((visit) => visit.id === item.visitId) ?? matchingVisits[0];
      const requestOrders = tableVisit ? ordersForVisit(tableVisit) : [];
      const tableOrderBalance = requestOrders.filter((order) => order.paymentStatus !== 'paid')
        .reduce((sum, order) => sum + (Number(order.totalCents) || 0), 0);
      const balanceDue = tableVisit ? Math.max(visitBalance(tableVisit), tableOrderBalance) : tableOrderBalance || Number(item.balanceDueCents) || 0;
      const balance = document.createElement('p'); balance.className = 'request-balance'; balance.textContent = `Saldo pendiente: ${formatCents(balanceDue)}`; card.append(balance);
    }
    if (item.type === 'bill') { const note = document.createElement('p'); note.className = 'request-time'; note.textContent = 'Se marcará atendida al registrar el pago y cerrar la cuenta.'; card.append(note); container.append(card); return; }
    const button = document.createElement('button'); button.type = 'button'; button.className = 'staff-primary'; button.textContent = 'Marcar como atendida';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const { doc, serverTimestamp, updateDoc } = services.firestore;
        const now = serverTimestamp();
        await updateDoc(doc(services.db, 'assistanceRequests', item.id), { status: 'attended', attendedAt: now, attendedBy: staffUser.uid, updatedAt: now });
      } catch (error) { console.error(error); button.disabled = false; button.textContent = 'No se pudo atender · reintentar'; }
    });
    card.append(button); container.append(card);
  });
}

function subscribeStaffOperations() {
  const { collection, onSnapshot, query, where } = services.firestore;
  if (unsubscribeVisits) unsubscribeVisits(); if (unsubscribeRequests) unsubscribeRequests();
  if (unsubscribeTables) unsubscribeTables(); if (unsubscribeClosedVisits) unsubscribeClosedVisits();
  firstRequestSnapshot = true; knownRequestStatuses.clear();
  unsubscribeVisits = onSnapshot(query(collection(services.db, 'visits'), where('status', '==', 'open')), (snapshot) => {
    activeVisits = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderActiveTables();
  }, (error) => { console.error('No se pudieron cargar las mesas activas.', error); $('#tables-feedback').textContent = 'No se pudieron cargar las mesas activas.'; });
  unsubscribeRequests = onSnapshot(collection(services.db, 'assistanceRequests'), (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      const item = { id: change.doc.id, ...change.doc.data() };
      const previous = knownRequestStatuses.get(item.id);
      if (!firstRequestSnapshot && item.status === 'pending' && previous !== 'pending') {
        newRequestIds.add(item.id); staffNotice(`Mesa ${String(item.tableId).padStart(2, '0')} solicita ${item.type === 'bill' ? 'la cuenta' : 'ayuda'}.`, 'request');
        setTimeout(() => { newRequestIds.delete(item.id); renderAssistanceRequests(); }, 60000);
      }
      knownRequestStatuses.set(item.id, item.status);
    });
    firstRequestSnapshot = false;
    assistanceRequests = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderAssistanceRequests(); renderActiveTables();
  }, (error) => { console.error('No se pudieron cargar las solicitudes.', error); $('#requests-feedback').textContent = 'No se pudieron cargar las solicitudes.'; });
  unsubscribeTables = onSnapshot(collection(services.db, 'tables'), (snapshot) => {
    tableDocs = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    suggestTableNumber();
    renderActiveTables();
  }, (error) => { console.error('No se pudieron cargar las mesas.', error); $('#tables-feedback').textContent = 'No se pudieron cargar las mesas registradas.'; });
  unsubscribeClosedVisits = onSnapshot(query(collection(services.db, 'visits'), where('status', '==', 'closed')), (snapshot) => {
    closedVisits = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderClosedVisits();
  }, (error) => { console.error('No se pudo cargar el historial de visitas.', error); });
  clearInterval(reminderTimer); reminderTimer = setInterval(renderActiveTables, 30000);
}

function renderOrders() {
  const container = $('#staff-orders');
  const visibleOrders = orders.filter(isVisible);
  $('#active-count').textContent = String(orders.filter((order) => order.status !== 'entregado').length);
  container.replaceChildren();
  if (!visibleOrders.length) {
    $('#orders-feedback').hidden = false;
    const title = currentFilter === 'activas' ? 'Sin órdenes pendientes' : `No hay órdenes en estado «${statusLabels[currentFilter]}»`;
    setFeedback(title, 'Las órdenes nuevas aparecerán aquí en tiempo real.');
    return;
  }
  $('#orders-feedback').hidden = true;
  visibleOrders.forEach((order) => container.append(createOrderCard(order)));
}

function createOrderCard(order) {
  const card = document.createElement('article');
  card.className = `staff-order-card${newOrderIds.has(order.id) ? ' staff-order-new' : ''}`;
  const header = document.createElement('div'); header.className = 'staff-card-head';
  const identity = document.createElement('div');
  const number = document.createElement('p'); number.className = 'staff-order-number'; number.textContent = `Pedido ${order.orderNumber ?? order.id.slice(0, 6).toUpperCase()}`;
  const table = document.createElement('strong'); table.className = 'staff-table-number'; table.textContent = `Mesa ${String(order.tableId ?? '—').padStart(2, '0')}`;
  identity.append(number, table);
  const status = document.createElement('span'); status.className = `staff-status status-${order.status}`; status.textContent = statusLabels[order.status] ?? 'Estado desconocido';
  header.append(identity, status);
  const meta = document.createElement('div'); meta.className = 'staff-card-meta';
  const time = document.createElement('span'); time.textContent = orderTime(order.createdAt);
  const total = document.createElement('span'); total.textContent = formatCents(order.totalCents);
  meta.append(time, total);
  const preview = document.createElement('div'); preview.className = 'staff-card-items';
  (order.items ?? []).slice(0, 3).forEach((item) => {
    const line = document.createElement('p');
    const customization = Object.values(item.customizations ?? {}).join(' · ');
    line.textContent = `${item.quantity} × ${item.name}${customization ? ` · ${customization}` : ''}${item.note ? ` · ${item.note}` : ''}`;
    preview.append(line);
  });
  if ((order.items ?? []).length > 3) {
    const more = document.createElement('p'); more.className = 'staff-more-items'; more.textContent = `y ${(order.items ?? []).length - 3} producto(s) más`;
    preview.append(more);
  }
  const open = document.createElement('button'); open.type = 'button'; open.className = 'staff-detail-button'; open.textContent = 'Ver pedido completo →';
  open.addEventListener('click', () => openOrder(order.id));
  card.append(header, meta, preview);
  const action = nextStep[order.status];
  if (action) {
    const advance = document.createElement('button'); advance.type = 'button'; advance.className = 'staff-primary staff-order-advance';
    advance.disabled = inFlightOrderId === order.id;
    advance.textContent = inFlightOrderId === order.id ? 'Actualizando…' : action[1];
    advance.addEventListener('click', () => changeOrderStatus(order.id, action[0], 'card'));
    card.append(advance);
  }
  card.append(open);
  return card;
}

function openOrder(orderId) {
  selectedOrderId = orderId;
  renderOrderDetails();
  if (!orderDialog.open) orderDialog.showModal();
}

function renderOrderDetails() {
  const order = orders.find((item) => item.id === selectedOrderId);
  if (!order) return;
  const content = $('#order-detail-content'); content.replaceChildren();
  const body = document.createElement('div'); body.className = 'staff-detail-body';
  const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = `MESA ${String(order.tableId ?? '—').padStart(2, '0')} · ${orderTime(order.createdAt)}`;
  const heading = document.createElement('h2'); heading.id = 'detail-order-number'; heading.textContent = `Pedido ${order.orderNumber ?? order.id.slice(0, 6).toUpperCase()}`;
  const status = document.createElement('span'); status.className = `staff-status status-${order.status}`; status.textContent = statusLabels[order.status] ?? 'Estado desconocido';
  const itemHeading = document.createElement('h3'); itemHeading.className = 'detail-section-title'; itemHeading.textContent = 'Productos';
  const list = document.createElement('div'); list.className = 'detail-items';
  (order.items ?? []).forEach((item) => {
    const row = document.createElement('article'); row.className = 'detail-item';
    const itemHead = document.createElement('div'); itemHead.className = 'detail-item-head';
    const name = document.createElement('strong'); name.textContent = `${item.quantity} × ${item.name}`;
    const price = document.createElement('span'); price.textContent = formatCents(item.lineTotalCents);
    itemHead.append(name, price); row.append(itemHead);
    const options = Object.entries(item.customizations ?? {});
    if (options.length) { const custom = document.createElement('p'); custom.className = 'detail-customizations'; custom.textContent = options.map(([key, value]) => `${key}: ${value}`).join(' · '); row.append(custom); }
    if (item.note) { const note = document.createElement('p'); note.className = 'detail-note'; note.textContent = `Nota: ${item.note}`; row.append(note); }
    list.append(row);
  });
  const total = document.createElement('div'); total.className = 'detail-total';
  const makeTotalRow = (label, amount, className = '') => {
    const row = document.createElement('p'); row.className = className;
    const caption = document.createElement('span'); caption.textContent = label;
    const value = document.createElement('strong'); value.textContent = formatCents(amount);
    row.append(caption, value); return row;
  };
  const sub = makeTotalRow('Subtotal', order.subtotalCents);
  const service = makeTotalRow('Servicio', order.serviceChargeCents);
  const due = makeTotalRow('Total', order.totalCents, 'detail-due');
  total.append(sub, service, due);
  const action = nextStep[order.status];
  const error = document.createElement('p'); error.id = 'transition-feedback'; error.className = 'transition-feedback'; error.setAttribute('role', 'status');
  body.append(eyebrow, heading, status, itemHeading, list, total, error);
  if (action) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'staff-primary'; button.disabled = inFlightOrderId === order.id;
    button.textContent = inFlightOrderId === order.id ? 'Actualizando…' : action[1];
    button.addEventListener('click', () => changeOrderStatus(order.id, action[0]));
    body.append(button);
  } else {
    const delivered = document.createElement('p'); delivered.className = 'delivered-message'; delivered.textContent = `Entregado ${orderTime(order.deliveredAt)}`; body.append(delivered);
  }
  content.append(body);
}

async function changeOrderStatus(orderId, nextStatus, source = 'detail') {
  inFlightOrderId = orderId;
  if (source === 'detail') renderOrderDetails();
  else renderOrders();
  try {
    const { doc, serverTimestamp, updateDoc, writeBatch } = services.firestore;
    const timestampField = { en_preparacion: 'preparingAt', listo: 'readyAt', entregado: 'deliveredAt' }[nextStatus];
    const order = orders.find((item) => item.id === orderId);
    const orderRef = doc(services.db, 'orders', orderId);
    const orderUpdate = {
      status: nextStatus,
      [timestampField]: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: staffUser.uid,
    };
    if (nextStatus === 'entregado') {
      const visit = order?.visitId
        ? activeVisits.find((item) => item.id === order.visitId)
        : activeVisits.find((item) => normalizedTableId(item.tableId) === normalizedTableId(order?.tableId));
      if (visit) {
        const batch = writeBatch(services.db);
        batch.update(orderRef, orderUpdate);
        batch.update(doc(services.db, 'visits', visit.id), { lastOrderDeliveredAt: serverTimestamp(), lastOrderDeliveredOrderId: orderId, updatedAt: serverTimestamp() });
        await batch.commit();
      } else await updateDoc(orderRef, orderUpdate);
    } else await updateDoc(orderRef, orderUpdate);
    if (source === 'detail' && orderDialog.open) orderDialog.close();
    staffNotice(`Pedido actualizado · ${statusLabels[nextStatus]}.`, 'success');
  } catch (error) {
    console.error('No se pudo actualizar el estado.', error);
    const copy = error?.code?.includes('permission-denied') ? 'Tu sesión no tiene autorización de personal.' : error?.code?.includes('failed-precondition') ? 'El pedido cambió en otra pantalla. Revisa su estado e inténtalo de nuevo.' : error?.message ?? 'No se pudo actualizar el pedido.';
    if (source === 'detail') {
      const feedback = $('#transition-feedback'); if (feedback) feedback.textContent = copy;
    } else staffNotice(copy, 'error');
  } finally {
    inFlightOrderId = null;
    if (source === 'detail') renderOrderDetails();
    else renderOrders();
  }
}

function subscribeOrders() {
  if (unsubscribeOrders) unsubscribeOrders();
  const { collection, onSnapshot, orderBy, query } = services.firestore;
  const ordersQuery = query(collection(services.db, 'orders'), orderBy('createdAt', 'desc'));
  firstSnapshot = true;
  unsubscribeOrders = onSnapshot(ordersQuery, (snapshot) => {
    if (!firstSnapshot) {
      snapshot.docChanges().filter((change) => change.type === 'added').forEach((change) => {
        newOrderIds.add(change.doc.id);
        const data = change.doc.data();
        staffNotice(`Nuevo pedido · Mesa ${String(data.tableId ?? '—').padStart(2, '0')}`, 'order');
        const timer = setTimeout(() => { newOrderIds.delete(change.doc.id); expiredNewOrderTimers.delete(change.doc.id); renderOrders(); }, 60000);
        expiredNewOrderTimers.set(change.doc.id, timer);
      });
    }
    firstSnapshot = false;
    orders = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
    $('#connection-state').classList.remove('connection-offline');
    $('#connection-state').innerHTML = '<i></i> En vivo';
    renderOrders();
    renderActiveTables();
    if (selectedOrderId) renderOrderDetails();
  }, (error) => {
    console.error('No se pudo recibir el flujo de órdenes.', error);
    $('#connection-state').classList.add('connection-offline');
    $('#connection-state').textContent = 'Sin conexión';
    setFeedback('No se pudo cargar las órdenes', error?.code?.includes('permission-denied') ? 'Revisa la autorización de personal y las reglas de Firestore.' : 'Comprueba la conexión e inténtalo de nuevo.', true);
  });
}

function filterOrders(filter) {
  currentFilter = filter;
  document.querySelectorAll('.filter-chip').forEach((button) => {
    const selected = button.dataset.filter === filter;
    button.classList.toggle('filter-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  renderOrders();
}

function authError(error) {
  if (error?.code === 'auth/invalid-credential' || error?.code === 'auth/wrong-password' || error?.code === 'auth/user-not-found') return 'Correo o contraseña incorrectos.';
  if (error?.code === 'auth/too-many-requests') return 'Demasiados intentos. Espera un momento e inténtalo de nuevo.';
  if (error?.code === 'auth/network-request-failed') return 'No hay conexión. Revisa tu Internet e inténtalo de nuevo.';
  if (error?.code === 'auth/operation-not-allowed') return 'El inicio de sesión por correo y contraseña no está habilitado en Firebase Authentication.';
  return 'No se pudo iniciar sesión. Comprueba tus datos e inténtalo de nuevo.';
}

async function initializeStaff() {
  const [firebase, authApi, firestoreApi] = await Promise.all([
    import('./firebase.js'),
    import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js'),
  ]);
  services = { ...firebase, authApi, firestore: firestoreApi };
  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault(); loginError.textContent = ''; loginButton.disabled = true; loginButton.textContent = 'Iniciando sesión…';
    const email = $('#staff-email').value.trim();
    const password = $('#staff-password').value;
    try { await authApi.signInWithEmailAndPassword(services.auth, email, password); }
    catch (error) { loginError.textContent = authError(error); }
    finally { loginButton.disabled = false; loginButton.innerHTML = 'Iniciar sesión <span aria-hidden="true">→</span>'; }
  });
  $('#sign-out').addEventListener('click', () => services.auth.signOut());
  updateSoundControl();
  $('#enable-sounds').addEventListener('click', enableSounds);
  document.addEventListener('pointerdown', unlockDefaultSound, { once: true });
  document.addEventListener('keydown', unlockDefaultSound, { once: true });
  $('#record-payment').addEventListener('click', submitPayment);
  $('#add-menu-item').addEventListener('click', () => openMenuItemForm());
  $('#menu-search').addEventListener('input', renderMenuItems);
  $('#menu-availability-filter').addEventListener('change', renderMenuItems);
  $('#table-setup-form').addEventListener('submit', submitTableSetup);
  $('#new-table-number').addEventListener('focus', () => suggestTableNumber());
  $('#copy-table-qr-url').addEventListener('click', async () => {
    if (!generatedTableLink) { $('#table-setup-feedback').textContent = 'Primero crea una mesa para generar su enlace.'; return; }
    try { await copyTextToClipboard(generatedTableLink); $('#copy-table-qr-url').textContent = 'Enlace copiado'; }
    catch { $('#table-qr-url').focus(); $('#table-qr-url').select(); $('#table-setup-feedback').textContent = 'Seleccioné el enlace; cópialo con Ctrl+C.'; }
  });
  $('#download-created-table-qr').addEventListener('click', () => {
    const download = document.createElement('a'); download.href = $('#table-qr-canvas').toDataURL('image/png');
    download.download = `${$('#table-qr-title').textContent.toLowerCase().replace(/\s+/g, '-')}-qr.png`; download.click();
  });
  $('#print-created-table-qr').addEventListener('click', async () => {
    if (!generatedTableLink) return;
    try { await showTableQrDialog($('#table-qr-title').textContent.replace(' lista', ''), generatedTableLink); }
    catch (error) { console.error('No se pudo preparar el QR para imprimir.', error); staffNotice('No se pudo preparar el QR para imprimir.', 'error'); }
  });
  $('#managed-table-qr-copy')?.addEventListener('click', async () => {
    try { await copyTextToClipboard($('#managed-table-qr-url').value); staffNotice('Enlace QR copiado.', 'success'); }
    catch { $('#managed-table-qr-url').focus(); $('#managed-table-qr-url').select(); staffNotice('Enlace seleccionado. Cópialo con Ctrl+C.', 'error'); }
  });
  menuItemForm.addEventListener('submit', submitMenuItem);
  menuItemForm.addEventListener('input', () => { pendingMenuItemId = null; });
  menuItemDialog.addEventListener('close', () => { editingMenuItemId = null; pendingMenuItemId = null; });
  window.addEventListener('online', () => { $('#connection-state').classList.remove('connection-offline'); $('#connection-state').innerHTML = '<i></i> En vivo'; });
  window.addEventListener('offline', () => { $('#connection-state').classList.add('connection-offline'); $('#connection-state').textContent = 'Sin conexión'; staffNotice('Sin conexión a Internet. Se reintentará la sincronización.', 'error'); });
  document.querySelectorAll('.filter-chip').forEach((button) => button.addEventListener('click', () => filterOrders(button.dataset.filter)));
  document.querySelectorAll('.staff-tab').forEach((button) => button.addEventListener('click', () => {
    const section = button.dataset.section;
    document.querySelectorAll('.staff-tab').forEach((tab) => { const selected = tab === button; tab.classList.toggle('staff-tab-active', selected); tab.setAttribute('aria-selected', String(selected)); });
    $('.orders-workspace').hidden = section !== 'orders'; $('#tables-workspace').hidden = section !== 'tables'; $('#requests-workspace').hidden = section !== 'requests'; $('#menu-workspace').hidden = section !== 'menu';
    $('#dashboard-title').textContent = ({ orders: 'Órdenes', tables: 'Mesas activas', requests: 'Solicitudes', menu: 'Platillos' })[section];
  }));
  orderDialog.addEventListener('close', () => { selectedOrderId = null; });
  authApi.onAuthStateChanged(services.auth, async (user) => {
    const currentVersion = ++authChangeVersion;
    if (unsubscribeOrders) { unsubscribeOrders(); unsubscribeOrders = null; }
    if (unsubscribeVisits) { unsubscribeVisits(); unsubscribeVisits = null; }
    if (unsubscribeRequests) { unsubscribeRequests(); unsubscribeRequests = null; }
    if (unsubscribeTables) { unsubscribeTables(); unsubscribeTables = null; }
    if (unsubscribeClosedVisits) { unsubscribeClosedVisits(); unsubscribeClosedVisits = null; }
    if (unsubscribeMenuItems) { unsubscribeMenuItems(); unsubscribeMenuItems = null; }
    clearInterval(reminderTimer);
    orders = []; renderOrders();
    if (!user) { staffUser = null; showLogin(loginError.textContent); return; }
    loginError.textContent = '';
    try {
      const profile = await firestoreApi.getDoc(firestoreApi.doc(services.db, 'staffUsers', user.uid));
      if (currentVersion !== authChangeVersion) return;
      const profileData = profile.exists() ? profile.data() : null;
      if (!profileData || profileData.enabled !== true || profileData.role !== 'staff') {
        await authApi.signOut(services.auth);
        showLogin('La cuenta inició sesión, pero todavía no está autorizada como personal. Contacta a quien administra Firebase.');
        return;
      }
      // Keep the Auth UID alongside the Firestore staff profile; profileData itself
      // contains role/enabled but does not inherently contain an `uid` field.
      staffUser = { ...profileData, uid: user.uid }; showDashboard(); subscribeOrders(); subscribeStaffOperations(); subscribeMenuItems();
    } catch (error) {
      if (currentVersion !== authChangeVersion) return;
      console.error('No se pudo validar la autorización de personal.', error);
      await authApi.signOut(services.auth);
      showLogin('No se pudo validar tu acceso. Revisa Firestore y las reglas de seguridad.');
    }
  });
}

document.querySelectorAll('.filter-chip').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.filter === currentFilter)));
initializeStaff().catch((error) => {
  console.error('No se pudo iniciar el panel del personal.', error);
  showLogin(`No se pudo iniciar el panel: ${error?.message ?? 'error desconocido al cargar Firebase o preparar la interfaz.'}`);
});
