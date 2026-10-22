import { createHash, randomBytes } from 'node:crypto';

const table = String(process.argv[2] ?? '').trim();
const origin = String(process.argv[3] ?? 'https://TU-DOMINIO').replace(/\/$/, '');

if (!/^\d{1,3}$/.test(table)) {
  console.error('Uso: node scripts/new-table-qr.mjs 04 https://tu-dominio');
  process.exitCode = 1;
} else {
  const tableId = table.padStart(2, '0');
  const token = randomBytes(32).toString('base64url');
  const qrTokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
  const url = new URL('/menu.html', origin);
  url.searchParams.set('mesa', tableId);
  url.searchParams.set('token', token);
  console.log(`tableId: ${tableId}`);
  console.log(`qrTokenHash (guardar en tables/${tableId}): ${qrTokenHash}`);
  console.log(`URL para convertir en QR: ${url.href}`);
}
