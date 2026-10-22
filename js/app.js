const $ = (selector) => document.querySelector(selector);
const productGrid = $('#product-grid');
const categoryList = $('#category-list');
const menuFeedback = $('#menu-feedback');
const productDialog = $('#product-dialog');
const toast = $('#toast');
const params = new URLSearchParams(location.search);
const tableId = params.get('mesa')?.trim() ?? '';
const qrToken = params.get('token')?.trim() ?? '';
const cartStorageKey = `mesaexpress-cart:${/^\d{1,3}$/.test(tableId) ? tableId : 'sin-mesa'}`;
const money = new Intl.NumberFormat('es-NI', { style: 'currency', currency: 'NIO' });

let services;
let products = [];
let activeCategory = 'Todos';
let selectedProduct = null;
let cart = [];
let cartRequestId = null;
let visitId = null;
let serviceChargeBps = 0;
let stopOrders = null;
let stopTableAccess = null;
let trackedVisitId = null;
let stopCustomerRequest = null;
let orderTrackingExpanded = false;
let trackedOrders = [];
let orderTrackingError = false;
let customerRequestId = null;
let customerRequestType = null;
let accountClosedThrough = 0;
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('toast-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('toast-visible'), 2800);
}

function readCart() {
  try {
    const saved = JSON.parse(localStorage.getItem(cartStorageKey) || '{}');
    cart = Array.isArray(saved.cart) ? saved.cart : [];
    cartRequestId = typeof saved.requestId === 'string' ? saved.requestId : null;
    visitId = typeof saved.visitId === 'string' ? saved.visitId : null;
    customerRequestId = typeof saved.assistanceRequestId === 'string' ? saved.assistanceRequestId : null;
    customerRequestType = ['help', 'bill'].includes(saved.requestType) ? saved.requestType : null;
    accountClosedThrough = Number.isFinite(saved.accountClosedThrough) ? saved.accountClosedThrough : 0;
  } catch {
    cart = [];
    cartRequestId = null;
    visitId = null;
    customerRequestId = null;
    customerRequestType = null;
    accountClosedThrough = 0;
  }
}

function saveCart() {
  localStorage.setItem(cartStorageKey, JSON.stringify({ cart, requestId: cartRequestId, visitId, assistanceRequestId: customerRequestId, requestType: customerRequestType, accountClosedThrough }));
}

function isAccountOrder(order) {
  if (order.paymentStatus === 'paid') return false;
  const createdAt = order.createdAt?.toMillis?.() ?? 0;
  return !accountClosedThrough || createdAt > accountClosedThrough;
}

function centsFor(product) {
  if (Number.isSafeInteger(product.priceCents) && product.priceCents >= 0) return product.priceCents;
  const price = Number(product.price);
  return Number.isFinite(price) && price >= 0 ? Math.round(price * 100) : -1;
}

function formatCents(cents) { return money.format(cents / 100); }

function optionGroups(product) {
  const source = Array.isArray(product.customizationOptions) ? product.customizationOptions : [];
  return source.map((group, index) => {
    if (typeof group === 'string') return { name: group, options: [], required: false };
    return {
      name: String(group?.name ?? group?.label ?? `Opción ${index + 1}`),
      options: Array.isArray(group?.options) ? group.options.map((value) => String(typeof value === 'object' ? value.name ?? value.label ?? '' : value)).filter(Boolean) : Array.isArray(group?.values) ? group.values.map(String) : [],
      required: Boolean(group?.required),
    };
  });
}

function renderMenu() {
  const categories = ['Todos', ...new Set(products.map((product) => String(product.category ?? product.categoryId ?? 'Otros')).filter(Boolean))];
  if (!categories.includes(activeCategory)) activeCategory = 'Todos';
  categoryList.replaceChildren();
  categories.forEach((category) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `category-chip${category === activeCategory ? ' category-active' : ''}`;
    button.textContent = category;
    button.setAttribute('aria-pressed', String(category === activeCategory));
    button.addEventListener('click', () => { activeCategory = category; renderMenu(); });
    categoryList.append(button);
  });

  const visible = activeCategory === 'Todos' ? products : products.filter((product) => String(product.category ?? product.categoryId ?? 'Otros') === activeCategory);
  $('#menu-count').textContent = `${visible.length} ${visible.length === 1 ? 'plato' : 'platos'}`;
  productGrid.replaceChildren();
  visible.forEach((product) => productGrid.append(createProductCard(product)));
  syncTableVisitNotice();
  menuFeedback.hidden = products.length > 0;
  if (!products.length) {
    menuFeedback.classList.add('feedback-empty');
    menuFeedback.innerHTML = '<span class="empty-icon" aria-hidden="true">✳</span><div><strong>El menú se está preparando</strong><p>Cuando el restaurante publique sus platos, aparecerán aquí.</p></div>';
  }
}

