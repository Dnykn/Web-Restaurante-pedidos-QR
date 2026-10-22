# MesaExpress

Aplicación web para pedidos por QR, seguimiento de cocina y administración de mesas. El menú del cliente y el panel del personal escriben y leen directamente en Cloud Firestore; el proyecto no requiere Cloud Functions.

## Funciones principales

### Menú del cliente

- Carga en tiempo real los platillos disponibles desde `platillos` y permite filtrarlos por categoría.
- Permite elegir personalizaciones, agregar instrucciones, cambiar cantidades y editar el carrito.
- Al confirmar, asocia el pedido con el QR y la mesa, crea o reutiliza la visita abierta y guarda el pedido en Firestore.
- Muestra el carrito, el total de la cuenta y el seguimiento de cada pedido en un panel flotante. Los pedidos se muestran por separado y avanzan por los estados de cocina y entrega.
- Permite solicitar ayuda. La solicitud aparece en el panel del personal y puede cancelarse mientras siga pendiente.
- Solo permite solicitar la cuenta si hay pedidos pendientes de pago y todos están entregados.
- Mantiene los pedidos y la cuenta separados por mesa.

### Panel del personal (`staff.html`)

- Inicia sesión con correo y contraseña de Firebase Authentication y valida el perfil `staffUsers/{uid}`.
- Recibe pedidos y solicitudes en tiempo real.
- Muestra en cada tarjeta la acción inmediata del pedido: **Iniciar preparación**, **Marcar como listo** o **Confirmar entrega**. Se puede consultar el detalle completo cuando haga falta.
- Incluye filtros por estado y avisos visuales y de sonido. El sonido se activa con la primera interacción del navegador y se puede controlar desde el encabezado.
- Tiene una pestaña **Platillos** para buscar, filtrar por disponibilidad, agregar, editar, ocultar y eliminar elementos de `platillos`.
- En **Mesas activas**, muestra pedidos, acumulado, saldo pendiente y última entrega; permite registrar pagos, cerrar cuentas, revisar visitas cerradas y atender recordatorios después de 30 minutos.
- Permite crear mesas, generar y copiar sus enlaces QR, descargar el código como PNG, imprimirlo o guardarlo como PDF, y eliminar mesas sin visita activa.

## Flujo de pedido y pago

1. El cliente abre `menu.html` mediante el QR de su mesa y confirma uno o más pedidos.
2. El personal recibe cada pedido en **Órdenes** y cambia su estado directamente desde la tarjeta.
3. El seguimiento del cliente refleja cada cambio en tiempo real.
4. El cliente puede pedir la cuenta cuando tenga pedidos pendientes de pago y todos estén entregados.
5. El personal registra el pago completo. El sistema bloquea el cierre mientras haya pedidos sin entregar; al pagar, cierra la visita y libera la mesa.

## Firebase y datos

La configuración de la aplicación web está en `js/firebase.js`. Se usa Firebase Authentication y Cloud Firestore mediante módulos ES importados desde Firebase CDN.

| Colección / documento | Uso |
| --- | --- |
| `platillos/{id}` | Nombre, descripción, categoría, precio en centavos, imagen opcional, personalizaciones y disponibilidad. |
| `tables/{id}` | Número de mesa, estado, visita activa y datos del QR. |
| `tableAccess/{token}` | Acceso QR de la mesa y referencia a su visita activa. |
| `visits/{id}` | Cuenta de una visita: mesa, clientes, totales, saldo y estado abierto o cerrado. |
| `orders/{id}` | Productos, totales, mesa, visita, cliente y estado del pedido. |
| `assistanceRequests/{id}` | Solicitudes de ayuda o cuenta, estado, mesa y visita asociada cuando corresponde. |
| `payments/{id}` | Pago registrado, monto, método, visita y usuario de staff que lo registró. |
| `settings/restaurant` | Configuración pública del restaurante, como `serviceChargeBps`. |
| `staffUsers/{uid}` | Perfil de autorización del personal. |

Las categorías disponibles para platillos son `Entradas`, `Platos fuertes`, `Postres`, `Bebidas`, `Alcohol` y `Niños`. Los precios se guardan como enteros en centavos de córdoba (`priceCents`).

El perfil de personal debe usar tipos correctos de Firestore: `role` como string con valor `staff`, `enabled` como booleano `true` y `displayName` como string. El documento se guarda en `staffUsers/{uid}`, usando como ID el UID de la cuenta de Authentication.

## Configuración local

1. En Firebase Authentication habilita inicio anónimo para clientes y correo/contraseña para staff.
2. Crea la cuenta de staff y su documento `staffUsers/{uid}`.
3. Crea la base de datos Cloud Firestore y publica las reglas e índices del proyecto (`firestore.rules` y `firestore.indexes.json`) desde Firebase Console o Firebase CLI.
4. Sirve el proyecto con un servidor local, por ejemplo Live Server. La raíz (`index.html`) abre el panel de staff. No abras `index.html`, `staff.html` o `menu.html` directamente con `file://`, porque los módulos JavaScript necesitan un origen web.
5. Para imprimir o escanear un QR desde otro dispositivo, abre el panel desde una dirección accesible para ese dispositivo, como una IP local de la computadora o el dominio publicado. `127.0.0.1` solo funciona en la misma computadora.

Las reglas locales del repositorio no se publican automáticamente al editar el archivo. La seguridad efectiva de Firestore depende de las reglas que estén publicadas en Firebase Console.

## Archivos principales

- `index.html`: entrada principal; abre `staff.html` y enruta los QR antiguos al menú.
- `menu.html`: menú y experiencia del cliente.
- `staff.html`: panel de cocina, servicio, mesas y platillos.
- `js/app.js`: carrito, pedidos, seguimiento y solicitudes del cliente.
- `js/staff.js`: autenticación, pedidos, platillos, mesas y pagos del personal.
- `js/firebase.js`: inicialización de Firebase.
- `css/styles.css`: estilos del menú y del panel.
- `firestore.rules`: reglas locales de Cloud Firestore.
- `firestore.indexes.json`: índices compuestos requeridos por las consultas.
- `firebase.json`: configuración local para publicar reglas e índices.
- `scripts/new-table-qr.mjs`: utilidad auxiliar relacionada con códigos QR.
