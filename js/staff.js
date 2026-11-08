import { downloadInvoicePdf, invoiceMarkup, printInvoice } from './invoice.js';

const $ = (selector) => document.querySelector(selector);
const loginPanel = $('#login-panel');
const appPanel = $('#staff-app');
const loginError = $('#login-error');
const loginButton = $('#login-button');
const orderDialog = $('#staff-order-dialog');
const paymentDialog = $('#payment-dialog');
const invoiceDialog = $('#staff-invoice-dialog');
const menuItemDialog = $('#menu-item-dialog');
const menuItemForm = $('#menu-item-form');
const tableQrDialog = $('#table-qr-dialog');
const money = new Intl.NumberFormat('es-NI', { style: 'currency', currency: 'NIO' });
const statusLabels = { recibido: 'Recibido', en_preparacion: 'En preparación', listo: 'Listo', entregado: 'Entregado' };
const itemStatusLabels = { recibido: 'Recibido', en_preparacion: 'En preparación', listo: 'Listo para entregar', entregado: 'Entregado' };
const fulfillmentLabels = { kitchen: 'Cocina', bar: 'Barra', direct: 'Entrega directa' };

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
let unsubscribePayments = null;
let unsubscribeRecommendations = null;
let activeVisits = [];
let tableDocs = [];
let closedVisits = [];
let recordedPayments = [];
let menuRecommendations = {};
let assistanceRequests = [];
let reminderTimer = null;
let firstRequestSnapshot = true;
let soundsEnabled = localStorage.getItem('mesaexpress-sounds-enabled') !== 'false';
let audioContext = null;
let paymentVisitId = null;
let paymentOperationId = null;
let currentStaffInvoice = null;
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