function createProductCard(product) {
  const card = document.createElement('article');
  card.className = 'product-card';
  const visual = document.createElement('div');
  visual.className = 'product-visual';
  const imageUrl = typeof product.imageUrl === 'string' && /^https:\/\//i.test(product.imageUrl) ? product.imageUrl : '';
  if (imageUrl) {
    const img = document.createElement('img');
    img.src = imageUrl; img.alt = ''; img.loading = 'lazy';
    img.addEventListener('error', () => { visual.classList.add('visual-fallback'); img.remove(); });
    visual.append(img);
  } else {
    visual.classList.add('visual-fallback');
    const mark = document.createElement('span'); mark.textContent = '✳'; mark.setAttribute('aria-hidden', 'true'); visual.append(mark);
  }
  const details = document.createElement('div'); details.className = 'product-info';
  const category = document.createElement('p'); category.className = 'product-category'; category.textContent = String(product.category ?? product.categoryId ?? 'De la casa');
  const name = document.createElement('h3'); name.textContent = String(product.name ?? 'Producto');
  const description = document.createElement('p'); description.className = 'product-description'; description.textContent = String(product.description ?? '');
  const footer = document.createElement('div'); footer.className = 'product-footer';
  const price = document.createElement('strong'); price.className = 'product-price'; price.textContent = formatCents(centsFor(product));
  const add = document.createElement('button'); add.type = 'button'; add.className = 'add-button'; add.setAttribute('aria-label', `Agregar ${name.textContent} al pedido`); add.textContent = 'Agregar';
  add.addEventListener('click', () => openProduct(product));
  footer.append(price, add); details.append(category, name, description, footer); card.append(visual, details);
  return card;
}

function openProduct(product) {
  selectedProduct = product;
  const detail = $('#product-detail'); detail.replaceChildren();
  const visual = document.createElement('div'); visual.className = 'detail-visual';
  if (typeof product.imageUrl === 'string' && /^https:\/\//i.test(product.imageUrl)) {
    const image = document.createElement('img'); image.src = product.imageUrl; image.alt = ''; visual.append(image);
  } else { visual.classList.add('visual-fallback'); visual.textContent = '✳'; }
  const body = document.createElement('div'); body.className = 'dialog-body';
  const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = String(product.category ?? product.categoryId ?? 'MENÚ');
  const title = document.createElement('h2'); title.id = 'product-title'; title.textContent = String(product.name ?? 'Producto');
  const price = document.createElement('p'); price.className = 'detail-price'; price.textContent = formatCents(centsFor(product));
  const description = document.createElement('p'); description.className = 'detail-description'; description.textContent = String(product.description ?? '');
  const fields = document.createElement('div'); fields.className = 'customization-fields';
  for (const [index, group] of optionGroups(product).entries()) {
    const label = document.createElement('label'); label.className = 'field-label'; label.textContent = group.required ? `${group.name} · requerido` : group.name;
    const select = document.createElement('select'); select.dataset.optionName = group.name; select.dataset.required = String(group.required);
    const empty = document.createElement('option'); empty.value = ''; empty.textContent = group.required ? 'Elige una opción' : 'Sin preferencia'; select.append(empty);
    group.options.forEach((choice) => { const option = document.createElement('option'); option.value = choice; option.textContent = choice; select.append(option); });
    if (!group.options.length) { select.disabled = true; empty.textContent = 'Opciones por definir'; }
    label.append(select); fields.append(label);
  }
  const noteLabel = document.createElement('label'); noteLabel.className = 'field-label'; noteLabel.textContent = 'Instrucciones especiales';
  const note = document.createElement('textarea'); note.id = 'product-note'; note.maxLength = 500; note.placeholder = '¿Algo que debamos saber?'; note.rows = 3;
  const counter = document.createElement('span'); counter.className = 'character-count'; counter.textContent = '0 / 500'; note.addEventListener('input', () => { counter.textContent = `${note.value.length} / 500`; }); noteLabel.append(note, counter);
  const quantityRow = document.createElement('div'); quantityRow.className = 'quantity-row'; quantityRow.innerHTML = '<span>Cantidad</span>';
  const quantityControl = document.createElement('div'); quantityControl.className = 'quantity-control';
  const decrease = document.createElement('button'); decrease.type = 'button'; decrease.textContent = '−'; decrease.setAttribute('aria-label', 'Reducir cantidad');
  const quantity = document.createElement('output'); quantity.value = '1'; quantity.textContent = '1';
  const increase = document.createElement('button'); increase.type = 'button'; increase.textContent = '+'; increase.setAttribute('aria-label', 'Aumentar cantidad');
  decrease.addEventListener('click', () => { const n = Math.max(1, Number(quantity.value) - 1); quantity.value = String(n); quantity.textContent = String(n); });
  increase.addEventListener('click', () => { const n = Math.min(20, Number(quantity.value) + 1); quantity.value = String(n); quantity.textContent = String(n); });
  quantityControl.append(decrease, quantity, increase); quantityRow.append(quantityControl);
  const button = document.createElement('button'); button.type = 'button'; button.className = 'primary-button'; button.innerHTML = `Agregar · ${formatCents(centsFor(product))} <span aria-hidden="true">→</span>`;
  button.addEventListener('click', () => {
    const selections = {};
    for (const select of fields.querySelectorAll('select')) {
      if (select.disabled) continue;
      if (select.dataset.required === 'true' && !select.value) { select.focus(); showToast(`Elige: ${select.dataset.optionName}`); return; }
      if (select.value) selections[select.dataset.optionName] = select.value;
    }
    const entry = { key: crypto.randomUUID(), productId: product.id, name: String(product.name ?? 'Producto'), unitPriceCents: centsFor(product), quantity: Number(quantity.value), customizations: selections, note: note.value.trim() };
    $('#order-feedback').textContent = '';
    cart.push(entry); cartRequestId = null; saveCart(); renderCart(); productDialog.close();
    showToast(`${entry.quantity} × ${entry.name} agregado${entry.quantity > 1 ? 's' : ''} al carrito`);
  });
  body.append(eyebrow, title, price, description, fields, noteLabel, quantityRow, button);
  detail.append(visual, body); productDialog.showModal();
}

