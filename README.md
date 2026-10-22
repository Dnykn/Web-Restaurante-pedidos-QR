# MesaExpress

Aplicación web de pedidos digitales por mesa. El cliente y el panel del personal usan HTML, CSS y JavaScript modular. Firestore comparte el menú y los pedidos en tiempo real.

## Implementado

- Menú en tiempo real desde `platillos`, filtrado por categoría.
- Personalizaciones, notas de hasta 500 caracteres y cantidades de 1 a 20.
- Carrito editable. Al confirmar, el menú abre automáticamente la cuenta de la mesa si hace falta, calcula el total y crea el pedido directamente en `orders`; el panel lo recibe en tiempo real.
- Seguimiento flotante y separado para cada pedido, desde que cocina lo recibe hasta que el mesero confirma la entrega.
- Inicio de sesión de personal con correo y contraseña, verificación de autorización y tablero de cocina actualizado en vivo.
- Transiciones secuenciales `recibido → en_preparacion → listo → entregado`, reflejadas en tiempo real para el cliente y el personal.
- Solicitudes de ayuda/cuenta desde el menú, guardadas directamente en Firestore; se puede pedir la cuenta después de entregar las órdenes.
- Panel de mesas abiertas en tiempo real con pedidos, acumulado, saldo y recordatorio persistente tras 30 minutos desde la entrega más reciente.
- La mesa se activa automáticamente con su primer pedido; el personal puede revisar sus pedidos y registrar el pago cuando quiera. El cobro bloquea el cierre si hay órdenes sin entregar.
- Notificaciones visuales y sonidos diferenciados para pedidos y solicitudes. El sonido está activado por defecto, el navegador lo desbloquea con la primera interacción y el personal puede apagarlo o volverlo a encender desde el control visible del encabezado.
- Pestaña de administración de platillos con búsqueda, filtro por disponibilidad, alta, edición y eliminación directas en Firestore, protegidas por reglas para personal autorizado.
- Al enviar el primer pedido de una mesa, el menú crea automáticamente su registro de cuenta y guarda el pedido en Firestore. El personal no necesita abrir la mesa antes; puede revisar pedidos y cerrar la cuenta cuando corresponda.
- Solicitudes, pagos, estados de cocina y recordatorios se gestionan directamente desde el navegador con reglas de Firestore. El recordatorio de 30 minutos se calcula desde la entrega más reciente.

La configuración web Firebase en `js/firebase.js` conserva los valores proporcionados por el propietario.

## Documentos Firestore

Los IDs de mesa usan al menos dos dígitos (`04`). El personal prepara las mesas y sus QR desde la sección **Mesas activas**. La cuenta se abre con el primer pedido.

- `platillos/{productId}`: `name`, `description`, `category` (`Entradas`, `Platos fuertes`, `Postres`, `Bebidas`, `Alcohol` o `Niños`), `priceCents`, `imageUrl` HTTPS opcional, `available` booleano y `customizationOptions` opcional. Ejemplo: `[{"name":"Término","options":["Medio","Bien cocido"],"required":true}]`.
- `tables/04`: `enabled: true`, `activeVisitId: "visita-actual"`, `qrTokenHash: "<SHA-256 hexadecimal del token QR>"`.
- `tableAccess/{token}`: acceso por QR, con `tableId`, `activeVisitId`, `enabled` y `updatedAt`. El menú crea o reutiliza una cuenta abierta al enviar un pedido.
- `visits/{visitId}`: `tableId: "04"`, `status: "open"`, `customerUids: []`, `subtotalCents: 0`, `serviceChargeCents: 0`, `totalCents: 0`, `amountPaidCents: 0`, `balanceDueCents: 0`, `paymentStatus: "unpaid"`.
- `orders/{orderId}`: mesa, cliente, productos y totales; inicia con `status: "recibido"`. Cada transición de cocina/servicio se refleja en el seguimiento flotante del cliente.
- `payments/{paymentId}`: pago físico completo con `visitId`, `tableId`, `amountCents`, `method`, `createdAt` y cuenta staff que lo registró.
- `settings/restaurant`: documento público con `serviceChargeBps: 0`. 1000 puntos básicos equivalen a 10 %.
- `staffUsers/{uid}`: `role: "staff"`, `enabled: true`, `displayName: "Personal"`. El administrador del proyecto crea este documento después de crear la cuenta compartida en Authentication y copiar su UID. Las reglas no permiten modificarlo desde el navegador.
- `assistanceRequests/{requestId}`: tipo, estado, mesa y clientes asociados a la cuenta.

Desde **Mesas activas**, agrega la mesa y el panel genera su enlace y QR a partir de la dirección actual. La tabla guarda el token QR y su hash; solo el personal autenticado puede leer `tables`. Desde otro dispositivo, abre el panel usando una dirección accesible por ese dispositivo; `127.0.0.1` solo apunta al equipo donde se abre.

## Configuración y despliegue

1. En Firebase Console habilita Authentication **Anónimo** para clientes y **Correo electrónico/contraseña** para la cuenta compartida del personal.
2. Crea la cuenta de personal y agrega `staffUsers/{uid}` con `role: "staff"`, `enabled: true` y `displayName`.
3. Crea Cloud Firestore y configura sus reglas e índices.
4. Publica las reglas e índices de Firestore desde Firebase Console.
5. Sirve el sitio por HTTPS o en un servidor local. Los módulos CDN no funcionan con `file://`.

El QR usa automáticamente el origen desde el que se abrió `staff.html`; para teléfonos, ese origen debe ser una dirección de red o dominio que ellos puedan abrir.

## Próximas fases y límites

- Recuperación de conexión más amplia y matriz de pruebas.
- La cuenta compartida identifica la cuenta autenticada, pero no al empleado que realizó cada acción.
- La interfaz de personal no muestra órdenes ficticias: requiere la cuenta autorizada y pedidos reales.

## Estructura principal

`index.html`, `staff.html`, `css/styles.css`, `js/app.js`, `js/staff.js`, `js/firebase.js`, `firestore.rules`, `firestore.indexes.json`, `firebase.json`, `scripts/new-table-qr.mjs`.

## Menú de prueba

Los datos iniciales de la especificación son:

- Tacos de res ahumada — categoría **Platos fuertes** — C$210.
- Pasta cremosa — categoría **Platos fuertes** — C$260.
- Bruschettas — categoría **Entradas** — C$145.

La pestaña **Platillos** del panel administra directamente los documentos de `platillos`. Personal autenticado puede agregar, editar, ocultar o eliminar platillos; las reglas de Firestore comprueban que la cuenta esté en `staffUsers/{uid}` con `role: "staff"` y `enabled: true`.