function normalizedStaffRole(role) {
  const value = String(role ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (['mesero', 'caja'].includes(value)) return 'mesero';
  if (['cocina', 'chef'].includes(value)) return 'cocina';
  if (['admin', 'administrador', 'staff'].includes(value)) return 'admin';
  return '';
}

function allowedStaffSections() {
  if (staffUser?.role === 'cocina') return ['orders', 'menu'];
  if (staffUser?.role === 'mesero') return ['deliveries', 'tables', 'requests'];
  return ['orders', 'deliveries', 'tables', 'requests', 'menu', 'metrics'];
}

function activateStaffSection(section) {
  if (!allowedStaffSections().includes(section)) return;
  document.querySelectorAll('.staff-tab').forEach((tab) => {
    const selected = tab.dataset.section === section;
    tab.classList.toggle('staff-tab-active', selected);
    tab.setAttribute('aria-selected', String(selected));
  });
  $('.orders-workspace').hidden = section !== 'orders';
  $('#deliveries-workspace').hidden = section !== 'deliveries';
  $('#tables-workspace').hidden = section !== 'tables';
  $('#requests-workspace').hidden = section !== 'requests';
  $('#menu-workspace').hidden = section !== 'menu';
  $('#metrics-workspace').hidden = section !== 'metrics';
  $('#dashboard-title').textContent = ({ orders: 'Cocina', deliveries: 'Entregas', tables: 'Mesas activas', requests: 'Solicitudes', menu: 'Platillos', metrics: 'Métricas' })[section];
}

function configureStaffNavigation() {
  const allowed = allowedStaffSections();
  document.querySelectorAll('.staff-tab').forEach((tab) => { tab.hidden = !allowed.includes(tab.dataset.section); });
  $('#daily-special-manage').hidden = staffUser?.role !== 'admin';
  const initialSection = staffUser?.role === 'mesero' ? 'deliveries' : staffUser?.role === 'admin' ? 'metrics' : 'orders';
  activateStaffSection(initialSection);
}

function showDashboard() {
  loginPanel.hidden = true;
  appPanel.hidden = false;
  configureStaffNavigation();
  $('#staff-welcome').textContent = staffUser?.displayName ? `Sesión activa · ${staffUser.displayName}` : 'Sesión de personal autorizada';
}

function isVisible(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  if (!items.length) return currentFilter === 'activas' ? order.status !== 'entregado' : order.status === currentFilter;
  const lines = orderItemsWithRouting(order);
  if (currentFilter === 'activas') return lines.some((item) => item.fulfillmentMode !== 'direct' && ['recibido', 'en_preparacion'].includes(item.status));
  if (currentFilter === 'recibido' || currentFilter === 'en_preparacion') return lines.some((item) => item.fulfillmentMode !== 'direct' && item.status === currentFilter);
  if (currentFilter === 'listo') return lines.some((item) => item.fulfillmentMode !== 'direct' && item.status === 'listo');
  if (currentFilter === 'entregado') return lines.every((item) => item.status === 'entregado');
  return false;
}

function canChangeOrderItemStatus(nextStatus, source) {
  if (nextStatus === 'entregado') return staffUser?.role === 'mesero' && source === 'delivery';
  return staffUser?.role === 'cocina' && ['en_preparacion', 'listo'].includes(nextStatus) && ['kitchen', 'detail'].includes(source);
}

function aggregateOrderStatus(items, fallback = 'recibido') {
  if (!items.length) return fallback;
  const statuses = items.map((item) => item.status ?? fallback);
  if (statuses.every((status) => status === 'entregado')) return 'entregado';
  if (statuses.every((status) => status === 'listo' || status === 'entregado')) return 'listo';
  if (statuses.includes('en_preparacion')) return 'en_preparacion';
  return 'recibido';
}

function fulfillmentModeForItem(item) {
  const product = menuItems.find((entry) => entry.id === item.productId);
  if (['kitchen', 'bar', 'direct'].includes(product?.fulfillmentMode)) return product.fulfillmentMode;
  if (['kitchen', 'bar', 'direct'].includes(item.fulfillmentMode)) return item.fulfillmentMode;
  const category = String(item.category ?? product?.category ?? '');
  return /^(Bebidas|Alcohol)$/i.test(category) ? 'direct' : 'kitchen';
}
function orderItemsWithRouting(order) {
  return (order.items ?? []).map((item) => {
    const fulfillmentMode = fulfillmentModeForItem(item);
    const status = fulfillmentMode === 'direct' && (!item.status || item.status === 'recibido')
      ? 'listo'
      : item.status ?? order.status ?? 'recibido';
    return { ...item, fulfillmentMode, status };
  });
}
function orderProgressStatus(order) { return aggregateOrderStatus(orderItemsWithRouting(order), order.status ?? 'recibido'); }
function orderFullyDelivered(order) {
  const items = orderItemsWithRouting(order);
  return items.length ? items.every((item) => (item.status ?? order.status) === 'entregado') : order.status === 'entregado';
}
function orderNeedsPreparation(order) {
  return orderItemsWithRouting(order).some((item) => item.fulfillmentMode !== 'direct' && ['recibido', 'en_preparacion'].includes(item.status));
}
function formatOrderItemStatus(item, order) { return itemStatusLabels[item.status ?? order.status] ?? 'Pendiente'; }

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

function metricsStartDate(period) {
  if (period === 'all') return null;
  const start = new Date(); start.setHours(0, 0, 0, 0);
  if (period === '7days') start.setDate(start.getDate() - 6);
  if (period === '30days') start.setDate(start.getDate() - 29);
  return start;
}

function itemCategoryGroup(category) {
  const value = String(category ?? '').trim().toLocaleLowerCase('es');
  if (['bebidas', 'alcohol'].includes(value)) return 'drink';
  if (['entradas', 'platos fuertes', 'postres', 'niños'].includes(value)) return 'food';
  return 'unknown';
}

function metricsProductRows(start) {
  const byId = new Map();
  menuItems.filter((item) => item.available === true).forEach((item) => {
    byId.set(item.id, { id: item.id, name: String(item.name ?? 'Platillo'), category: String(item.category ?? ''), units: 0, salesCents: 0 });
  });
  const menuById = new Map(menuItems.map((item) => [item.id, item]));
  orders.filter((order) => {
    if (order.paymentStatus !== 'paid') return false;
    const soldAt = timestampDate(order.paidAt) ?? timestampDate(order.createdAt);
    return !start || (soldAt && soldAt >= start);
  }).forEach((order) => (order.items ?? []).forEach((item) => {
    const id = String(item.productId ?? `legacy:${item.name ?? 'producto'}`);
    const menuItem = menuById.get(id);
    const category = String(item.category ?? menuItem?.category ?? '');
    const row = byId.get(id) ?? { id, name: String(item.name ?? menuItem?.name ?? 'Platillo'), category, units: 0, salesCents: 0 };
    row.name = String(item.name ?? row.name);
    row.category ||= category;
    row.units += Math.max(0, Number(item.quantity) || 0);
    row.salesCents += Math.max(0, Number(item.lineTotalCents) || (Number(item.unitPriceCents) || 0) * (Number(item.quantity) || 0));
    byId.set(id, row);
  }));
  return [...byId.values()];
}

function renderMetricsRanking(target, rows, emptyCopy) {
  const container = $(target); container.replaceChildren();
  if (!rows.length) { const empty = document.createElement('p'); empty.className = 'metrics-empty'; empty.textContent = emptyCopy; container.append(empty); return; }
  const maxUnits = Math.max(...rows.map((row) => row.units), 1);
  rows.forEach((row, index) => {
    const line = document.createElement('div'); line.className = 'metrics-ranking-row';
    const rank = document.createElement('span'); rank.className = 'metrics-rank'; rank.textContent = String(index + 1).padStart(2, '0');
    const copy = document.createElement('div'); copy.className = 'metrics-ranking-copy';
    const name = document.createElement('strong'); name.textContent = row.name;
    const category = document.createElement('small'); category.textContent = row.category || 'Categoría no registrada';
    const bar = document.createElement('span'); bar.className = 'metrics-ranking-bar';
    const fill = document.createElement('i'); fill.style.width = `${Math.max(row.units ? 5 : 0, Math.round(row.units / maxUnits * 100))}%`; bar.append(fill);
    copy.append(name, category, bar);
    const units = document.createElement('strong'); units.className = 'metrics-unit-count'; units.textContent = `${row.units} ${row.units === 1 ? 'unidad' : 'unidades'}`;
    line.append(rank, copy, units); container.append(line);
  });
}

function renderMetrics() {
  if (!$('#metrics-workspace')) return;
  const period = $('#metrics-period').value || 'today';
  const start = metricsStartDate(period);
  const paymentsInPeriod = recordedPayments.filter((payment) => {
    if (payment.status !== 'recorded') return false;
    const paidAt = timestampDate(payment.createdAt);
    return !start || (paidAt && paidAt >= start);
  });
  const salesCents = paymentsInPeriod.reduce((sum, payment) => sum + (Number(payment.amountCents) || 0), 0);
  const pendingCents = activeVisits.reduce((sum, visit) => sum + visitBalance(visit), 0);
  const activeTableCount = new Set(activeVisits.map((visit) => normalizedTableId(visit.tableId))).size;
  $('#metric-sales').textContent = formatCents(salesCents);
  $('#metric-bills').textContent = String(paymentsInPeriod.length);
  $('#metric-average').textContent = `Promedio por cuenta: ${formatCents(paymentsInPeriod.length ? Math.round(salesCents / paymentsInPeriod.length) : 0)}`;
  $('#metric-active-tables').textContent = String(activeTableCount);
  $('#metric-pending').textContent = formatCents(pendingCents);

  const products = metricsProductRows(start);
  const totalUnits = products.reduce((sum, item) => sum + item.units, 0);
  const foodUnits = products.filter((item) => itemCategoryGroup(item.category) === 'food').reduce((sum, item) => sum + item.units, 0);
  const drinkUnits = products.filter((item) => itemCategoryGroup(item.category) === 'drink').reduce((sum, item) => sum + item.units, 0);
  $('#metric-units').textContent = String(totalUnits);
  $('#metric-food-units').textContent = String(foodUnits);
  $('#metric-drink-units').textContent = String(drinkUnits);

  const categoryFilter = $('#metrics-category-filter').value || 'all';
  const categoryProducts = products.filter((item) => categoryFilter === 'all' || itemCategoryGroup(item.category) === categoryFilter);
  const itemFilter = $('#metrics-item-filter');
  const previousItem = itemFilter.value;
  const sortedOptions = categoryProducts.slice().sort((a, b) => a.name.localeCompare(b.name, 'es'));
  itemFilter.replaceChildren(new Option('Todos los productos', 'all'));
  sortedOptions.forEach((item) => itemFilter.add(new Option(item.name, item.id)));
  if (sortedOptions.some((item) => item.id === previousItem)) itemFilter.value = previousItem;
  const selectedProducts = itemFilter.value === 'all' ? categoryProducts : categoryProducts.filter((item) => item.id === itemFilter.value);
  const bestRows = selectedProducts.filter((item) => item.units > 0).slice().sort((a, b) => b.units - a.units || a.name.localeCompare(b.name, 'es')).slice(0, 5);
  const lowRows = selectedProducts.slice().sort((a, b) => a.units - b.units || a.name.localeCompare(b.name, 'es')).slice(0, 5);
  renderMetricsRanking('#metrics-best-sellers', bestRows, 'Todavía no hay ventas de productos en este período.');
  renderMetricsRanking('#metrics-low-sellers', lowRows, 'No hay productos para mostrar con estos filtros.');

  const tableSummary = new Map();
  paymentsInPeriod.forEach((payment) => {
    const tableId = normalizedTableId(payment.tableId || '—');
    const row = tableSummary.get(tableId) ?? { tableId, paid: 0, pending: 0, accounts: 0 };
    row.paid += Number(payment.amountCents) || 0; row.accounts += 1; tableSummary.set(tableId, row);
  });
  activeVisits.forEach((visit) => {
    const tableId = normalizedTableId(visit.tableId || '—');
    const row = tableSummary.get(tableId) ?? { tableId, paid: 0, pending: 0, accounts: 0 };
    row.pending += visitBalance(visit); tableSummary.set(tableId, row);
  });
  const tableContainer = $('#metrics-table-sales'); tableContainer.replaceChildren();
  const tableRows = [...tableSummary.values()].sort((a, b) => b.paid - a.paid || a.tableId.localeCompare(b.tableId, 'es', { numeric: true }));
  if (!tableRows.length) { const empty = document.createElement('p'); empty.className = 'metrics-empty'; empty.textContent = 'No hay ventas ni mesas activas para este período.'; tableContainer.append(empty); }
  tableRows.forEach((row) => {
    const line = document.createElement('div'); line.className = 'metrics-table-row';
    const table = document.createElement('strong'); table.textContent = `Mesa ${row.tableId}`;
    const makeCell = (label, value) => { const cell = document.createElement('span'); const caption = document.createElement('small'); caption.textContent = label; const amount = document.createElement('strong'); amount.textContent = value; cell.append(caption, amount); return cell; };
    const paid = makeCell('Cobrado', formatCents(row.paid));
    const pending = makeCell('Pendiente', formatCents(row.pending));
    const accounts = makeCell('Cuentas', String(row.accounts));
    line.append(table, paid, pending, accounts); tableContainer.append(line);
  });

  const recentContainer = $('#metrics-recent-payments'); recentContainer.replaceChildren();
  paymentsInPeriod.slice().sort((a, b) => (timestampDate(b.createdAt)?.getTime() ?? 0) - (timestampDate(a.createdAt)?.getTime() ?? 0)).slice(0, 8).forEach((payment) => {
    const line = document.createElement('div'); line.className = 'metrics-payment-row';
    const table = document.createElement('strong'); table.textContent = `Mesa ${normalizedTableId(payment.tableId || '—')}`;
    const time = document.createElement('span'); const date = timestampDate(payment.createdAt);
    time.textContent = date ? new Intl.DateTimeFormat('es-NI', { dateStyle: 'short', timeStyle: 'short' }).format(date) : 'Fecha pendiente';
    const method = document.createElement('small'); method.textContent = payment.method === 'cash' ? 'Efectivo' : payment.method === 'other_physical' ? 'Otro medio físico' : 'Método no registrado';
    const amount = document.createElement('b'); amount.textContent = formatCents(payment.amountCents);
    line.append(table, time, method, amount); recentContainer.append(line);
  });
  if (!recentContainer.childElementCount) { const empty = document.createElement('p'); empty.className = 'metrics-empty'; empty.textContent = 'Las cuentas pagadas aparecerán aquí.'; recentContainer.append(empty); }
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
  $('#menu-preparation-mode').value = item?.fulfillmentMode ?? (/^(Bebidas|Alcohol)$/i.test(String(item?.category ?? '')) ? 'direct' : 'kitchen');
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
    const mode = item.fulfillmentMode ?? (/^(Bebidas|Alcohol)$/i.test(String(item.category ?? '')) ? 'direct' : 'kitchen');
    const isAvailable = item.available === true;
    const badges = document.createElement('div'); badges.className = 'staff-menu-badges';
    const state = document.createElement('span'); state.className = `menu-availability-badge ${isAvailable ? 'is-available' : 'is-unavailable'}`; state.textContent = isAvailable ? 'Disponible' : 'No disponible';
    const destination = document.createElement('span'); destination.className = 'menu-availability-badge menu-destination-badge'; destination.textContent = fulfillmentLabels[mode] ?? fulfillmentLabels.kitchen;
    badges.append(state, destination); top.append(titleWrap, badges);
    const description = document.createElement('p'); description.className = 'staff-menu-description'; description.textContent = item.description || 'Sin descripción';
    const price = document.createElement('strong'); price.className = 'staff-menu-price'; price.textContent = formatCents(Number.isSafeInteger(item.priceCents) ? item.priceCents : Math.round(Number(item.price ?? 0) * 100));
    const actions = document.createElement('div'); actions.className = 'staff-menu-actions';
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'staff-detail-button'; edit.textContent = 'Editar'; edit.addEventListener('click', () => openMenuItemForm(item));
    const availabilityButton = document.createElement('button');
    availabilityButton.type = 'button';
    availabilityButton.className = `staff-detail-button ${isAvailable ? 'menu-disable-button' : 'menu-enable-button'}`;
    availabilityButton.textContent = isAvailable ? 'Deshabilitar' : 'Habilitar';
    availabilityButton.setAttribute('aria-label', `${isAvailable ? 'Deshabilitar' : 'Habilitar'} ${item.name || 'platillo'} en el menú`);
    availabilityButton.addEventListener('click', async () => {
      availabilityButton.disabled = true;
      availabilityButton.textContent = isAvailable ? 'Deshabilitando…' : 'Habilitando…';
      try {
        const { doc, serverTimestamp, updateDoc } = services.firestore;
        await updateDoc(doc(services.db, 'platillos', item.id), {
          available: !isAvailable,
          availabilityMessage: isAvailable ? 'No disponible por falta de ingredientes' : '',
          updatedAt: serverTimestamp(),
        });
        staffNotice(isAvailable ? `${item.name} no está disponible en el menú.` : `${item.name} volvió a estar disponible.`, 'success');
      } catch (error) {
        console.error('No se pudo cambiar la disponibilidad del platillo.', error);
        staffNotice(error?.message ?? 'No se pudo cambiar la disponibilidad.', 'error');
        if (availabilityButton.isConnected) {
          availabilityButton.disabled = false;
          availabilityButton.textContent = isAvailable ? 'Deshabilitar' : 'Habilitar';
        }
      }
    });
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
    actions.append(edit, availabilityButton, remove); card.append(top, description, price, actions); container.append(card);
  });
}