function totals() {
  const subtotal = cart.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
  const serviceCharge = Math.round(subtotal * serviceChargeBps / 10000);
  return { subtotal, serviceCharge, total: subtotal + serviceCharge };
}

function renderCart() {
  const lines = $('#cart-lines'); lines.replaceChildren();
  if (!cart.length) {
    const empty = document.createElement('p'); empty.className = 'empty-cart'; empty.textContent = 'Todavía no agregas platos. Vuelve al menú para elegir algo.'; lines.append(empty);
  }
  cart.forEach((line) => {
    const row = document.createElement('article'); row.className = 'cart-line';
    const info = document.createElement('div'); info.className = 'cart-line-info';
    const name = document.createElement('strong'); name.textContent = line.name;
    const meta = document.createElement('p');
    const options = Object.entries(line.customizations ?? {}).map(([key, value]) => `${key}: ${value}`).join(' · ');
    meta.textContent = [options, line.note].filter(Boolean).join(' · ') || 'Sin personalizaciones';
    const price = document.createElement('span'); price.textContent = formatCents(line.unitPriceCents * line.quantity);
    info.append(name, meta, price);
    const controls = document.createElement('div'); controls.className = 'cart-line-controls';
    const minus = document.createElement('button'); minus.type = 'button'; minus.textContent = '−'; minus.setAttribute('aria-label', `Reducir ${line.name}`);
    const count = document.createElement('span'); count.textContent = String(line.quantity);
    const plus = document.createElement('button'); plus.type = 'button'; plus.textContent = '+'; plus.setAttribute('aria-label', `Aumentar ${line.name}`);
    minus.addEventListener('click', () => updateQuantity(line.key, -1)); plus.addEventListener('click', () => updateQuantity(line.key, 1));
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-line'; remove.textContent = 'Quitar'; remove.addEventListener('click', () => removeLine(line.key));
    controls.append(minus, count, plus, remove); row.append(info, controls); lines.append(row);
  });
  const { subtotal, serviceCharge, total } = totals();
  const totalsBox = $('#cart-totals'); totalsBox.replaceChildren();
  for (const [label, value, strong] of [['Subtotal', subtotal, false], ['Servicio', serviceCharge, false], ['Total', total, true]]) {
    const row = document.createElement('div'); row.className = `total-row${strong ? ' total-due' : ''}`;
    const name = document.createElement('span'); name.textContent = label;
    const amount = document.createElement('span'); amount.textContent = formatCents(value);
    row.append(name, amount); totalsBox.append(row);
  }
  const count = cart.reduce((sum, line) => sum + line.quantity, 0);
  $('#floating-cart-section').hidden = count === 0;
  $('#confirm-order').disabled = !count || !services;
  if (!services) $('#confirm-order').title = 'Firebase aún no está disponible';
  else $('#confirm-order').removeAttribute('title');
  syncOrderPanel();
}

