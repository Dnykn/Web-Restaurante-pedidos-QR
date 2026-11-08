const money = new Intl.NumberFormat('es-NI', { style: 'currency', currency: 'NIO' });

export function formatInvoiceCents(value) {
  return money.format((Number(value) || 0) / 100);
}

function dateValue(value) {
  if (value?.toDate) return value.toDate();
  const date = value instanceof Date ? value : new Date(value ?? NaN);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateLabel(value) {
  const date = dateValue(value);
  return date ? new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium', timeStyle: 'short' }).format(date) : 'Fecha no disponible';
}

function methodLabel(method) {
  return method === 'cash' ? 'Efectivo' : method === 'other_physical' ? 'Otro medio físico' : 'No especificado';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export function invoiceMarkup(invoice) {
  const rows = (invoice?.items ?? []).map((item) => {
    const details = [
      item.customizations && Object.values(item.customizations).filter(Boolean).join(' · '),
      item.note,
    ].filter(Boolean).join(' · ');
    return `<div class="invoice-line"><div><strong>${escapeHtml(item.name)} · ${Number(item.quantity) || 0} u.</strong>${details ? `<small class="invoice-line-detail">${escapeHtml(details)}</small>` : ''}<small class="invoice-line-price">${formatInvoiceCents(item.unitPriceCents)} c/u</small></div><b>${formatInvoiceCents(item.lineTotalCents)}</b></div>`;
  }).join('');
  const table = String(invoice?.tableId ?? '—').padStart(2, '0');
  return `<div class="invoice-preview"><div class="invoice-top-band"><div class="invoice-brand"><span class="brand-mark">M</span><strong>mesa<span>express</span></strong></div><p class="eyebrow">COMPROBANTE DE PAGO</p><div class="invoice-headline"><h3>Factura de consumo</h3><span class="invoice-table-label">Mesa ${escapeHtml(table)}</span></div></div><div class="invoice-meta"><span>Fecha</span><strong>${escapeHtml(dateLabel(invoice?.paidAt))}</strong><span>Método de pago</span><strong>${escapeHtml(methodLabel(invoice?.method))}</strong><span>Referencia</span><strong>${escapeHtml(String(invoice?.paymentId ?? '').slice(0, 8).toUpperCase() || '—')}</strong></div><div class="invoice-lines">${rows || '<p>Sin productos registrados.</p>'}</div><div class="invoice-totals"><p><span>Subtotal</span><strong>${formatInvoiceCents(invoice?.subtotalCents)}</strong></p><p><span>Servicio</span><strong>${formatInvoiceCents(invoice?.serviceChargeCents)}</strong></p><p class="invoice-total"><span>Total pagado</span><strong>${formatInvoiceCents(invoice?.totalCents)}</strong></p></div><p class="invoice-thanks">Gracias por visitarnos.</p></div>`;
}

function winAnsiHex(value) {
  const special = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };
  let hex = '';
  for (const character of String(value ?? '')) {
    const code = character.codePointAt(0);
    if (code <= 0x7f || (code >= 0xa0 && code <= 0xff)) hex += code.toString(16).padStart(2, '0');
    else if (special[character]) hex += special[character].toString(16).padStart(2, '0');
    else hex += '3f';
  }
  return `<${hex.toUpperCase()}>`;
}

function wrapLine(value, limit = 72) {
  const words = String(value ?? '').split(/\s+/).filter(Boolean);
  const output = [];
  let line = '';
  for (const word of words) {
    if (line && `${line} ${word}`.length > limit) { output.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) output.push(line);
  return output.length ? output : [''];
}

function pdfText(x, y, value, size = 10, color = '0.14 0.22 0.18', bold = false) {
  return `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${color} rg 1 0 0 1 ${x} ${y} Tm ${winAnsiHex(value)} Tj ET\n`;
}

function pdfRect(x, y, width, height, color) {
  return `${color} rg ${x} ${y} ${width} ${height} re f\n`;
}

function pdfRightText(right, y, value, size = 10, color = '0.14 0.22 0.18', bold = false) {
  const approximateWidth = String(value).length * size * (bold ? 0.54 : 0.49);
  return pdfText(Math.max(48, right - approximateWidth), y, value, size, color, bold);
}

function pdfPageStart(table, invoice, continuation = false) {
  const paper = '0.985 0.985 0.965';
  const ink = '0.08 0.23 0.19';
  const mint = '0.72 0.87 0.78';
  const lime = '0.79 0.87 0.55';
  const coral = '0.83 0.45 0.31';
  let content = pdfRect(0, 0, 595, 842, paper);
  content += pdfRect(0, 662, 595, 180, ink);
  content += pdfRect(0, 658, 595, 4, lime);
  content += pdfRect(518, 776, 28, 4, coral);
  content += pdfRect(47, 776, 36, 36, '0.12 0.35 0.29');
  content += pdfText(59, 787, 'M', 19, '1 1 1', true);
  content += pdfText(94, 793, 'mesa', 17, '1 1 1', true);
  content += pdfText(136, 793, 'express', 17, mint);
  content += pdfText(47, 735, continuation ? 'DETALLE DE CONSUMO' : 'COMPROBANTE DE PAGO', 8, lime, true);
  content += pdfText(47, 697, continuation ? 'Continuación de factura' : 'Factura de consumo', 23, '1 1 1', true);
  content += pdfRect(451, 690, 96, 40, '0.13 0.34 0.28');
  content += pdfText(462, 714, 'MESA', 7, mint, true);
  content += pdfText(462, 695, table, 16, '1 1 1', true);
  if (!continuation) {
    const metaY = 588;
    content += pdfRect(47, metaY, 501, 52, '1 1 1');
    content += pdfRect(214, metaY + 9, 1, 34, '0.88 0.90 0.86');
    content += pdfRect(381, metaY + 9, 1, 34, '0.88 0.90 0.86');
    content += pdfText(61, metaY + 34, 'FECHA', 7, '0.43 0.52 0.46', true);
    content += pdfText(61, metaY + 16, dateLabel(invoice?.paidAt), 9, ink, true);
    content += pdfText(229, metaY + 34, 'MÉTODO DE PAGO', 7, '0.43 0.52 0.46', true);
    content += pdfText(229, metaY + 16, methodLabel(invoice?.method), 9, ink, true);
    content += pdfText(396, metaY + 34, 'REFERENCIA', 7, '0.43 0.52 0.46', true);
    content += pdfText(396, metaY + 16, String(invoice?.paymentId ?? '').slice(0, 8).toUpperCase() || '—', 9, ink, true);
  }
  const tableHeaderY = continuation ? 620 : 552;
  content += pdfRect(47, tableHeaderY, 501, 28, '0.91 0.94 0.89');
  content += pdfText(59, tableHeaderY + 10, 'PRODUCTO', 7, ink, true);
  content += pdfRightText(378, tableHeaderY + 10, 'CANT.', 7, ink, true);
  content += pdfRightText(459, tableHeaderY + 10, 'PRECIO', 7, ink, true);
  content += pdfRightText(535, tableHeaderY + 10, 'TOTAL', 7, ink, true);
  return { content, y: tableHeaderY - 4, colors: { paper, ink, mint, lime, coral } };
}

function pdfFooter(content, pageNumber) {
  let result = content + pdfRect(47, 48, 501, 1, '0.86 0.89 0.84');
  result += pdfText(48, 31, 'MESAEXPRESS  ·  BUENA COMIDA, A TU RITMO', 7, '0.43 0.52 0.46', true);
  result += pdfRightText(547, 31, `PÁG. ${pageNumber}`, 7, '0.43 0.52 0.46', true);
  return result;
}

export function downloadInvoicePdf(invoice) {
  const table = String(invoice?.tableId ?? '—').padStart(2, '0');
  const moneyFormat = (cents) => formatInvoiceCents(cents);
  const ink = '0.08 0.23 0.19';
  const muted = '0.43 0.52 0.46';
  const pages = [];
  let page = pdfPageStart(table, invoice);
  let rowIndex = 0;
  for (const item of invoice?.items ?? []) {
    const nameLines = wrapLine(String(item.name ?? 'Producto'), 40).slice(0, 3);
    const details = [item.customizations && Object.values(item.customizations).filter(Boolean).join(', '), item.note].filter(Boolean).join(' · ');
    const detailLines = details ? wrapLine(details.slice(0, 130), 58).slice(0, 2) : [];
    const rowHeight = Math.max(40, 18 + nameLines.length * 12 + detailLines.length * 10);
    if (page.y - rowHeight < 142) { pages.push(page.content); page = pdfPageStart(table, invoice, true); }
    const top = page.y;
    if (rowIndex % 2 === 1) page.content += pdfRect(47, top - rowHeight + 5, 501, rowHeight, '0.96 0.97 0.945');
    nameLines.forEach((line, index) => { page.content += pdfText(59, top - 14 - index * 12, line, 9, ink, true); });
    detailLines.forEach((line, index) => { page.content += pdfText(59, top - 17 - nameLines.length * 12 - index * 10, line, 7, muted); });
    page.content += pdfRightText(378, top - 15, String(Number(item.quantity) || 0), 9, ink, true);
    page.content += pdfRightText(459, top - 15, moneyFormat(item.unitPriceCents), 8, muted);
    page.content += pdfRightText(535, top - 15, moneyFormat(item.lineTotalCents), 8, ink, true);
    page.content += pdfRect(59, top - rowHeight + 2, 477, 0.6, '0.89 0.91 0.87');
    page.y -= rowHeight;
    rowIndex += 1;
  }
  if (page.y < 190) { pages.push(page.content); page = pdfPageStart(table, invoice, true); }
  const totalBoxY = Math.max(82, page.y - 128);
  page.content += pdfText(59, totalBoxY + 94, 'RESUMEN', 8, muted, true);
  page.content += pdfText(59, totalBoxY + 70, 'Subtotal', 9, muted);
  page.content += pdfRightText(318, totalBoxY + 70, moneyFormat(invoice?.subtotalCents), 9, ink, true);
  page.content += pdfText(59, totalBoxY + 51, 'Servicio', 9, muted);
  page.content += pdfRightText(318, totalBoxY + 51, moneyFormat(invoice?.serviceChargeCents), 9, ink, true);
  page.content += pdfRect(346, totalBoxY, 202, 101, ink);
  page.content += pdfRect(346, totalBoxY + 97, 202, 4, '0.79 0.87 0.55');
  page.content += pdfText(362, totalBoxY + 73, 'TOTAL PAGADO', 7, '0.72 0.87 0.78', true);
  page.content += pdfText(362, totalBoxY + 43, moneyFormat(invoice?.totalCents), 19, '1 1 1', true);
  page.content += pdfText(362, totalBoxY + 20, methodLabel(invoice?.method), 8, '0.72 0.87 0.78');
  page.content += pdfText(59, totalBoxY + 12, 'Gracias por visitarnos.', 9, ink, true);
  pages.push(page.content);
  const pageContents = pages.map((content, index) => pdfFooter(content, index + 1));
  const pageIds = pages.map((_, index) => 3 + index);
  const contentIds = pages.map((_, index) => 3 + pages.length + index);
  const fontId = 3 + pages.length * 2;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  ];
  pages.forEach((_, index) => objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${fontId + 1} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`));
  pageContents.forEach((content) => objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  const blob = new Blob([pdf], { type: 'application/pdf' });
  const link = document.createElement('a');
  const date = dateValue(invoice?.paidAt);
  const datePart = date ? date.toISOString().slice(0, 10) : 'fecha';
  link.href = URL.createObjectURL(blob);
  link.download = `Mesa-${table}-factura-${datePart}.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export function printInvoice(invoice) {
  const printWindow = window.open('', '_blank', 'width=760,height=900');
  if (!printWindow) return false;
  printWindow.addEventListener('load', () => { printWindow.focus(); printWindow.print(); }, { once: true });
  const printStyles = `
    @page { size: A4; margin: 15mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #26382f; font: 13px Arial, sans-serif; }
    .invoice-preview { max-width: 760px; margin: 0 auto; padding: 0 24px 20px; border: 1px solid #e2e7df; border-radius: 18px; background: #fff; }
    .invoice-top-band { margin: 0 -24px 20px; padding: 23px 24px 22px; border-radius: 17px 17px 0 0; background: #173d34; color: #f7f7f2; }
    .invoice-brand { display: flex; align-items: center; gap: 10px; margin-bottom: 26px; color: #f7f7f2; font-size: 18px; font-weight: 800; }
    .invoice-brand > strong > span { color: #b8c9ad; font-weight: 500; }
    .brand-mark { display: inline-grid; width: 36px; height: 36px; place-items: center; border-radius: 11px; background: #28604f; color: #fff; font-size: 18px; }
    .eyebrow { margin: 0 0 7px; color: #c5db88; font-size: 9px; font-weight: 700; letter-spacing: 2px; }
    .invoice-headline { display: flex; align-items: end; justify-content: space-between; gap: 14px; }
    .invoice-preview h3 { margin: 0; color: #f7f7f2; font-size: 27px; letter-spacing: -.5px; }
    .invoice-table-label { padding: 8px 12px; border: 1px solid #78916f; border-radius: 999px; color: #d5e4b0; font-size: 11px; font-weight: 700; }
    .invoice-meta { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; padding: 14px 0; border-bottom: 1px solid #e4e8e0; }
    .invoice-meta span, .invoice-meta strong { display: block; }
    .invoice-meta span, .invoice-line-detail, .invoice-line-price { color: #718076; }
    .invoice-meta span { margin-bottom: 6px; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; }
    .invoice-meta strong { font-size: 11px; }
    .invoice-lines { margin-top: 14px; }
    .invoice-line { display: flex; justify-content: space-between; gap: 20px; padding: 13px 2px; border-bottom: 1px solid #edf0e9; }
    .invoice-line strong, .invoice-line small { display: block; }
    .invoice-line-detail, .invoice-line-price { margin-top: 5px; font-size: 10px; }
    .invoice-totals { max-width: 370px; margin: 18px 0 0 auto; }
    .invoice-totals p { display: flex; justify-content: space-between; margin: 8px 0; }
    .invoice-total { margin-top: 12px !important; padding: 14px 16px; border-top: 3px solid #c5db88; border-radius: 10px; background: #173d34; color: #fff; font-size: 16px; }
    .invoice-thanks { margin: 25px 0 0; color: #61786c; text-align: center; }
    @media print { .invoice-preview { border: 0; border-radius: 0; } }
  `;
  printWindow.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Factura · Mesa ${escapeHtml(invoice?.tableId)}</title><style>${printStyles}</style></head><body>${invoiceMarkup(invoice)}</body></html>`);
  printWindow.document.close();
  return true;
}