function subscribeMenuItems() {
  unsubscribeMenuItems?.();
  const { collection, onSnapshot } = services.firestore;
  unsubscribeMenuItems = onSnapshot(collection(services.db, 'platillos'), (snapshot) => {
    menuItems = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'es'));
    renderStaffDailySpecial();
    renderMenuItems();
    renderOrders();
    if (selectedOrderId) renderOrderDetails();
    renderMetrics();
    if ($('#daily-special-dialog')) openDailySpecialPrompt(false);
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
    card.append(name, total, time);
    if (visit.invoice) {
      const invoiceButton = document.createElement('button'); invoiceButton.type = 'button'; invoiceButton.className = 'staff-detail-button'; invoiceButton.textContent = 'Ver / descargar factura';
      invoiceButton.addEventListener('click', () => openStaffInvoice({ ...visit.invoice, visitId: visit.id }));
      card.append(invoiceButton);
    }
    container.append(card);
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

async function updateMenuRecommendationsFromPaidOrders(paidOrders) {
  if (!paidOrders.length) return;
  const { doc, runTransaction, serverTimestamp } = services.firestore;
  const recommendationsRef = doc(services.db, 'menuRecommendations', 'current');
  const recommendationStatsRef = doc(services.db, 'menuRecommendationStats', 'current');
  await runTransaction(services.db, async (transaction) => {
    const [recommendationSnapshot, statsSnapshot] = await Promise.all([transaction.get(recommendationsRef), transaction.get(recommendationStatsRef)]);
    const recommendationData = recommendationSnapshot.exists() ? recommendationSnapshot.data() : {};
    const statsData = statsSnapshot.exists() ? statsSnapshot.data() : {};
    const processedOrderIds = new Set(Array.isArray(statsData.processedOrderIds) ? statsData.processedOrderIds : []);
    const salesByProduct = new Map((recommendationData.salesByProduct ?? []).map((row) => [row.productId, { ...row }]));
    const comboCounts = new Map((statsData.comboCandidates ?? []).map((combo) => [combo.signature, { ...combo }]));
    const basketsByVisit = new Map();
    paidOrders.forEach((order) => {
      if (!order.id || processedOrderIds.has(order.id)) return;
      processedOrderIds.add(order.id);
      const visitKey = String(order.visitId ?? order.id);
      const basket = basketsByVisit.get(visitKey) ?? new Map();
      (order.items ?? []).forEach((item) => {
        const productId = String(item.productId ?? ''); if (!productId) return;
        const sales = salesByProduct.get(productId) ?? { productId, name: String(item.name ?? 'Producto'), category: String(item.category ?? ''), units: 0 };
        sales.units += Math.max(0, Number(item.quantity) || 0); sales.name = String(item.name ?? sales.name); sales.category = String(item.category ?? sales.category); salesByProduct.set(productId, sales);
        const line = basket.get(productId) ?? { productId, name: String(item.name ?? 'Producto'), quantity: 0 };
        line.quantity += Math.max(0, Number(item.quantity) || 0); basket.set(productId, line);
      });
      basketsByVisit.set(visitKey, basket);
    });
    basketsByVisit.forEach((basket) => {
      const items = [...basket.values()].sort((a, b) => a.productId.localeCompare(b.productId));
      if (items.length < 2 || items.length > 4) return;
      const signature = items.map((item) => item.productId).join('|');
      const candidate = comboCounts.get(signature) ?? { signature, items, orderCount: 0 };
      candidate.items = items.map((item) => {
        const prior = candidate.items.find((entry) => entry.productId === item.productId);
        return { ...item, quantity: prior ? Math.max(1, Math.round((prior.quantity * candidate.orderCount + item.quantity) / (candidate.orderCount + 1))) : item.quantity };
      });
      candidate.orderCount += 1; comboCounts.set(signature, candidate);
    });
    const comboCandidates = [...comboCounts.values()].sort((a, b) => b.orderCount - a.orderCount).slice(0, 40);
    const combos = comboCandidates.filter((combo) => combo.orderCount >= 1).slice(0, 8).map((combo) => ({
      id: combo.signature, name: `Combo ${combo.items.slice(0, 2).map((item) => item.name).join(' + ')}`,
      items: combo.items.map(({ productId, quantity }) => ({ productId, quantity })), orderCount: combo.orderCount,
    }));
    const updatedAt = serverTimestamp();
    transaction.set(recommendationStatsRef, { comboCandidates, processedOrderIds: [...processedOrderIds], updatedAt }, { merge: true });
    transaction.set(recommendationsRef, {
      ...recommendationData,
      salesByProduct: [...salesByProduct.values()].sort((a, b) => b.units - a.units).slice(0, 100),
      combos, updatedAt,
    }, { merge: true });
  });
}

async function submitPayment() {
  if (!paymentVisitId) return;
  const button = $('#record-payment'); button.disabled = true; button.textContent = 'Registrando…';
  try {
    let invoiceForDisplay = null;
    let paidOrdersForInsights = [];
    let recommendationsUpdated = true;
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
        if (paymentSnapshot.data().visitId === visit.id) { invoiceForDisplay = visitSnapshot.data()?.invoice ?? null; return; }
        throw new Error('El identificador del pago ya está asociado a otra cuenta.');
      }
      if (!visitSnapshot.exists() || visitSnapshot.data().status !== 'open') throw new Error('La cuenta de esta mesa ya está cerrada.');
      const ordersToPay = orderSnapshots.filter((item) => item.exists() && item.data().paymentStatus !== 'paid');
      paidOrdersForInsights = ordersToPay.map((item) => ({ id: item.id, ...item.data() }));
      const undelivered = ordersToPay.filter((item) => !orderFullyDelivered(item.data()));
      if (undelivered.length) throw new Error(`No se puede cerrar la cuenta: faltan pedidos por entregar (${undelivered.map((item) => `#${item.data().orderNumber ?? item.id.slice(0, 6)}`).join(', ')}).`);
      const balanceDueCents = ordersToPay.reduce((sum, item) => sum + (Number(item.data().totalCents) || 0), 0);
      if (!Number.isSafeInteger(balanceDueCents) || balanceDueCents <= 0) throw new Error('La visita no tiene un saldo pendiente que cobrar.');
      const now = serverTimestamp();
      const method = $('#payment-method').value;
      const invoice = {
        paymentId: paymentOperationId, visitId: visit.id, tableId: visit.tableId,
        method, paidAt: now,
        subtotalCents: ordersToPay.reduce((sum, item) => sum + (Number(item.data().subtotalCents) || 0), 0),
        serviceChargeCents: ordersToPay.reduce((sum, item) => sum + (Number(item.data().serviceChargeCents) || 0), 0),
        totalCents: balanceDueCents,
        items: ordersToPay.flatMap((orderSnapshot) => {
          const order = orderSnapshot.data();
          return (order.items ?? []).map((item) => ({
            orderNumber: String(order.orderNumber ?? orderSnapshot.id.slice(0, 6)).toUpperCase(),
            productId: String(item.productId ?? ''), name: String(item.name ?? 'Producto'),
            quantity: Number(item.quantity) || 0, unitPriceCents: Number(item.unitPriceCents) || 0,
            lineTotalCents: Number(item.lineTotalCents) || 0,
            customizations: item.customizations && typeof item.customizations === 'object' ? item.customizations : {},
            note: String(item.note ?? ''),
          }));
        }),
      };
      invoiceForDisplay = { ...invoice, paidAt: new Date() };
      transaction.set(paymentRef, {
        visitId: visit.id, tableId: visit.tableId, amountCents: balanceDueCents,
        method, status: 'recorded', createdAt: now,
        recordedBy: staffUser.uid, recordedByEmail: staffUser.email ?? null,
      });
      const previousPaid = Number(visitSnapshot.data().amountPaidCents ?? 0);
      transaction.update(visitRef, {
        totalCents: Math.max(Number(visitSnapshot.data().totalCents ?? 0), previousPaid + balanceDueCents),
        amountPaidCents: previousPaid + balanceDueCents, balanceDueCents: 0,
        paymentStatus: 'paid', status: 'closed', closedAt: now, updatedAt: now, closedBy: staffUser.uid,
        invoice,
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
    try { await updateMenuRecommendationsFromPaidOrders(paidOrdersForInsights); }
    catch (error) { recommendationsUpdated = false; console.info('El pago se registró, pero no se actualizaron las recomendaciones.', error); }
    paymentDialog.close();
    staffNotice(recommendationsUpdated ? 'Pago registrado y visita cerrada.' : 'Pago registrado. Publica las reglas nuevas para actualizar las recomendaciones.', recommendationsUpdated ? 'success' : 'error');
    paymentVisitId = null; paymentOperationId = null;
    if (!invoiceForDisplay) invoiceForDisplay = closedVisits.find((item) => item.id === visit.id)?.invoice ?? null;
    if (invoiceForDisplay) openStaffInvoice({ ...invoiceForDisplay, visitId: visit.id });
  } catch (error) {
    console.error('No se pudo registrar el pago.', error);
    $('#payment-feedback').textContent = error?.message ?? 'No se pudo registrar el pago. Puedes reintentar.';
  } finally { button.disabled = false; button.textContent = 'Registrar pago completo y cerrar cuenta'; }
}

function openStaffInvoice(invoice) {
  currentStaffInvoice = invoice;
  $('#staff-invoice-content').innerHTML = invoiceMarkup(invoice);
  invoiceDialog.showModal();
}

function downloadCurrentStaffInvoice() {
  if (currentStaffInvoice) downloadInvoicePdf(currentStaffInvoice);
}

function printCurrentStaffInvoice() {
  if (!currentStaffInvoice) return;
  if (!printInvoice(currentStaffInvoice)) staffNotice('Permite las ventanas emergentes para imprimir la factura.', 'error');
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
    const payload = { name: $('#menu-name').value.trim(), description: $('#menu-description').value.trim(), category: $('#menu-category').value, fulfillmentMode: $('#menu-preparation-mode').value, priceCents, imageUrl: $('#menu-image').value.trim(), options, available: $('#menu-available').checked };
    const { collection, doc, serverTimestamp, setDoc, updateDoc } = services.firestore;
    const itemData = {
      name: payload.name, description: payload.description, category: payload.category, fulfillmentMode: payload.fulfillmentMode,
      priceCents: payload.priceCents, imageUrl: payload.imageUrl,
      customizationOptions: options.length ? [{ name: 'Personalización', options, required: false }] : [],
      available: payload.available,
      availabilityMessage: payload.available ? '' : 'No disponible por falta de ingredientes',
      updatedAt: serverTimestamp(),
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
    activeVisits = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderActiveTables(); renderMetrics();
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

function subscribeMetricsPayments() {
  unsubscribePayments?.();
  const { collection, onSnapshot } = services.firestore;
  unsubscribePayments = onSnapshot(collection(services.db, 'payments'), (snapshot) => {
    recordedPayments = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    $('#metrics-feedback').textContent = 'Datos actualizados en tiempo real.';
    renderMetrics();
  }, (error) => {
    console.error('No se pudieron cargar los pagos para las métricas.', error);
    $('#metrics-feedback').textContent = 'No se pudieron cargar los pagos. Revisa la conexión y las reglas de Firestore.';
  });
}

function recommendationDateKey() {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'America/Managua', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dailyProductPrice(item) {
  return Number.isSafeInteger(item?.priceCents) ? item.priceCents : Math.round(Number(item?.price ?? 0) * 100);
}

function renderStaffDailySpecial() {
  const card = $('#staff-daily-special');
  if (!card) return;
  const special = menuRecommendations.dailySpecial;
  const product = menuItems.find((item) => item.id === special?.productId && item.available === true);
  if (!['cocina', 'mesero'].includes(staffUser?.role) || special?.dateKey !== recommendationDateKey() || !product) {
    card.hidden = true;
    return;
  }
  const discount = Math.min(50, Math.max(0, Number(special.discountPercent) || 0));
  const basePrice = dailyProductPrice(product);
  $('#staff-daily-special-name').textContent = product.name;
  $('#staff-daily-special-price').textContent = formatCents(Math.round(basePrice * (100 - discount) / 100));
  $('#staff-daily-special-original-price').textContent = formatCents(basePrice);
  $('#staff-daily-special-original-price').hidden = discount <= 0;
  $('#staff-daily-special-discount').textContent = discount > 0 ? `${discount}% de descuento` : 'Sin descuento';
  const image = $('#staff-daily-special-image');
  image.replaceChildren();
  image.classList.remove('staff-daily-special-image-fallback');
  const imageUrl = typeof product.imageUrl === 'string' && /^https:\/\//i.test(product.imageUrl) ? product.imageUrl : '';
  if (imageUrl) {
    const photo = document.createElement('img'); photo.src = imageUrl; photo.alt = ''; photo.loading = 'lazy'; image.append(photo);
  } else {
    image.classList.add('staff-daily-special-image-fallback');
    const mark = document.createElement('span'); mark.textContent = '✳'; image.append(mark);
  }
  card.hidden = false;
}

function updateDailySpecialPricePreview() {
  const product = menuItems.find((item) => item.id === $('#daily-special-product').value);
  if (!product) return;
  const discount = Math.min(50, Math.max(0, Number($('#daily-special-discount').value) || 0));
  const price = Math.round(dailyProductPrice(product) * (100 - discount) / 100);
  $('#daily-special-price-preview').textContent = formatCents(price);
  $('#daily-special-discount-range').value = String(discount);
}

function chooseDailySpecial(product) {
  $('#daily-special-product').value = product.id;
  $('#daily-special-selected-name').textContent = product.name;
  $('#daily-special-selected-category').textContent = String(product.category ?? product.categoryId ?? 'Platillo').toUpperCase();
  $('#daily-special-selected-description').textContent = product.description || 'Una recomendación especial de la casa.';
  const image = $('#daily-special-selected-image');
  image.replaceChildren();
  image.classList.remove('daily-special-image-fallback');
  const imageUrl = typeof product.imageUrl === 'string' && /^https:\/\//i.test(product.imageUrl) ? product.imageUrl : '';
  if (imageUrl) {
    const photo = document.createElement('img'); photo.src = imageUrl; photo.alt = product.name; photo.loading = 'lazy'; image.append(photo);
  } else {
    image.classList.add('daily-special-image-fallback');
    const mark = document.createElement('span'); mark.textContent = '✳'; mark.setAttribute('aria-hidden', 'true'); image.append(mark);
  }
  const current = menuRecommendations.dailySpecial;
  const currentDiscount = current?.dateKey === recommendationDateKey() && current.productId === product.id ? Number(current.discountPercent) || 0 : 0;
  $('#daily-special-discount').value = String(Math.min(50, currentDiscount));
  updateDailySpecialPricePreview();
  $('#daily-special-feedback').textContent = '';
  $('#daily-special-choice-view').hidden = true;
  $('#daily-special-edit-view').hidden = false;
  $('#daily-special-title').textContent = 'Define la promoción';
  $('#daily-special-discount').focus();
}

function openDailySpecialPrompt(force = false) {
  if (staffUser?.role !== 'admin') return;
  let available = menuItems.filter((item) => item.available === true && !/^(Bebidas|Alcohol)$/i.test(String(item.category ?? item.categoryId ?? '')));
  if (!available.length) available = menuItems.filter((item) => item.available === true);
  const select = $('#daily-special-product');
  select.replaceChildren();
  const choices = $('#daily-special-choices');
  choices.replaceChildren();
  $('#daily-special-choice-view').hidden = false;
  $('#daily-special-edit-view').hidden = true;
  $('#daily-special-title').textContent = 'Elige el platillo del día';
  if (!available.length) {
    select.add(new Option('Primero agrega un platillo disponible', ''));
    $('#daily-special-feedback').textContent = 'No hay productos disponibles para recomendar.';
    return;
  }
  const counts = new Map((menuRecommendations.salesByProduct ?? []).map((row) => [row.productId, Number(row.units) || 0]));
  const ranked = [...available].sort((a, b) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0) || String(a.name).localeCompare(String(b.name), 'es'));
  const dailyOffset = [...recommendationDateKey()].reduce((sum, character) => sum + character.charCodeAt(0), 0) % ranked.length;
  const automaticProduct = ranked[dailyOffset];
  const today = recommendationDateKey();
  const current = menuRecommendations.dailySpecial;
  const currentProduct = current?.dateKey === today ? available.find((item) => item.id === current.productId) : null;
  const suggestions = [];
  const addSuggestion = (product) => { if (product && !suggestions.some((entry) => entry.id === product.id) && suggestions.length < 3) suggestions.push(product); };
  addSuggestion(ranked[0]);
  addSuggestion(ranked.at(-1));
  addSuggestion(currentProduct);
  addSuggestion(automaticProduct);
  ranked.forEach(addSuggestion);
  const suggestionLabels = new Map([[ranked[0]?.id, 'NECESITA IMPULSO'], [ranked.at(-1)?.id, 'MÁS VENDIDO'], [automaticProduct.id, 'RECOMENDACIÓN DE HOY']]);
  if (currentProduct) suggestionLabels.set(currentProduct.id, 'PUBLICADO HOY');
  suggestions.forEach((item) => {
    select.add(new Option(item.name, item.id));
    const card = document.createElement('button'); card.type = 'button'; card.className = 'daily-choice-card'; card.setAttribute('aria-label', `Elegir ${item.name} como platillo del día`);
    const media = document.createElement('span'); media.className = 'daily-choice-media';
    const imageUrl = typeof item.imageUrl === 'string' && /^https:\/\//i.test(item.imageUrl) ? item.imageUrl : '';
    if (imageUrl) { const image = document.createElement('img'); image.src = imageUrl; image.alt = ''; image.loading = 'lazy'; media.append(image); }
    else { media.classList.add('daily-choice-media-fallback'); const mark = document.createElement('span'); mark.textContent = '✳'; media.append(mark); }
    const tag = document.createElement('span'); tag.className = 'daily-choice-tag'; tag.textContent = suggestionLabels.get(item.id) ?? 'OPCIÓN DEL MENÚ'; media.append(tag);
    const copy = document.createElement('span'); copy.className = 'daily-choice-copy';
    const name = document.createElement('strong'); name.textContent = item.name;
    const meta = document.createElement('span'); meta.textContent = `${String(item.category ?? item.categoryId ?? 'Platillo')} · ${formatCents(dailyProductPrice(item))}`;
    copy.append(name, meta);
    const arrow = document.createElement('span'); arrow.className = 'daily-choice-arrow'; arrow.textContent = '→'; arrow.setAttribute('aria-hidden', 'true');
    card.append(media, copy, arrow); card.addEventListener('click', () => chooseDailySpecial(item)); choices.append(card);
  });
  $('#daily-special-discount').value = '0';
  $('#daily-special-feedback').textContent = '';
  if (current?.dateKey === today && available.some((item) => item.id === current.productId)) {
    select.value = current.productId;
    $('#daily-special-reason').textContent = 'Elige otra recomendación o vuelve a seleccionar el platillo publicado para ajustar su promoción.';
  } else {
    $('#daily-special-reason').textContent = menuRecommendations.salesByProduct?.length
      ? 'Compara el favorito, el que necesita impulso y la recomendación calculada para hoy.'
      : `Aún hay pocos datos de ventas. La recomendación de hoy es ${automaticProduct.name}; también puedes elegir cualquiera de las otras opciones.`;
  }
  if (force || (current?.dateKey !== today && localStorage.getItem(`mesaexpress-daily-later:${today}`) !== 'true')) {
    if (!$('#daily-special-dialog').open) $('#daily-special-dialog').showModal();
  }
}

function subscribeMenuRecommendations() {
  unsubscribeRecommendations?.();
  const { doc, onSnapshot } = services.firestore;
  unsubscribeRecommendations = onSnapshot(doc(services.db, 'menuRecommendations', 'current'), (snapshot) => {
    menuRecommendations = snapshot.exists() ? snapshot.data() : {};
    renderStaffDailySpecial();
    openDailySpecialPrompt(false);
  }, (error) => console.info('No se pudo cargar la configuración de recomendaciones.', error));
}

async function saveDailySpecial() {
  const productId = $('#daily-special-product').value;
  const product = menuItems.find((item) => item.id === productId && item.available === true);
  const discountPercent = Number($('#daily-special-discount').value);
  if (!product) { $('#daily-special-feedback').textContent = 'Elige un platillo disponible.'; return; }
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 50) { $('#daily-special-feedback').textContent = 'El descuento debe estar entre 0 y 50%.'; return; }
  const button = $('#save-daily-special'); button.disabled = true; button.textContent = 'Publicando…';
  try {
    const { doc, serverTimestamp, setDoc } = services.firestore;
    await setDoc(doc(services.db, 'menuRecommendations', 'current'), {
      dailySpecial: { productId, discountPercent, dateKey: recommendationDateKey(), source: 'staff', productName: product.name },
      updatedAt: serverTimestamp(),
    }, { merge: true });
    localStorage.removeItem(`mesaexpress-daily-later:${recommendationDateKey()}`);
    $('#daily-special-dialog').close(); staffNotice('Platillo del día publicado en el menú.', 'success');
  } catch (error) { console.error(error); $('#daily-special-feedback').textContent = error?.message ?? 'No se pudo publicar el platillo del día.'; }
  finally { button.disabled = false; button.innerHTML = 'Publicar platillo del día <span aria-hidden="true">→</span>'; }
}

function renderOrders() {
  const container = $('#staff-orders');
  const visibleOrders = orders.filter(isVisible);
  $('#active-count').textContent = String(orders.filter(orderNeedsPreparation).length);
  container.replaceChildren();
  if (!visibleOrders.length) {
    $('#orders-feedback').hidden = false;
    const titles = { activas: 'Cocina al día', recibido: 'No hay productos por iniciar', en_preparacion: 'No hay productos en preparación', listo: 'No hay productos listos en cocina', entregado: 'Todavía no hay pedidos completamente entregados' };
    setFeedback(titles[currentFilter] ?? 'No hay productos para mostrar', 'Los productos que requieren preparación aparecerán aquí en tiempo real.');
    renderDeliveries();
    return;
  }
  $('#orders-feedback').hidden = true;
  visibleOrders.forEach((order) => container.append(createOrderCard(order)));
  renderDeliveries();
}

function createOrderCard(order) {
  const card = document.createElement('article');
  card.className = `staff-order-card staff-order-state-${orderProgressStatus(order)}${newOrderIds.has(order.id) ? ' staff-order-new' : ''}`;
  const header = document.createElement('div'); header.className = 'staff-card-head';
  const identity = document.createElement('div');
  const number = document.createElement('p'); number.className = 'staff-order-number'; number.textContent = `Pedido ${order.orderNumber ?? order.id.slice(0, 6).toUpperCase()}`;
  const table = document.createElement('strong'); table.className = 'staff-table-number'; table.textContent = `Mesa ${String(order.tableId ?? '—').padStart(2, '0')}`;
  identity.append(number, table);
  const orderStatus = orderProgressStatus(order);
  const status = document.createElement('span'); status.className = `staff-status status-${orderStatus}`; status.textContent = statusLabels[orderStatus] ?? 'Estado desconocido';
  header.append(identity, status);
  const meta = document.createElement('div'); meta.className = 'staff-card-meta';
  const time = document.createElement('span'); time.textContent = orderTime(order.createdAt);
  const total = document.createElement('span'); total.textContent = formatCents(order.totalCents);
  meta.append(time, total);
  const preview = document.createElement('div'); preview.className = 'staff-card-items';
  const lines = orderItemsWithRouting(order).map((item, index) => ({ ...item, index }));
  const kitchenLines = currentFilter === 'entregado' ? lines.filter((item) => item.status === 'entregado') : lines.filter((item) => item.fulfillmentMode !== 'direct' && (currentFilter === 'activas' ? ['recibido', 'en_preparacion'].includes(item.status) : item.status === currentFilter));
  kitchenLines.forEach((item) => {
    const line = document.createElement('div'); line.className = `staff-kitchen-line staff-kitchen-line-state-${item.status}`;
    const copy = document.createElement('div'); copy.className = 'staff-kitchen-line-copy';
    const itemTitle = document.createElement('strong'); itemTitle.textContent = `${item.quantity} × ${item.name}`;
    const metaText = [fulfillmentLabels[item.fulfillmentMode] ?? 'Cocina', formatOrderItemStatus(item, order)].join(' · ');
    const itemMeta = document.createElement('small'); itemMeta.textContent = metaText;
    const customization = [...Object.values(item.customizations ?? {}), item.note].filter(Boolean).join(' · ');
    copy.append(itemTitle, itemMeta);
    if (customization) { const detail = document.createElement('small'); detail.className = 'staff-kitchen-line-detail'; detail.textContent = customization; copy.append(detail); }
    line.append(copy);
    const next = { recibido: ['en_preparacion', 'Iniciar preparación'], en_preparacion: ['listo', 'Marcar listo'] }[item.status];
    if (next && canChangeOrderItemStatus(next[0], 'kitchen')) {
      const advance = document.createElement('button'); advance.type = 'button'; advance.className = 'staff-line-advance';
      const key = `${order.id}:${item.index}`; advance.disabled = inFlightOrderId === key;
      advance.textContent = advance.disabled ? 'Actualizando…' : next[1];
      advance.addEventListener('click', () => changeOrderItemStatus(order.id, item.index, next[0], 'kitchen'));
      line.append(advance);
    }
    preview.append(line);
  });
  const open = document.createElement('button'); open.type = 'button'; open.className = 'staff-detail-button'; open.textContent = 'Ver pedido completo →';
  open.addEventListener('click', () => openOrder(order.id));
  card.append(header, meta, preview);
  card.append(open);
  return card;
}

function renderDeliveries() {
  const container = $('#staff-deliveries');
  if (!container) return;
  const readyOrders = orders.filter((order) => orderItemsWithRouting(order).some((item) => item.status === 'listo'));
  const readyUnits = readyOrders.reduce((sum, order) => sum + orderItemsWithRouting(order).reduce((lineSum, item) => lineSum + (item.status === 'listo' ? Math.max(0, Number(item.quantity) || 0) : 0), 0), 0);
  const badge = $('#delivery-count'); badge.textContent = String(readyUnits); badge.hidden = readyUnits === 0;
  container.replaceChildren();
  if (!readyOrders.length) {
    $('#deliveries-feedback').hidden = false;
    $('#deliveries-feedback').replaceChildren();
    const title = document.createElement('strong'); title.textContent = 'No hay productos esperando entrega';
    const copy = document.createElement('p'); copy.textContent = 'Los productos listos y las bebidas de entrega directa aparecerán aquí.';
    $('#deliveries-feedback').append(title, copy);
    return;
  }
  $('#deliveries-feedback').hidden = true;
  readyOrders.forEach((order) => {
    const deliveryStatus = orderProgressStatus(order);
    const card = document.createElement('article'); card.className = `staff-order-card delivery-card delivery-card-state-${deliveryStatus}`;
    const header = document.createElement('div'); header.className = 'staff-card-head';
    const identity = document.createElement('div');
    const number = document.createElement('p'); number.className = 'staff-order-number'; number.textContent = `Pedido ${order.orderNumber ?? order.id.slice(0, 6).toUpperCase()}`;
    const table = document.createElement('strong'); table.className = 'staff-table-number'; table.textContent = `Mesa ${String(order.tableId ?? '—').padStart(2, '0')}`;
    identity.append(number, table);
    const status = document.createElement('span'); status.className = 'staff-status status-listo'; status.textContent = orderProgressStatus(order) === 'listo' ? 'Listo para entregar' : 'Entrega parcial';
    header.append(identity, status); card.append(header);
    const meta = document.createElement('div'); meta.className = 'staff-card-meta';
    const time = document.createElement('span'); time.textContent = orderTime(order.createdAt);
    const total = document.createElement('span'); total.textContent = formatCents(order.totalCents); meta.append(time, total); card.append(meta);
    const readyItems = document.createElement('div'); readyItems.className = 'delivery-items';
    orderItemsWithRouting(order).forEach((item, index) => {
      if (item.status !== 'listo') return;
      const row = document.createElement('article'); row.className = 'delivery-item';
      const copy = document.createElement('div'); copy.className = 'delivery-item-copy';
      const name = document.createElement('strong'); name.textContent = `${item.quantity} × ${item.name}`;
      const station = document.createElement('small'); station.textContent = fulfillmentLabels[item.fulfillmentMode ?? 'kitchen'] ?? 'Cocina';
      copy.append(name, station);
      const details = [...Object.values(item.customizations ?? {}), item.note].filter(Boolean).join(' · ');
      if (details) { const note = document.createElement('small'); note.className = 'staff-kitchen-line-detail'; note.textContent = details; copy.append(note); }
      row.append(copy);
      if (canChangeOrderItemStatus('entregado', 'delivery')) {
        const delivered = document.createElement('button'); delivered.type = 'button'; delivered.className = 'staff-primary delivery-confirm-button';
        const key = `${order.id}:${index}`; delivered.disabled = inFlightOrderId === key;
        delivered.textContent = delivered.disabled ? 'Actualizando…' : 'Marcar entregado';
        delivered.addEventListener('click', () => changeOrderItemStatus(order.id, index, 'entregado', 'delivery'));
        row.append(delivered);
      } else {
        const note = document.createElement('small'); note.className = 'detail-queue-note'; note.textContent = 'La entrega corresponde al Mesero.'; row.append(note);
      }
      readyItems.append(row);
    });
    card.append(readyItems);
    const open = document.createElement('button'); open.type = 'button'; open.className = 'staff-detail-button'; open.textContent = 'Ver pedido completo →'; open.addEventListener('click', () => openOrder(order.id)); card.append(open);
    container.append(card);
  });
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
  const currentOrderStatus = orderProgressStatus(order);
  const status = document.createElement('span'); status.className = `staff-status status-${currentOrderStatus}`; status.textContent = statusLabels[currentOrderStatus] ?? 'Estado desconocido';
  const itemHeading = document.createElement('h3'); itemHeading.className = 'detail-section-title'; itemHeading.textContent = 'Productos';
  const list = document.createElement('div'); list.className = 'detail-items';
  orderItemsWithRouting(order).forEach((item, index) => {
    const row = document.createElement('article'); row.className = 'detail-item';
    const itemHead = document.createElement('div'); itemHead.className = 'detail-item-head';
    const name = document.createElement('strong'); name.textContent = `${item.quantity} × ${item.name}`;
    const price = document.createElement('span'); price.textContent = formatCents(item.lineTotalCents);
    itemHead.append(name, price); row.append(itemHead);
    const itemStatus = item.status;
    row.classList.add(`detail-item-state-${itemStatus}`);
    const itemMode = item.fulfillmentMode;
    const itemMeta = document.createElement('p'); itemMeta.className = 'detail-customizations'; itemMeta.textContent = `${fulfillmentLabels[itemMode] ?? 'Cocina'} · ${itemStatusLabels[itemStatus] ?? 'Pendiente'}`; row.append(itemMeta);
    const options = Object.entries(item.customizations ?? {});
    if (options.length) { const custom = document.createElement('p'); custom.className = 'detail-customizations'; custom.textContent = options.map(([key, value]) => `${key}: ${value}`).join(' · '); row.append(custom); }
    if (item.note) { const note = document.createElement('p'); note.className = 'detail-note'; note.textContent = `Nota: ${item.note}`; row.append(note); }
    const next = itemMode !== 'direct' ? { recibido: ['en_preparacion', 'Iniciar preparación'], en_preparacion: ['listo', 'Marcar listo'] }[itemStatus] : null;
    if (next && canChangeOrderItemStatus(next[0], 'detail')) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'staff-detail-button detail-line-action';
      const key = `${order.id}:${index}`; button.disabled = inFlightOrderId === key; button.textContent = button.disabled ? 'Actualizando…' : next[1];
      button.addEventListener('click', () => changeOrderItemStatus(order.id, index, next[0], 'detail')); row.append(button);
    } else if (next) {
      const note = document.createElement('small'); note.className = 'detail-queue-note'; note.textContent = 'Estado visible · los cambios de preparación corresponden a Cocina.'; row.append(note);
    } else if (itemMode === 'direct' && itemStatus === 'listo') {
      const queued = document.createElement('small'); queued.className = 'detail-queue-note'; queued.textContent = 'Disponible en la pestaña Entregas.'; row.append(queued);
    }
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
  const error = document.createElement('p'); error.id = 'transition-feedback'; error.className = 'transition-feedback'; error.setAttribute('role', 'status');
  body.append(eyebrow, heading, status, itemHeading, list, total, error);
  if (orderFullyDelivered(order)) { const delivered = document.createElement('p'); delivered.className = 'delivered-message'; delivered.textContent = `Pedido completamente entregado ${orderTime(order.deliveredAt)}`; body.append(delivered); }
  content.append(body);
}

async function changeOrderItemStatus(orderId, itemIndex, nextStatus, source = 'kitchen') {
  if (!canChangeOrderItemStatus(nextStatus, source)) {
    const message = nextStatus === 'entregado' ? 'Solo Mesero puede confirmar la entrega.' : 'Solo Cocina puede cambiar el estado de preparación.';
    if (source === 'detail') { const feedback = $('#transition-feedback'); if (feedback) feedback.textContent = message; }
    else staffNotice(message, 'error');
    return;
  }
  const operationKey = `${orderId}:${itemIndex}`;
  inFlightOrderId = operationKey;
  renderOrders(); renderOrderDetails(); renderDeliveries();
  try {
    const { doc, runTransaction, serverTimestamp } = services.firestore;
    const orderRef = doc(services.db, 'orders', orderId);
    await runTransaction(services.db, async (transaction) => {
      const snapshot = await transaction.get(orderRef);
      if (!snapshot.exists()) throw new Error('El pedido ya no existe. Actualiza la pantalla.');
      const data = snapshot.data();
      const savedItems = Array.isArray(data.items) ? data.items : [];
      if (!savedItems[itemIndex]) throw new Error('El artículo cambió. Actualiza la pantalla e inténtalo de nuevo.');
      const items = savedItems.map((item) => {
        const fulfillmentMode = fulfillmentModeForItem(item);
        const status = fulfillmentMode === 'direct' && (!item.status || item.status === 'recibido')
          ? 'listo'
          : item.status ?? data.status ?? 'recibido';
        return { ...item, fulfillmentMode, status };
      });
      const current = items[itemIndex].status;
      const validNext = { recibido: 'en_preparacion', en_preparacion: 'listo', listo: 'entregado' }[current];
      if (validNext !== nextStatus) throw new Error(`El artículo ya cambió a «${itemStatusLabels[current] ?? current}».`);
      items[itemIndex] = { ...items[itemIndex], status: nextStatus };
      const nextOrderStatus = aggregateOrderStatus(items, data.status ?? 'recibido');
      const now = serverTimestamp();
      const update = { items, status: nextOrderStatus, updatedAt: now, updatedBy: staffUser.uid };
      const timestampField = { en_preparacion: 'preparingAt', listo: 'readyAt', entregado: 'deliveredAt' }[nextOrderStatus];
      if (timestampField && nextOrderStatus !== data.status) update[timestampField] = now;
      let visitRef = null; let visitSnapshot = null;
      if (nextOrderStatus === 'entregado' && data.status !== 'entregado' && data.visitId) {
        visitRef = doc(services.db, 'visits', data.visitId);
        visitSnapshot = await transaction.get(visitRef);
      }
      transaction.update(orderRef, update);
      if (visitSnapshot?.exists() && visitSnapshot.data().status === 'open') {
        transaction.update(visitRef, { lastOrderDeliveredAt: now, lastOrderDeliveredOrderId: orderId, updatedAt: now });
      }
    });
    const message = nextStatus === 'entregado' ? 'Artículo marcado como entregado.' : nextStatus === 'listo' ? 'Artículo listo · enviado a Entregas.' : 'Preparación iniciada.';
    staffNotice(message, 'success');
  } catch (error) {
    console.error('No se pudo actualizar el estado.', error);
    const copy = error?.code?.includes('permission-denied') ? 'Tu sesión no tiene autorización de personal.' : error?.code?.includes('failed-precondition') ? 'El pedido cambió en otra pantalla. Revisa su estado e inténtalo de nuevo.' : error?.message ?? 'No se pudo actualizar el pedido.';
    if (source === 'detail') {
      const feedback = $('#transition-feedback'); if (feedback) feedback.textContent = copy;
    } else staffNotice(copy, 'error');
  } finally {
    inFlightOrderId = null;
    renderOrders(); renderOrderDetails(); renderDeliveries();
  }
}

function subscribeOrders() {
  if (unsubscribeOrders) unsubscribeOrders();
  const { collection, onSnapshot, orderBy, query } = services.firestore;
  const ordersQuery = query(collection(services.db, 'orders'), orderBy('createdAt', 'desc'));
  firstSnapshot = true;
  unsubscribeOrders = onSnapshot(ordersQuery, (snapshot) => {
    const initialOrderSnapshot = firstSnapshot;
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
    if (initialOrderSnapshot) {
      updateMenuRecommendationsFromPaidOrders(orders.filter((order) => order.paymentStatus === 'paid'))
        .catch((error) => console.info('No se pudo preparar el historial para las recomendaciones.', error));
    }
    $('#connection-state').classList.remove('connection-offline');
    $('#connection-state').innerHTML = '<i></i> En vivo';
    renderOrders();
    renderMetrics();
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
  $('#download-staff-invoice').addEventListener('click', downloadCurrentStaffInvoice);
  $('#print-staff-invoice').addEventListener('click', printCurrentStaffInvoice);
  $('#add-menu-item').addEventListener('click', () => openMenuItemForm());
  $('#daily-special-manage').addEventListener('click', () => openDailySpecialPrompt(true));
  $('#save-daily-special').addEventListener('click', saveDailySpecial);
  $('#daily-special-back').addEventListener('click', () => {
    $('#daily-special-edit-view').hidden = true; $('#daily-special-choice-view').hidden = false;
    $('#daily-special-title').textContent = 'Elige el platillo del día'; $('#daily-special-reason').textContent = 'Escoge una tarjeta para revisar el platillo y su descuento.';
  });
  $('#daily-special-discount').addEventListener('input', () => {
    const input = $('#daily-special-discount');
    input.value = String(Math.min(50, Math.max(0, Number(input.value) || 0)));
    updateDailySpecialPricePreview();
  });
  $('#daily-special-discount-range').addEventListener('input', () => {
    $('#daily-special-discount').value = $('#daily-special-discount-range').value; updateDailySpecialPricePreview();
  });
  $('#later-daily-special').addEventListener('click', () => {
    localStorage.setItem(`mesaexpress-daily-later:${recommendationDateKey()}`, 'true');
    $('#daily-special-dialog').close();
  });
  $('#menu-search').addEventListener('input', renderMenuItems);
  $('#menu-availability-filter').addEventListener('change', renderMenuItems);
  ['metrics-period', 'metrics-category-filter', 'metrics-item-filter'].forEach((id) => $(`#${id}`).addEventListener('change', renderMetrics));
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
  $('#menu-category').addEventListener('change', () => {
    if (!editingMenuItemId) {
      $('#menu-preparation-mode').value = /^(Bebidas|Alcohol)$/i.test($('#menu-category').value) ? 'direct' : 'kitchen';
    }
  });
  menuItemDialog.addEventListener('close', () => { editingMenuItemId = null; pendingMenuItemId = null; });
  window.addEventListener('online', () => { $('#connection-state').classList.remove('connection-offline'); $('#connection-state').innerHTML = '<i></i> En vivo'; });
  window.addEventListener('offline', () => { $('#connection-state').classList.add('connection-offline'); $('#connection-state').textContent = 'Sin conexión'; staffNotice('Sin conexión a Internet. Se reintentará la sincronización.', 'error'); });
  document.querySelectorAll('.filter-chip').forEach((button) => button.addEventListener('click', () => filterOrders(button.dataset.filter)));
  document.querySelectorAll('.staff-tab').forEach((button) => button.addEventListener('click', () => {
    activateStaffSection(button.dataset.section);
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
    if (unsubscribePayments) { unsubscribePayments(); unsubscribePayments = null; }
    if (unsubscribeRecommendations) { unsubscribeRecommendations(); unsubscribeRecommendations = null; }
    clearInterval(reminderTimer);
    orders = []; activeVisits = []; menuItems = []; recordedPayments = []; renderOrders(); renderMetrics();
    if (!user) { staffUser = null; renderStaffDailySpecial(); showLogin(loginError.textContent); return; }
    loginError.textContent = '';
    try {
      const profile = await firestoreApi.getDoc(firestoreApi.doc(services.db, 'staffUsers', user.uid));
      if (currentVersion !== authChangeVersion) return;
      const profileData = profile.exists() ? profile.data() : null;
      const role = normalizedStaffRole(profileData?.role);
      if (!profileData || profileData.enabled !== true || !role) {
        await authApi.signOut(services.auth);
        showLogin('La cuenta inició sesión, pero todavía no está autorizada como personal. Contacta a quien administra Firebase.');
        return;
      }
      // Keep the Auth UID alongside the Firestore staff profile; profileData itself
      // contains role/enabled but does not inherently contain an `uid` field.
      staffUser = { ...profileData, role, uid: user.uid }; showDashboard(); subscribeOrders(); subscribeStaffOperations(); subscribeMenuItems(); subscribeMenuRecommendations();
      if (role === 'admin') subscribeMetricsPayments();
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