function syncOrderPanel() {
  const panel = $('#order-tracking');
  if (!panel) return;
  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const accountOrders = trackedOrders.filter(isAccountOrder);
  panel.hidden = cartCount === 0 && accountOrders.length === 0 && !orderTrackingError;
  const confirmedTotal = accountOrders.reduce((sum, order) => sum + (Number(order.totalCents) || 0), 0);
  const cartTotal = totals().total;
  $('#order-account-total').textContent = accountOrders.length
    ? `Cuenta · ${formatCents(confirmedTotal)}`
    : `Carrito · ${formatCents(cartTotal)}`;
  const activeOrders = accountOrders.filter((order) => order.status !== 'entregado');
  const latest = [...accountOrders].sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))[0];
  const state = ({ recibido: 'Recibido por cocina', en_preparacion: 'En preparación', listo: 'Listo · espera al mesero', entregado: 'Entregado' })[latest?.status] ?? '';
  const orderSummary = latest ? `Pedido ${latest.orderNumber ?? latest.id.slice(0, 6)} · ${state}${activeOrders.length > 1 ? ` · ${activeOrders.length} activos` : ''}` : '';
  const cartSummary = cartCount ? `${cartCount} producto(s) en el carrito` : '';
  $('#order-tracking-summary').textContent = [orderSummary, cartSummary].filter(Boolean).join(' · ') || 'Tu pedido';
}

function updateQuantity(key, delta) {
  const line = cart.find((item) => item.key === key);
  if (!line) return;
  line.quantity = Math.max(0, Math.min(20, line.quantity + delta));
  if (!line.quantity) cart = cart.filter((item) => item.key !== key);
  cartRequestId = null; saveCart(); renderCart();
}

function removeLine(key) { cart = cart.filter((line) => line.key !== key); cartRequestId = null; saveCart(); renderCart(); }

function formatError(error) {
  const code = String(error?.code ?? '');
  if (code.includes('internal')) return 'Firestore no pudo completar la operación. Inténtalo de nuevo.';
  if (code.includes('not-found') && /platillo|producto/i.test(String(error?.message ?? ''))) return 'No encontramos uno de los platillos. Actualiza el menú e inténtalo de nuevo.';
  if (code.includes('permission-denied')) return 'Firestore rechazó la operación. Revisa las reglas publicadas.';
  if (code.includes('failed-precondition')) return error?.message ?? 'No se pudo completar la operación.';
  if (code.includes('unavailable') || code.includes('network')) return 'No hay conexión. Conservamos tu carrito; intenta de nuevo.';
  return error?.message || 'No se pudo completar la operación. Inténtalo de nuevo.';
}

async function waitForCustomerAuth() {
  const { onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(services.auth, (user) => { unsubscribe(); resolve(user); });
  });
}

async function getCustomer() {
  const { signInAnonymously } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');
  const currentUser = await waitForCustomerAuth();
  if (currentUser) return currentUser;
  const credential = await signInAnonymously(services.auth);
  return credential.user;
}

async function joinCustomerVisit(customerUid = services?.auth?.currentUser?.uid) {
  if (!customerUid || !/^\d{1,3}$/.test(tableId) || !qrToken) throw new Error('Abre el menú desde el QR de tu mesa.');
  const { arrayUnion, collection, doc, runTransaction, serverTimestamp } = services.firestore;
  const accessRef = doc(services.db, 'tableAccess', qrToken);
  const newVisitRef = doc(collection(services.db, 'visits'));
  visitId = await runTransaction(services.db, async (transaction) => {
    const accessSnapshot = await transaction.get(accessRef);
    if (!accessSnapshot.exists()) throw new Error('Este QR no está registrado. Pide al personal que revise el código de la mesa.');
    const access = accessSnapshot.data();
    if (access.enabled !== true || String(access.tableId) !== tableId.padStart(2, '0')) throw new Error('Este QR no corresponde a una mesa habilitada.');
    let currentVisitRef = null;
    let currentVisit = null;
    if (typeof access.activeVisitId === 'string' && access.activeVisitId) {
      currentVisitRef = doc(services.db, 'visits', access.activeVisitId);
      const currentSnapshot = await transaction.get(currentVisitRef);
      if (currentSnapshot.exists() && currentSnapshot.data().status === 'open') currentVisit = currentSnapshot.data();
    }
    const now = serverTimestamp();
    if (currentVisitRef && currentVisit) {
      transaction.update(currentVisitRef, { customerUids: arrayUnion(customerUid), updatedAt: now });
      return currentVisitRef.id;
    }
    transaction.set(newVisitRef, {
      tableId: tableId.padStart(2, '0'), status: 'open', customerUids: [customerUid], qrAccessToken: qrToken,
      subtotalCents: 0, serviceChargeCents: 0, totalCents: 0, amountPaidCents: 0,
      balanceDueCents: 0, paymentStatus: 'unpaid', startedAt: now, updatedAt: now,
    });
    transaction.set(accessRef, { tableId: tableId.padStart(2, '0'), activeVisitId: newVisitRef.id, enabled: true, updatedAt: now }, { merge: true });
    return newVisitRef.id;
  });
  saveCart();
  return visitId;
}

async function confirmOrder() {
  const button = $('#confirm-order');
  if (!cart.length || button.disabled) return;
  if (!/^\d{1,3}$/.test(tableId) || !qrToken) {
    $('#order-feedback').textContent = 'Para confirmar, abre el menú desde el QR de tu mesa.';
    return;
  }
  button.disabled = true; button.classList.add('button-loading'); button.textContent = 'Enviando pedido…';
  $('#order-feedback').textContent = '';
  let orderStage = 'iniciar sesión de cliente';
  try {
    const customer = await getCustomer();
    orderStage = 'validar el QR y la visita de la mesa';
    visitId = await joinCustomerVisit(customer.uid);
    orderStage = 'guardar el pedido en Firestore';
    const { collection, doc, serverTimestamp, setDoc } = services.firestore;
    const orderRef = doc(collection(services.db, 'orders'));
    const lines = cart.map((line) => {
      const product = products.find((item) => item.id === line.productId);
      if (!product || product.available !== true) throw new Error(`El platillo “${line.name}” ya no está disponible.`);
      const unitPriceCents = centsFor(product);
      const quantity = Number(line.quantity);
      const lineTotalCents = unitPriceCents * quantity;
      if (!Number.isSafeInteger(lineTotalCents) || quantity < 1 || quantity > 20) throw new Error('Revisa el precio o la cantidad de los platillos.');
      return {
        productId: line.productId, name: String(product.name ?? line.name), unitPriceCents,
        quantity, customizations: line.customizations ?? {}, note: String(line.note ?? '').slice(0, 500), lineTotalCents,
      };
    });
    const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
    const serviceChargeCents = Math.round(subtotalCents * serviceChargeBps / 10000);
    const totalCents = subtotalCents + serviceChargeCents;
    const orderNumber = orderRef.id.slice(0, 6).toUpperCase();
    await setDoc(orderRef, {
      visitId, tableId: tableId.padStart(2, '0'), qrToken, createdBy: customer.uid, customerUids: [customer.uid], orderNumber,
      status: 'recibido', items: lines, subtotalCents, serviceChargeCents, totalCents,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), receivedAt: serverTimestamp(),
    });
    startOrderTracking(visitId);
    cart = []; cartRequestId = null; saveCart();
    $('#order-feedback').textContent = `Pedido ${orderNumber} recibido. Gracias.`;
    renderCart();
    showToast(`Pedido ${orderNumber} enviado`);
  } catch (error) {
    console.error('No se pudo confirmar el pedido.', error);
    if (['failed-precondition', 'permission-denied'].includes(String(error?.code ?? '').split('/').pop())) {
      visitId = null;
      saveCart();
    }
    console.error(`Falló la etapa «${orderStage}».`, error);
    const errorCode = String(error?.code ?? '').split('/').pop();
    const detail = error?.message && error.message !== 'internal' ? ` (${error.message})` : '';
    if (orderStage === 'guardar el pedido en Firestore') {
      $('#order-feedback').textContent = errorCode === 'permission-denied'
        ? 'Firestore rechazó el pedido. Revisa que estén publicadas las reglas de pedidos directos.'
        : `No se pudo guardar el pedido${detail}.`;
    } else if (orderStage === 'iniciar sesión de cliente') {
      $('#order-feedback').textContent = errorCode === 'operation-not-allowed'
        ? 'Firebase Authentication no tiene habilitado el inicio de sesión anónimo.'
        : `No se pudo iniciar la sesión del cliente${detail}.`;
    } else {
      $('#order-feedback').textContent = error?.message && error.message !== 'internal'
        ? error.message
        : 'No se pudo validar el QR. Revisa que el código de la mesa y las reglas de Firestore estén actualizados.';
    }
  } finally {
    button.classList.remove('button-loading'); button.innerHTML = 'Confirmar pedido <span aria-hidden="true">→</span>';
    button.disabled = !cart.length;
  }
}

function startOrderTracking(currentVisitId) {
  if (!currentVisitId || trackedVisitId === currentVisitId) return;
  if (stopOrders) stopOrders();
  trackedVisitId = currentVisitId;
  const { collection, onSnapshot, query, where } = services.firestore;
  const ordersQuery = query(collection(services.db, 'orders'), where('visitId', '==', currentVisitId));
  stopOrders = onSnapshot(ordersQuery, (snapshot) => {
    const list = $('#order-tracking-list'); list.replaceChildren();
    const recentFirst = [...snapshot.docs].sort((a, b) => {
      const aTime = a.data().createdAt?.toMillis?.() ?? 0;
      const bTime = b.data().createdAt?.toMillis?.() ?? 0;
      return bTime - aTime;
    });
    const currentTableId = tableId.padStart(2, '0');
    const accountOrderDocs = recentFirst.filter((orderDoc) => {
      const order = { id: orderDoc.id, ...orderDoc.data() };
      return String(order.tableId ?? '').padStart(2, '0') === currentTableId && isAccountOrder(order);
    });
    trackedOrders = accountOrderDocs.map((orderDoc) => ({ id: orderDoc.id, ...orderDoc.data() }));
    orderTrackingError = false;
    syncOrderPanel();
    accountOrderDocs.forEach((orderDoc) => {
      const data = orderDoc.data();
      const card = document.createElement('article'); card.className = 'order-card';
      const header = document.createElement('div'); header.className = 'order-card-heading';
      const number = document.createElement('strong'); number.textContent = `Pedido ${data.orderNumber ?? orderDoc.id.slice(0, 6)}`;
      const labels = ['Recibido por cocina', 'En preparación', 'Listo · esperando al mesero', 'Entregado'];
      const states = ['recibido', 'en_preparacion', 'listo', 'entregado'];
      const current = Math.max(0, states.indexOf(data.status));
      const state = document.createElement('span'); state.className = 'order-status'; state.textContent = labels[current];
      header.append(number, state); card.append(header);
      const progress = document.createElement('ol'); progress.className = 'order-progress';
      labels.forEach((label, index) => { const step = document.createElement('li'); step.textContent = label; step.classList.toggle('step-complete', index <= current); step.classList.toggle('step-current', index === current); progress.append(step); });
      card.append(progress);
      (data.items ?? []).forEach((item) => {
        const line = document.createElement('p');
        const options = Object.values(item.customizations ?? {}).join(' · ');
        line.textContent = `${item.quantity} × ${item.name}${options ? ` · ${options}` : ''}${item.note ? ` · ${item.note}` : ''}`;
        card.append(line);
      });
      list.append(card);
    });
  }, (error) => {
    console.error('No se pudo actualizar el seguimiento.', error);
    const panel = $('#order-tracking');
    const list = $('#order-tracking-list');
    orderTrackingError = true;
    panel.hidden = false;
    orderTrackingExpanded = true;
    panel.classList.add('order-tracking-expanded');
    $('#order-tracking-toggle').setAttribute('aria-expanded', 'true');
    $('#order-tracking-summary').textContent = 'No se pudo cargar el seguimiento';
    list.replaceChildren();
    const message = document.createElement('p');
    message.className = 'order-tracking-error';
    message.textContent = error?.code?.includes('permission-denied')
      ? 'No tienes permiso para consultar estos pedidos. Revisa las reglas de Firestore.'
      : 'No se pudo conectar con el seguimiento. Comprueba tu conexión y vuelve a cargar el menú.';
    list.append(message);
  });
}

function watchTableAccount() {
  if (!services || !qrToken || !/^\d{1,3}$/.test(tableId)) return;
  if (stopTableAccess) stopTableAccess();
  const { doc, onSnapshot } = services.firestore;
  stopTableAccess = onSnapshot(doc(services.db, 'tableAccess', qrToken), (snapshot) => {
    const access = snapshot.exists() ? snapshot.data() : null;
    const nextVisitId = access?.enabled === true && access.tableId === tableId.padStart(2, '0')
      && typeof access.activeVisitId === 'string' ? access.activeVisitId : null;
    if (nextVisitId === trackedVisitId) {
      if (visitId !== nextVisitId) { visitId = nextVisitId; saveCart(); }
      return;
    }
    visitId = nextVisitId;
    trackedOrders = [];
    orderTrackingError = false;
    if (!nextVisitId && stopOrders) {
      stopOrders();
      stopOrders = null;
      trackedVisitId = null;
    } else if (nextVisitId) {
      startOrderTracking(nextVisitId);
    }
    saveCart();
    syncOrderPanel();
  }, (error) => {
    console.error('No se pudo seguir la visita de esta mesa.', error);
    orderTrackingError = true;
    syncOrderPanel();
  });
}

function reconnectOrderTracking() {
  if (document.visibilityState === 'hidden' || !visitId) return;
  if (stopOrders) stopOrders();
  stopOrders = null;
  trackedVisitId = null;
  startOrderTracking(visitId);
}

function listenToServiceCharge() {
  const { doc, onSnapshot } = services.firestore;
  return onSnapshot(doc(services.db, 'settings', 'restaurant'), (snapshot) => {
    const value = snapshot.exists() ? Number(snapshot.data().serviceChargeBps ?? 0) : 0;
    serviceChargeBps = Number.isInteger(value) && value >= 0 && value <= 10000 ? value : 0;
    renderCart();
  }, (error) => { console.error('No se pudo leer la configuración del servicio.', error); serviceChargeBps = 0; renderCart(); });
}

function subscribeCustomerRequest() {
  if (stopCustomerRequest) stopCustomerRequest();
  if (!customerRequestId || !customerRequestType) return;
  const { doc, onSnapshot } = services.firestore;
  const requestRef = doc(services.db, 'assistanceRequests', customerRequestId);
  stopCustomerRequest = onSnapshot(requestRef, (snapshot) => {
    if (!snapshot.exists()) return;
    const item = snapshot.data();
    if (customerRequestType === 'bill' && item.status === 'attended' && item.resolvedByPaymentId) {
      const closedAt = item.attendedAt?.toMillis?.() ?? Date.now();
      let shouldSave = false;
      if (closedAt > accountClosedThrough) { accountClosedThrough = closedAt; shouldSave = true; }
      if (item.visitId && visitId === item.visitId) { visitId = null; shouldSave = true; }
      if (shouldSave) saveCart();
    }
    const billInProgress = customerRequestType === 'bill' && item.status === 'attended' && !item.resolvedByPaymentId;
    if (item.status === 'pending' || billInProgress) {
      $('#request-feedback').textContent = customerRequestType === 'bill'
        ? `Mesa ${tableId.padStart(2, '0')}: el equipo está preparando tu cuenta. Se confirmará al registrar el pago.`
        : `Tu solicitud de ayuda está pendiente. El equipo de Mesa ${tableId.padStart(2, '0')} ya fue avisado.`;
      $('#request-actions').hidden = true; $('#cancel-request').hidden = billInProgress; return;
    }
    if (item.status === 'attended') {
      $('#request-feedback').textContent = customerRequestType === 'bill' && item.resolvedByPaymentId
        ? `La cuenta de Mesa ${tableId.padStart(2, '0')} quedó pagada y cerrada.`
        : `Tu solicitud de ${customerRequestType === 'bill' ? 'cuenta' : 'ayuda'} fue atendida.`;
      $('#request-actions').hidden = false; $('#cancel-request').hidden = true;
    } else if (item.status === 'cancelled') {
      $('#request-feedback').textContent = 'Tu solicitud fue cancelada.';
      $('#request-actions').hidden = false; $('#cancel-request').hidden = true;
    }
  }, (error) => { console.error('No se pudo actualizar la solicitud.', error); });
}

async function requestStaff(type) {
  if (!/^\d{1,3}$/.test(tableId)) {
    $('#request-feedback').textContent = 'Abre el menú con el enlace de tu mesa para enviar esta solicitud.';
    return;
  }
  const buttons = [$('#request-help'), $('#request-bill')];
  buttons.forEach((button) => { button.disabled = true; });
  $('#request-feedback').textContent = 'Enviando solicitud…';
  try {
    const customer = await getCustomer();
    const { addDoc, collection, getDocs, query, serverTimestamp, where } = services.firestore;
    const uid = customer.uid;
    let visitIdForRequest = null;
    let balanceDueCents = null;
    if (type === 'bill') {
      const customerOrders = await getDocs(query(
        collection(services.db, 'orders'),
        where('customerUids', 'array-contains', uid),
      ));
      const currentTable = tableId.padStart(2, '0');
      const unpaidOrders = customerOrders.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((order) => String(order.tableId ?? '').padStart(2, '0') === currentTable && order.paymentStatus !== 'paid');
      if (!unpaidOrders.length) throw new Error('Aún no tienes pedidos pendientes de pago en esta mesa.');
      const undelivered = unpaidOrders.filter((order) => order.status !== 'entregado');
      if (undelivered.length) throw new Error('Podrás solicitar la cuenta cuando el mesero haya entregado todos tus pedidos.');
      const visitIds = [...new Set(unpaidOrders.map((order) => order.visitId).filter(Boolean))];
      if (visitIds.length !== 1) throw new Error('No se pudo identificar una única cuenta para estos pedidos. Pide ayuda al personal.');
      visitIdForRequest = visitIds[0];
      balanceDueCents = unpaidOrders.reduce((sum, order) => sum + (Number(order.totalCents) || 0), 0);
      if (!Number.isSafeInteger(balanceDueCents) || balanceDueCents <= 0) throw new Error('No hay un saldo pendiente para solicitar la cuenta.');
    }
    const now = serverTimestamp();
    const requestRef = await addDoc(collection(services.db, 'assistanceRequests'), {
      tableId: tableId.padStart(2, '0'), customerUids: [uid], type, status: 'pending',
      ...(type === 'bill' ? { visitId: visitIdForRequest, balanceDueCents } : {}),
      createdAt: now, updatedAt: now, attendedAt: null, cancelledAt: null,
    });
    customerRequestId = requestRef.id;
    customerRequestType = type; saveCart();
    $('#request-feedback').textContent = `Solicitud de ${customerRequestType === 'bill' ? 'cuenta' : 'ayuda'} enviada. El equipo de Mesa ${tableId.padStart(2, '0')} ya fue avisado.`;
    $('#request-actions').hidden = true; $('#cancel-request').hidden = false;
    subscribeCustomerRequest();
  } catch (error) {
    console.error('No se pudo enviar la solicitud.', error);
    const code = String(error?.code ?? '').split('/').pop();
    $('#request-feedback').textContent = code === 'failed-precondition'
      ? error.message
      : code === 'permission-denied'
        ? 'Firestore rechazó la solicitud. Revisa que las reglas estén publicadas.'
        : code === 'unavailable' || code === 'internal'
          ? 'No se pudo conectar con Firestore. Inténtalo de nuevo.'
          : error?.message ?? 'No se pudo enviar la solicitud. Inténtalo de nuevo.';
  } finally { buttons.forEach((button) => { button.disabled = false; }); }
}

async function cancelCustomerRequest() {
  if (!customerRequestId) return;
  $('#cancel-request').disabled = true;
  try {
    const { doc, serverTimestamp, updateDoc } = services.firestore;
    await updateDoc(doc(services.db, 'assistanceRequests', customerRequestId), { status: 'cancelled', cancelledAt: serverTimestamp(), updatedAt: serverTimestamp() });
    $('#request-feedback').textContent = 'Solicitud cancelada.';
    $('#request-actions').hidden = false; $('#cancel-request').hidden = true;
  } catch (error) { $('#request-feedback').textContent = formatError(error); }
  finally { $('#cancel-request').disabled = false; }
}

function connectMenu() {
  const { collection, onSnapshot, query, where } = services.firestore;
  const menuQuery = query(collection(services.db, 'platillos'), where('available', '==', true));
  onSnapshot(menuQuery, (snapshot) => {
    products = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => typeof item.name === 'string' && centsFor(item) >= 0);
    products.sort((a, b) => String(a.category ?? a.categoryId ?? '').localeCompare(String(b.category ?? b.categoryId ?? ''), 'es') || String(a.name).localeCompare(String(b.name), 'es'));
    menuFeedback.hidden = true; renderMenu();
  }, (error) => {
    console.error('No se pudo cargar el menú.', error);
    menuFeedback.hidden = false; menuFeedback.classList.add('feedback-empty');
    menuFeedback.innerHTML = '<span class="empty-icon" aria-hidden="true">!</span><div><strong>No pudimos cargar el menú</strong><p>Comprueba tu conexión e inténtalo de nuevo.</p></div>';
    $('#menu-count').textContent = 'Menú no disponible';
  });
}

function startApp() {
  $('#table-label').textContent = /^\d{1,3}$/.test(tableId) ? `Mesa ${tableId.padStart(2, '0')}` : 'Explora el menú';
  readCart(); renderCart();
  $('#confirm-order').addEventListener('click', confirmOrder);
  $('#order-tracking-toggle').addEventListener('click', () => {
    orderTrackingExpanded = !orderTrackingExpanded;
    const panel = $('#order-tracking');
    panel.classList.toggle('order-tracking-expanded', orderTrackingExpanded);
    $('#order-tracking-toggle').setAttribute('aria-expanded', String(orderTrackingExpanded));
  });
  $('#help-nav').addEventListener('click', () => { $('#request-feedback').textContent = ''; $('#request-actions').hidden = false; $('#cancel-request').hidden = true; $('#message-dialog').showModal(); if (customerRequestId && services) subscribeCustomerRequest(); });
  $('#request-help').addEventListener('click', () => requestStaff('help'));
  $('#request-bill').addEventListener('click', () => requestStaff('bill'));
  $('#cancel-request').addEventListener('click', cancelCustomerRequest);
  $('#dismiss-message').addEventListener('click', () => $('#message-dialog').close());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      for (const dialog of [productDialog, $('#message-dialog')]) {
        if (dialog.open) dialog.close();
      }
      return;
    }
    reconnectOrderTracking();
  });
  window.addEventListener('pageshow', () => {
    for (const dialog of [productDialog, $('#message-dialog')]) {
      if (dialog.open) dialog.close();
    }
  });
  window.addEventListener('offline', () => showToast('Sin conexión. Tu carrito se conserva en este dispositivo.'));
  window.addEventListener('online', () => {
    reconnectOrderTracking();
    showToast('Conexión recuperada. Puedes reintentar la operación.');
  });
  import('./firebase.js').then((firebase) => {
    const firestore = import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    return firestore.then((api) => {
      services = { ...firebase, firestore: api }; connectMenu(); listenToServiceCharge(); renderCart();
      getCustomer().then(async () => {
        watchTableAccount();
        if (customerRequestId) subscribeCustomerRequest();
      }).catch((error) => {
        console.error('No se pudo iniciar la sesión de cliente.', error);
      });
    });
  }).catch((error) => {
    console.error('No se pudieron iniciar los servicios de Firebase.', error);
    menuFeedback.hidden = false; menuFeedback.classList.add('feedback-empty');
    menuFeedback.innerHTML = '<span class="empty-icon" aria-hidden="true">!</span><div><strong>No pudimos conectar</strong><p>Revisa tu conexión y vuelve a cargar la página.</p></div>';
    $('#menu-count').textContent = 'Sin conexión';
  });
}

startApp();
