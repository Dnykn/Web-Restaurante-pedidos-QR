from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from pathlib import Path
from PIL import Image

ROOT=Path.cwd(); EV=ROOT/'evidencia_pruebas'
OUT=ROOT/'Proyecto_MesaExpress_Implementacion_y_Validacion_Final.docx'
NAVY='17322D'; TEAL='175044'; MINT='DDEFEA'; PALE='F3F7F5'; ORANGE='C9673F'; GRAY='5C6C67'; DARK='1B2421'; WHITE='FFFFFF'

def shade(cell,fill):
    pr=cell._tc.get_or_add_tcPr(); shd=OxmlElement('w:shd'); shd.set(qn('w:fill'),fill); pr.append(shd)
def margins(cell,top=85,start=110,bottom=85,end=110):
    pr=cell._tc.get_or_add_tcPr(); m=OxmlElement('w:tcMar')
    for side,val in [('top',top),('start',start),('bottom',bottom),('end',end)]:
        e=OxmlElement('w:'+side); e.set(qn('w:w'),str(val)); e.set(qn('w:type'),'dxa'); m.append(e)
    pr.append(m)
def celltext(cell,text,bold=False,color=DARK,size=8.4):
    cell.text=''; p=cell.paragraphs[0]; p.paragraph_format.space_after=Pt(0)
    r=p.add_run(str(text)); r.bold=bold; r.font.name='Aptos'; r.font.size=Pt(size); r.font.color.rgb=RGBColor.from_string(color)
    cell.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER; margins(cell)
def repeat(row):
    e=OxmlElement('w:tblHeader'); e.set(qn('w:val'),'true'); row._tr.get_or_add_trPr().append(e)
def nosplit(row): row._tr.get_or_add_trPr().append(OxmlElement('w:cantSplit'))
def para(doc,text='',style=None,after=4,align=None):
    p=doc.add_paragraph(style=style) if style else doc.add_paragraph()
    p.paragraph_format.space_after=Pt(after)
    if align is not None:p.alignment=align
    p.add_run(text); return p
def head(doc,text,lvl=1):
    h=doc.add_heading(text,lvl); h.paragraph_format.keep_with_next=True; h.paragraph_format.space_before=Pt(10 if lvl==1 else 6); h.paragraph_format.space_after=Pt(4); return h
def grid(doc,heads,rows,widths=None,size=8.2):
    t=doc.add_table(rows=1,cols=len(heads)); t.alignment=WD_TABLE_ALIGNMENT.CENTER; t.autofit=False
    try:t.style='Table Grid'
    except:pass
    for i,x in enumerate(heads):
        celltext(t.rows[0].cells[i],x,True,WHITE,size); shade(t.rows[0].cells[i],TEAL)
        if widths:t.rows[0].cells[i].width=Inches(widths[i])
    repeat(t.rows[0]); nosplit(t.rows[0])
    for ri,row in enumerate(rows):
        cells=t.add_row().cells; nosplit(t.rows[-1])
        for i,x in enumerate(row):
            celltext(cells[i],x,False,DARK,size)
            if widths:cells[i].width=Inches(widths[i])
            if ri%2:shade(cells[i],PALE)
    doc.add_paragraph().paragraph_format.space_after=Pt(0)
    return t
def callout(doc,title,text,fill=MINT,accent=TEAL):
    t=doc.add_table(rows=1,cols=1); c=t.cell(0,0); shade(c,fill); margins(c,130,160,130,160); c.text=''
    p=c.paragraphs[0]; p.paragraph_format.space_after=Pt(3); r=p.add_run(title); r.bold=True; r.font.size=Pt(10); r.font.color.rgb=RGBColor.from_string(accent)
    p=c.add_paragraph(text); p.paragraph_format.space_after=Pt(0)
    for r in p.runs:r.font.size=Pt(9); r.font.color.rgb=RGBColor.from_string(DARK)
    doc.add_paragraph().paragraph_format.space_after=Pt(0)
def case(doc,c):
    head(doc,c[0]+' · '+c[1],2)
    rows=[('Objetivo',c[2]),('Precondiciones y datos',c[3]),('Acción',c[4]),('Esperado',c[5]),('Observado',c[6]),('Evidencia',c[7]),('Estado',c[8])]
    t=doc.add_table(rows=0,cols=2); t.alignment=WD_TABLE_ALIGNMENT.CENTER; t.autofit=False
    try:t.style='Table Grid'
    except:pass
    for i,(a,b) in enumerate(rows):
        cells=t.add_row().cells; nosplit(t.rows[-1]); cells[0].width=Inches(1.45); cells[1].width=Inches(5.95)
        celltext(cells[0],a,True,TEAL,8); celltext(cells[1],b,False,DARK,8.2); shade(cells[0],MINT)
        if i%2:shade(cells[1],PALE)
    doc.add_paragraph().paragraph_format.space_after=Pt(0)
def link(p,text,target):
    rid=p.part.relate_to(target,'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',is_external=True)
    h=OxmlElement('w:hyperlink'); h.set(qn('r:id'),rid); r=OxmlElement('w:r'); pr=OxmlElement('w:rPr')
    col=OxmlElement('w:color'); col.set(qn('w:val'),TEAL); pr.append(col); un=OxmlElement('w:u'); un.set(qn('w:val'),'single'); pr.append(un); r.append(pr)
    tx=OxmlElement('w:t'); tx.text=text; r.append(tx); h.append(r); p._p.append(h)
def evidence(doc,code,filename,caption):
    f=EV/filename
    if not f.exists():return False
    im=Image.open(f); ratio=im.width/im.height; p=doc.add_paragraph(); p.alignment=WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.space_after=Pt(2)
    run=p.add_run()
    if ratio<0.82:run.add_picture(str(f),height=Inches(4.65))
    elif ratio<1.25:run.add_picture(str(f),height=Inches(4.25))
    else:run.add_picture(str(f),width=Inches(6.2))
    p=doc.add_paragraph(); p.alignment=WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.space_after=Pt(8)
    r=p.add_run(code+' · '+caption); r.italic=True; r.font.size=Pt(8.2); r.font.color.rgb=RGBColor.from_string(GRAY)
    return True

doc=Document(); sec=doc.sections[0]
sec.page_width=Inches(8.5); sec.page_height=Inches(11); sec.top_margin=Inches(.68); sec.bottom_margin=Inches(.68); sec.left_margin=Inches(.78); sec.right_margin=Inches(.78)
for nm,sz,col in [('Normal',9.5,DARK),('Title',28,NAVY),('Heading 1',18,TEAL),('Heading 2',12,NAVY),('Heading 3',10,TEAL)]:
    s=doc.styles[nm]; s.font.name='Aptos Display' if nm in ('Title','Heading 1','Heading 2') else 'Aptos'; s.font.size=Pt(sz); s.font.color.rgb=RGBColor.from_string(col)
    if nm!='Normal':s.font.bold=True
doc.styles['Normal'].paragraph_format.space_after=Pt(4); doc.styles['Normal'].paragraph_format.line_spacing=1.07
hdr=sec.header.paragraphs[0]; hdr.alignment=WD_ALIGN_PARAGRAPH.RIGHT
r=hdr.add_run('MESAEXPRESS  /  IMPLEMENTACIÓN Y VALIDACIÓN'); r.bold=True; r.font.size=Pt(7.5); r.font.color.rgb=RGBColor.from_string(GRAY)
foot=sec.footer.paragraphs[0]; foot.alignment=WD_ALIGN_PARAGRAPH.CENTER
r=foot.add_run('Proyecto de curso · UCN Jinotepe  |  Página '); r.font.size=Pt(8); r.font.color.rgb=RGBColor.from_string(GRAY)
for typ,val in [('begin',None),('instr','PAGE'),('separate',None),('text','1'),('end',None)]:
    if typ=='begin' or typ=='end':e=OxmlElement('w:fldChar'); e.set(qn('w:fldCharType'),typ)
    elif typ=='instr':e=OxmlElement('w:instrText'); e.set(qn('xml:space'),'preserve'); e.text=val
    elif typ=='separate':e=OxmlElement('w:fldChar'); e.set(qn('w:fldCharType'),'separate')
    else:e=OxmlElement('w:t'); e.text=val
    r._r.append(e)

# Portada
for _ in range(3):para(doc,'',after=12)
para(doc,'UNIVERSIDAD CENTRAL DE NICARAGUA',after=7,align=WD_ALIGN_PARAGRAPH.CENTER).runs[0].font.color.rgb=RGBColor.from_string(TEAL)
para(doc,'Jinotepe, Carazo · Facultad de Ingeniería',after=28,align=WD_ALIGN_PARAGRAPH.CENTER)
p=doc.add_paragraph(style='Title'); p.alignment=WD_ALIGN_PARAGRAPH.CENTER; p.add_run('MesaExpress')
para(doc,'Proyecto de Implementación y Validación de Software',after=12,align=WD_ALIGN_PARAGRAPH.CENTER).runs[0].bold=True
para(doc,'Integración de los tres entregables del proyecto',after=22,align=WD_ALIGN_PARAGRAPH.CENTER)
callout(doc,'Versión documentada','MesaExpress 2.8 · Aplicación web de pedidos por QR, operación del personal y administración de mesas.',PALE)
for x in ['Asignatura: Implementación y Validación de Software','Docente: Pedro Luis Vanegas Lara','Integrantes: Andy Dennis Campos · Anthony Agustín Canales · Erick David Guevara · Elias Enmanuel Ruíz','Fecha de integración: 29 de octubre de 2026']:
    para(doc,x,after=5,align=WD_ALIGN_PARAGRAPH.CENTER)
doc.add_page_break()

head(doc,'Contenido',1)
for x in ['Resumen ejecutivo','1. Contexto y evolución del proyecto','2. Primer entregable: Design Thinking','3. Segundo entregable: implementación y control de cambios','4. Tercer entregable: verificación y validación','5. Informe de defectos','6. Integración, resultados y límites','Anexos de evidencias']:para(doc,x,after=3)
callout(doc,'Criterio de lectura','El informe diferencia la propuesta inicial, la demo del segundo entregable y la aplicación funcional actual. En pruebas se distingue entre aprobado, alcance limitado y ausencia de evidencia.',MINT)

head(doc,'Resumen ejecutivo',1)
para(doc,'MesaExpress permite al cliente consultar el menú y enviar pedidos desde el QR de su mesa, mientras el personal recibe órdenes, actualiza su preparación, atiende solicitudes y registra pagos. La versión documentada es la 2.8 y utiliza Firebase Authentication y Cloud Firestore para el cliente y el panel staff.')
para(doc,'El primer entregable definió la solución con Design Thinking y obtuvo 48.20/50. El segundo presentó una demo principalmente de frontend; la evaluación señaló que no alcanzaba la implementación esperada y obtuvo 20/50. A partir de esa retroalimentación, el equipo inició una nueva implementación desde la versión 2.0 y la amplió hasta la 2.8. El tercer entregable registró 12 casos y obtuvo 16/18; este informe integra los entregables, corrige el ambiente, anexa el video de TC-01 y registra trazabilidad de los 20 casos propuestos originalmente.')
callout(doc,'Alcance real de las pruebas','La técnica de valores límite alcanzó 6 de 6 puntos definidos (100 % de esa técnica). Los casos originales quedan registrados individualmente; sus límites de ejecución y evidencia se especifican. Esta cobertura no representa el 100 % del sistema.','F5EEDC',ORANGE)

head(doc,'1. Contexto y evolución del proyecto',1)
para(doc,'MesaExpress se propuso para reducir esperas y errores al pedir en restaurantes concurridos. El flujo QR permite consultar el menú, asociar el pedido a una mesa y seguir su estado; el personal conserva las tareas de preparación, entrega, asistencia y cierre de cuenta.')
grid(doc,['Etapa','Alcance','Resultado y evolución'],[
('Primer entregable · 29 ago. 2026','Investigación exploratoria, definición, ideación, matriz de decisión, prototipo y evaluación UX.','48.20/50. La alternativa web mediante QR fue seleccionada.'),
('Segundo entregable · 4 oct. 2026','Demo web enfocada en frontend y flujo del cliente; persistencia y panel operativo se planteaban como extensiones.','20/50. La retroalimentación pidió atender lo señalado en la sesión y demostrar Git/control de cambios. El equipo decidió rehacer la implementación como v2.0.'),
('Implementación actual · v2.8','Cliente y staff conectados con Firebase, pedidos por mesa, menú administrable, QR, solicitudes, seguimiento y pagos.','Es distinta de la demo visual inicial; aquellas pantallas son antecedentes, no pantallas actuales.'),
('Tercer entregable · 27 oct. 2026','Informe con 12 casos iniciales.','16/18. Se pidió corregir la nota del video, documentar ambiente y continuar los 20 casos.')],[1.25,3.0,3.05],8.0)
head(doc,'1.1 Retroalimentación académica incorporada',2)
for x in [
'El segundo entregable obtuvo 5/20 en primera versión funcional, 0/4 en evidencia de Git local y 0/4 en flujo de control de cambios; indicó que dos integrantes no eran miembros, no había evidencia de protección de ramas y solo había una rama.',
'El tercer entregable confirmó que el video TC-01 sí estaba adjunto, pidió URL/navegador/versión y recomendó continuar los 20 casos del plan.',
'La observación docente sobre diseñar para usuarios con distintos niveles de experiencia se incorpora como criterio UX: lenguaje cotidiano, acciones visibles y flujo comprensible con poca explicación.']:
    para(doc,'• '+x,after=3)

head(doc,'2. Primer entregable: Design Thinking',1)
para(doc,'El primer entregable estudió de forma exploratoria la experiencia de clientes y personal. Sus resultados son cualitativos y no se presentan como muestra estadística.')
head(doc,'2.1 Empatizar y definir',2)
para(doc,'Los problemas identificados fueron esperas para consultar el menú o pedir, errores al anotar y dificultad para llamar al personal. De ellos se derivan necesidades de ordenar al propio ritmo, conocer el total antes de confirmar y solicitar ayuda o cuenta con claridad.')
callout(doc,'Problema de diseño','Los comensales en restaurantes concurridos necesitan consultar el menú y enviar pedidos desde el teléfono, con la mesa correctamente identificada, porque los métodos tradicionales pueden producir espera, frustración y errores.',MINT)
para(doc,'Reto: ¿Cómo optimizar el pedido mediante una interfaz digital intuitiva que permita ordenar desde la mesa, reduzca la espera y asocie cada pedido con la mesa correcta?')
head(doc,'2.2 Idear y seleccionar',2)
grid(doc,['Alternativa','Ventaja','Limitación'],[
('Aplicación móvil nativa','Experiencia controlada.','Exige instalación y mantenimiento.'),
('Tótem o pantalla táctil','Punto compartido dentro del local.','Requiere hardware, espacio y mantenimiento.'),
('Aplicación web por QR','Acceso inmediato desde el teléfono sin instalar una app.','Requiere conectividad y QR asociado a la mesa.')],[1.6,2.65,3.05])
para(doc,'La matriz ponderada priorizó facilidad, costo, viabilidad, accesibilidad y tiempo. La web por QR obtuvo 25 puntos; app nativa, 12; tótem, 13.')
head(doc,'2.3 Prototipar y evaluar',2)
para(doc,'El flujo previsto fue escanear QR, identificar mesa, consultar categorías, abrir detalle, personalizar, revisar carrito, confirmar y seguir el pedido. La evaluación pidió hacer más visible el número de mesa; el diseño reforzó ese indicador y la confirmación del contexto.')
para(doc,'El primer entregable obtuvo 48.20/50. La rúbrica muestra 3.5/5 en elaboración de diapositivas, 1.8/2 en navegación, 0.45/0.5 en ausencia de distracciones y 0.45/0.5 en visibilidad del estado. Los demás criterios aparecen con puntuación máxima.')

head(doc,'3. Segundo entregable: implementación y control de cambios',1)
head(doc,'3.1 De la demo a la versión funcional',2)
para(doc,'La presentación del segundo entregable describía HTML, CSS y JavaScript y señalaba que aún no había backend ni base de datos. La evaluación asignó 5/20 a la primera versión funcional. Después de la retroalimentación, el equipo inició una nueva implementación con persistencia y operación reales, en vez de presentar la demo como sistema final.')
para(doc,'En v2.8 el menú consulta platillos disponibles y confirma órdenes asociadas al QR y a la mesa. El staff recibe pedidos y solicitudes en tiempo real, cambia estados desde las tarjetas, administra platillos y mesas y registra pagos que cierran la visita. Cuenta y pedidos se comparten por mesa.')
head(doc,'3.2 Arquitectura y colecciones principales',2)
grid(doc,['Componente/colección','Responsabilidad'],[
('menu.html / js/app.js','Menú, detalle, carrito, personalizaciones, pedidos, seguimiento y solicitudes del cliente.'),
('staff.html / js/staff.js','Autenticación staff, órdenes, solicitudes, platillos, mesas, QR, pagos e historial.'),
('js/firebase.js','Inicialización de Firebase.'),
('platillos/{id}','Nombre, descripción, categoría, precio en centavos, personalizaciones y disponibilidad.'),
('tables/{id}, tableAccess/{token}','Mesa y acceso QR asociado.'),
('visits/{id}, orders/{id}','Visita/cuenta y órdenes individuales por mesa, productos y estado.'),
('assistanceRequests/{id}, payments/{id}','Solicitudes de ayuda/cuenta y pagos.'),
('staffUsers/{uid}, settings/restaurant','Perfil de autorización y configuración pública.')],[2.0,5.3],8.0)
head(doc,'3.3 Repositorio, Git y flujo de trabajo',2)
para(doc,'Repositorio: https://github.com/Dnykn/Web-Restaurante-pedidos-QR. Sitio publicado: https://dnykn.github.io/Web-Restaurante-pedidos-QR/. Las capturas actuales muestran el repositorio público y main. Un ruleset activo protege main: exige pull request, restringe eliminación y bloquea force push.')
para(doc,'Las fotografías de terminal corresponden al segundo entregable y muestran clonación, estado local y commit/push con distintos perfiles de usuario. Son evidencia histórica del uso de Git; no prueban que cada integrante clonó v2.8 ni que todos usaron pull requests. La captura del ruleset sí documenta la protección actual.')
callout(doc,'Flujo asociado a la regla activa','Clonar/actualizar → crear rama → hacer commits → publicar rama → abrir pull request hacia main → revisar y fusionar. La regla exige el pull request, pero las evidencias recibidas no muestran uno completado ni la clonación actual de cada integrante.',PALE)
para(doc,'La segunda rúbrica registró 0/4 en evidencia de Git local, 6/8 en GitHub y 0/4 en control de cambios. Este informe incorpora evidencia histórica de clonación y envío, captura del repositorio actual y captura del ruleset, delimitando lo que cada evidencia demuestra.')

head(doc,'4. Tercer entregable: verificación y validación',1)
head(doc,'4.1 Ambiente de prueba',2)
grid(doc,['Elemento','Dato registrado'],[
('URL base pública','https://dnykn.github.io/Web-Restaurante-pedidos-QR/menu.html'),
('Escenario QR','Mesa 01; se usó mesa=01 y token QR. El token se omite del informe.'),
('Sistema principal','Windows 11 de 64 bits.'),
('Navegador principal','Opera GX Early Access 138.0.6044.45.'),
('Motor','Chromium 154.0.8037.99.'),
('Ambiente móvil','Firefox 159.0 en Android 16; revisión móvil acotada PN-03.'),
('Datos observados','Mesa 01; cacao C$20.00; cantidades 1 y 2; total C$20/C$40; servicio C$0.00; pago efectivo.')],[1.65,5.65],8.1)
para(doc,'La URL es el punto de entrada público; el acceso QR requiere el token de mesa. El token se omite para no publicar el valor de acceso.')
head(doc,'4.2 Técnica de caja negra',2)
para(doc,'Se aplicó análisis de valores límite al control de cantidad por producto, cuyo rango es 1 a 20. Se verificaron límites, valores interiores adyacentes e intentos de rebasar ambos extremos.')
grid(doc,['Punto','Entrada/acción','Resultado'],[
('Inferior exterior','Intentar bajar de 1 a 0.','Conserva el mínimo 1.'),
('Inferior','1.','Aceptada.'),
('Interior inferior','2.','Aceptada; total recalculado.'),
('Interior superior','19.','Aceptada.'),
('Superior','20.','Aceptada.'),
('Superior exterior','Intentar subir de 20 a 21.','Conserva el máximo 20.')],[1.8,2.8,2.7])
callout(doc,'Cobertura','6 puntos de 6 definidos = 100 % de cobertura del análisis de valores límite de cantidad. Se limita a esta técnica/control y no representa cobertura de todo el software.',MINT)
head(doc,'4.3 Resumen del conjunto de pruebas',2)
grid(doc,['Indicador','Resultado','Alcance'],[
('Casos originales','20 IDs registrados: PF, PN, PB y PC; cinco de cada tipo.','Cada caso tiene ficha y trazabilidad.'),
('Casos iniciales','TC-01 a TC-12 reportados aprobados.','E01–E12 y video E13.'),
('Observados con evidencia favorable','PF-01 a PF-05 y PN-04, con alcance explicado en sus fichas.','Solo escenarios realmente observados.'),
('Alcance limitado','PN-01/02/03/05, PB-01/02/03/04/05 y PC-01/02/03/04.','La ficha indica qué se observó y qué quedó fuera.'),
('Sin ejecución demostrada','PC-05; y partes de rendimiento, compatibilidad, transiciones inválidas y límites PB-05.','No se marcan aprobados sin evidencia.')],[1.55,2.65,3.1],7.9)

head(doc,'4.4 Fichas de los 20 casos originales',2)
para(doc,'Se conservan los códigos del plan entregado. Cuando la evidencia cubre solo una parte del procedimiento original, la ficha lo dice expresamente.')
CASES=[
('PF-01','Cálculo del carrito','Comprobar subtotal, servicio, total y cantidad.','Mesa identificada; cacao C$20.00; servicio vigente C$0.00.','Cambiar cantidad de 1 a 2 y comparar importes.','Totales según cantidad y configuración vigente.','C$20.00 para 1 unidad y C$40.00 para 2; servicio C$0.00. El 10 % del plan era supuesto, no requisito actual.','TC-02; E01, E20.','Aprobado en el cálculo observado.'),
('PF-02','Identificación de mesa por QR','Verificar que QR conserva mesa y permite agregar.','QR Mesa 01; sitio publicado.','Abrir menú QR y agregar cacao.','Mesa 01 y producto en carrito.','La vista mostró Mesa 01 y el artículo en el carrito.','TC-03; E02.','Aprobado.'),
('PF-03','Flujo completo de pedido','Validar QR a seguimiento.','Mesa 01 y menú disponible.','Consultar menú, agregar producto, confirmar y seguir estados.','Orden asociada a mesa, guardada y visible.','ALECLR apareció en cliente y Cocina y avanzó hasta Entregado.','TC-03–TC-07; E02–E06.','Aprobado en flujo observado.'),
('PF-04','Comunicación cliente y Cocina','Comprobar pedido y cambios en ambas vistas.','Cliente y staff abiertos en Mesa 01.','Avanzar Recibido → En preparación → Listo → Entregado.','Cliente y staff muestran cada cambio.','Las actualizaciones válidas se reflejaron sin recargar.','TC-04–TC-07; E03–E06.','Aprobado para transiciones válidas observadas.'),
('PF-05','Solicitud de cuenta y pago','Verificar solicitud con saldo y cierre.','Pedido entregado por C$40.00.','Solicitar cuenta y registrar pago en efectivo.','Solicitud llega; pago cierra visita.','La solicitud mostró saldo C$40; pago cerró y liberó Mesa 01.','TC-08–TC-09; E07–E08.','Aprobado en flujo observado.'),
('PN-01','Rendimiento del recálculo','Medir el carrito original de 50 productos.','Carrito disponible.','El plan pide cargar 50 productos y medir cambios.','Respuesta <200 ms era referencia propuesta.','E13 muestra rango de cantidad 1–20, no carga de 50 ni medida de tiempo.','E13; E20.','Alcance limitado; sin medición de rendimiento.'),
('PN-02','Parámetro de mesa inválido','Comprobar bloqueo sin QR válido.','Sitio público accesible.','Abrir mesa=999 sin token y mesa vacía; intentar confirmar.','No se envía a mesa inexistente; no se ejecuta código.','El menú pidió abrir desde QR y bloqueó envío. No se probó script XSS.','E31–E32.','Alcance limitado; no cubre carga maliciosa.'),
('PN-03','Portabilidad y compatibilidad','Revisar navegador, dispositivo y tamaño.','Sitio publicado.','Se observó Opera GX/Windows y Firefox móvil/Android; no la matriz completa.','Controles utilizables y contenido adaptable.','Menú, detalle, carrito y seguimiento usables en Firefox 159/Android 16; sin prueba de Safari/iOS.','E14–E16.','Alcance limitado a dos ambientes documentados.'),
('PN-04','Pérdida y recuperación de conexión','Conservar carrito y evitar duplicados.','Mesa 01 con producto en carrito.','Intentar sin conexión, restaurar y reintentar una vez.','Error claro, carrito conservado, una orden.','“Connection failed”; al reconectar YBULVC apareció una vez en cliente y staff.','E17–E19.','Aprobado para este escenario.'),
('PN-05','Usabilidad con participantes','Observar comprensión del flujo.','Tres familiares: dos adultos y una adolescente.','Explicación breve y observación de uso.','Comprenden cómo consultar menú e iniciar pedido.','Los tres entendieron en poco tiempo y la experiencia fue positiva; no fueron cinco desconocidos ni hubo cuestionario.','E29–E30 y observación del equipo.','Ejecutado con muestra/protocolo adaptados.'),
('PB-01','Decisiones de updateQuantity','Ejercitar ramas de línea ausente/cantidad positiva/cero.','Cuerpo real de updateQuantity ejecutado en contexto aislado; sin Firebase.','Clave inexistente; 2→1; 1→0 y comprobar eliminación/render.','Ausente no modifica; positiva conserva; cero elimina.','Tres escenarios pasaron; ambas decisiones de updateQuantity recorrieron ambos resultados. No es cobertura instrumentada de todo el archivo ni de agregar por interfaz.','E33: resultado y script PB01_branch_check.js; E01 muestra agregar.','Ejecutado acotado; 2/2 decisiones del componente, sin instrumentación automática.'),
('PB-02','Flujo de datos hasta Cocina','Comparar producto, cantidad, precio e ID.','Menú y panel staff disponibles.','Enviar cacao y comparar vistas.','Datos coinciden en cliente/staff.','YBULVC mostró 1× cacao y C$20.00 en ambas vistas.','E18–E19.','Aprobado para campos comparados.'),
('PB-03','Navegación y edición del carrito','Recorrer categorías y editar carrito sin perder seguimiento.','Menú publicado con seguimiento existente.','Cambiar categorías y agregar/modificar/retirar.','Navegación no rompe seguimiento.','El video muestra navegación y edición mientras sigue visible el pedido.','E23, video.','Aprobado según video aportado.'),
('PB-04','Transiciones de estado','Comprobar estados válidos e inválidos.','Pedido visible en cliente y Cocina.','Secuencia válida; plan también proponía Listo→Recibido.','Válidas reflejadas; inválida rechazada.','Se observó secuencia válida; no hay evidencia del intento inválido.','E03–E06.','Parcial; transición inválida sin evidencia.'),
('PB-05','Límites y caracteres de instrucciones','Validar nota vacía, 500 caracteres y caracteres especiales.','Producto cacao y campo de instrucciones.','Se envió una nota real; no las entradas límite del plan.','La nota se conserva y límites se validan.','Texto de leche/azúcar llegó a staff; vacío, 500 chars y todos los caracteres no se probaron.','E21–E22.','Parcial; transmisión probada, límites no.'),
('PC-01','Regresión de cálculo','Confirmar consistencia tras cambiar cantidad.','Cacao C$20; servicio C$0.','Cambiar 1→2 y revisar total.','Total según configuración vigente.','Total cambió C$20→C$40; servicio C$0.','E20; video E13.','Aprobado en recalculación observada; sin comparación automatizada.'),
('PC-02','Visibilidad de mesa','Confirmar el ajuste de número visible.','QR Mesa 01.','Revisar mesa en menú y panel.','Mesa visible en pantallas relevantes.','Se ve Mesa 01 en evidencias, pero no todas las pantallas del plan.','E02–E03, E14.','Parcial.'),
('PC-03','Regresión del flujo tras cambios del carrito','Revisar que cambios UI no rompan el flujo.','Versión 2.8, Mesa 01.','Recorrer QR, selección, carrito, confirmación y seguimiento.','Flujo continúa funcionando.','TC-03–TC-07/E23 muestran flujo; no hay comparación formal antes/después.','E02–E06, E23.','Alcance limitado; sin comparación formal.'),
('PC-04','Regresión de comunicación con Cocina','Revisar sincronía después de cambios del panel.','Pedido en cliente y staff.','Avanzar estados y comparar vistas.','Datos y estados consistentes.','La sincronía aparece en E03–E06/E18–E19; no se identifica cambio concreto como disparador de regresión.','E03–E06, E18–E19.','Alcance limitado.'),
('PC-05','Reejecución de casos fallidos','Repetir pruebas fallidas tras correcciones.','El plan requiere lista de fallos y correcciones.','No se aportó lista vinculada de defectos y reejecuciones.','Casos fallidos previos pasan sin defectos nuevos.','No hay evidencia suficiente para confirmar la regresión formal.','No disponible.','Sin ejecución demostrada; no se marca aprobado.')
]
for c in CASES:case(doc,c)

head(doc,'5. Informe de defectos',1)
para(doc,'En los 12 casos iniciales y escenarios complementarios descritos no se registró un defecto reproducible dentro del alcance observado. Esto no demuestra que el sistema esté libre de defectos fuera de esos escenarios.')
grid(doc,['ID','Hallazgo','Evaluación','Evidencia'],[
('D-01','Sin conexión apareció “Connection failed”; al reconectar el pedido se registró una vez.','Recuperación esperada; no se reporta defecto reproducible.','E17–E19'),
('D-02','Mesa=999 sin token y mesa vacía no habilitaron envío.','Bloqueo esperado; no se ejecutó carga XSS propuesta.','E31–E32'),
('D-03','No se observaron otros defectos reproducibles en TC-01–TC-12.','Cero defectos reportados en ese alcance, no certificación exhaustiva.','E01–E13')],[.55,3.1,2.75,.9],7.8)
head(doc,'5.1 Diferencias de alcance y defectos',2)
para(doc,'Las diferencias entre los protocolos propuestos y lo ejecutado se describen como límites de evidencia. No se llaman defectos del software sin una observación que pruebe comportamiento incorrecto.')

head(doc,'6. Integración, resultados y límites',1)
para(doc,'El flujo de autoservicio se conecta con la operación del personal: cada pedido se guarda por separado, asociado a una mesa; el staff recibe la orden y el cliente ve cambios de estado. El pago cierra la visita y limpia la cuenta compartida. Las funciones corresponden a v2.8 documentada en el repositorio y su README.')
head(doc,'6.1 Relación con la rúbrica final',2)
grid(doc,['Criterio','Máximo','Contenido'],[
('Diseño conforme a Design Thinking','4','Sección 2.'),
('Implementación y control de cambios','3','Sección 3.3 y anexos Git.'),
('Verificación y validación','4','Sección 4, valores límite, 20 fichas y defectos.'),
('Unificación e integración','19','Integración de entregables y sistema v2.8.'),
('Presentación y defensa','20','Se evalúan en el examen; no se añaden preguntas hipotéticas.')],[2.35,.65,4.3],8.0)
para(doc,'El equipo no participó en la Feria del 14 de octubre; según las instrucciones recibidas, presentará el proyecto el sábado 31 de octubre de 2026 a las 8:00 a. m. y lo defenderá en la sesión presencial.')
head(doc,'6.2 Límites de lectura',2)
for x in [
'La usabilidad se observó con tres familiares y explicación breve; no equivale a cinco desconocidos sin asistencia ni a una encuesta.',
'La compatibilidad cubrió Opera GX/Windows 11 y Firefox 159/Android 16, no Safari/iOS ni toda la matriz.',
'PN-01 no midió milisegundos ni cargó 50 productos; TC-01 documenta valores límite.',
'PB-01 cubrió decisiones de updateQuantity en un contexto aislado, no todo js/app.js.',
'La evidencia de Git local es histórica; el ruleset de main es actual. No se aportó un PR completado ni clones actuales de cada integrante.',
'Las funciones sugeridas para futuras mejoras no se presentan como implementadas ni probadas.']:
    para(doc,'• '+x,after=3)
head(doc,'Conclusión',1)
para(doc,'MesaExpress pasó de una propuesta UX y una demo inicial a una aplicación web funcional con operaciones de cliente y staff apoyadas por Firebase. El informe explica por qué v2.8 no es la misma demo visual del segundo entregable. La técnica de valores límite cubrió los seis puntos definidos y los 20 casos originales tienen trazabilidad con evidencia y límites. Se distinguen los resultados aprobados, los alcances limitados y los casos sin ejecución demostrada.')

# Anexos
doc.add_page_break(); head(doc,'Anexos de evidencias',1)
para(doc,'Las capturas seleccionadas se incorporan en el informe. Los videos se entregan como MP4 junto al DOCX; mantenga ambos en la misma carpeta para que los vínculos relativos funcionen.')
grid(doc,['Código','Archivo','Contenido'],[
('E13','Evidencia_TC-01_Limites_de_cantidad.mp4','TC-01: rango 1–20, valores adyacentes e intentos de exceder límites.'),
('E23','Evidencia_PB03_Navegacion_y_carrito.mp4','PB-03: navegación, edición del carrito y seguimiento.')],[.65,3.2,4.05])
for label,target in [('Abrir video E13 · Límites de cantidad','Evidencia_TC-01_Limites_de_cantidad.mp4'),('Abrir video E23 · Navegación y carrito','Evidencia_PB03_Navegacion_y_carrito.mp4')]:
    p=doc.add_paragraph(); link(p,label,target)
head(doc,'Anexo A. Capturas de ejecución y contexto',2)
IMAGES=[
('E01','E01_codex-clipboard-c80fad2b-449a-485e-b63f-5fe227340a03.png','Carrito con dos cacao; subtotal y total C$40 y servicio C$0.'),
('E02','E02_codex-clipboard-f8563f16-9e87-4f49-b7d8-0e7da3559fd7.png','Mesa identificada y flujo del pedido en cliente/staff.'),
('E03','E03_codex-clipboard-fe7462cd-9b23-4f02-8979-d81b80c34d14.png','Pedido recibido y tarjeta de Cocina.'),
('E04','E04_codex-clipboard-2c86ab0a-a629-4c45-8e79-d334c2a97626.png','Pedido en preparación en ambas vistas.'),
('E05','E05_codex-clipboard-59c06d8a-fcaf-416f-b0d1-d2a7efe843bc.png','Pedido listo y esperando al mesero.'),
('E06','E06_codex-clipboard-8d45c7d1-e79a-4eba-a4da-6edd3946eb3e.png','Pedido entregado y fuera de órdenes activas.'),
('E07','E07_codex-clipboard-f71a63e9-64bd-4a4a-be79-ec09586eede0.png','Solicitud de cuenta y saldo pendiente.'),
('E08','E08_codex-clipboard-f1413ed0-b895-44a4-a1e0-f072a351e2e1.png','Pago registrado y visita cerrada.'),
('E09','E09_codex-clipboard-39f3d2df-083a-42c7-a6e2-9a462a7a5183.png','Cliente/staff reflejan estado entregado.'),
('E10','E10_codex-clipboard-c467ff13-391c-4b65-a0c0-2b41f2171f0f.png','Solicitud de cuenta cerrada tras pago.'),
('E11','E11_codex-clipboard-a4644027-96e1-4e64-8951-6e2c7f0e6b89.png','Solicitud de ayuda visible en staff.'),
('E12','E12_codex-clipboard-3c5cb03a-1736-482a-9ddf-eb25830e334c.png','Cancelación reflejada en ambas vistas.'),
('E14','E14_OperaGX_ambiente.png','Ambiente principal de Windows/Opera GX.'),
('E15','E15_PN03_Firefox_Android.png','Menú y carrito en Firefox Android.'),
('E16','E16_PN03_Version_Firefox.png','Firefox 159.0 y Android 16.'),
('E17','E17_PN04_Error_sin_conexion.png','Fallo de conexión al enviar.'),
('E18','E18_PN04_Pedido_en_staff.png','Pedido de reintento en panel staff.'),
('E19','E19_PN04_Pedido_en_cliente.png','YBULVC visible en cliente tras reconexión.'),
('E20','E20_PC01_Recalculo_total.png','Total cambia de C$20 a C$40.'),
('E21','E21_PB05_Nota_cliente.png','Instrucción antes de confirmar.'),
('E22','E22_PB05_Nota_en_staff.png','Instrucción recibida en Cocina.'),
('E26','E26_Git_clonacion_y_flujo_historico.png','Evidencia histórica de clonación, estado local y commit/push.'),
('E27','E27_GitHub_repositorio_actual.png','Repositorio público y rama main en etapa actual.'),
('E28','E28_Ruleset_main_activo.png','Protección activa de main mediante ruleset.'),
('E29','E29_Usabilidad_familia_1.png','Sesión familiar con dos adultos y una adolescente.'),
('E30','E30_Usabilidad_familia_2.png','Segunda foto de sesión de observación.'),
('E31','E31_PN02_mesa_inexistente.png','Mesa 999 sin token: bloqueo por falta de QR.'),
('E32','E32_PN02_mesa_vacia.png','Mesa vacía: el menú no valida el acceso QR.')
]
wide=0
for code,file,caption in IMAGES:
    fp=EV/file
    if not fp.exists():continue
    ratio=Image.open(fp).width/Image.open(fp).height
    if ratio>=1.25:
        if wide and wide%2==0:doc.add_page_break()
        evidence(doc,code,file,caption); wide+=1
    else:
        doc.add_page_break(); evidence(doc,code,file,caption); doc.add_page_break()
doc.add_page_break(); head(doc,'Anexo B. Ejecución acotada de PB-01',2)
para(doc,'Se ejecutó el cuerpo real de updateQuantity de js/app.js con saveCart y renderCart aislados como espías, sin conexión con Firebase. Se recorrieron las decisiones de línea ausente/presente y cantidad positiva/cero.')
f=EV/'PB01_resultado.txt'
if f.exists():
    t=doc.add_table(rows=1,cols=1); c=t.cell(0,0); shade(c,PALE); c.text=''
    for i,line in enumerate(f.read_text(encoding='utf-8').splitlines()):
        q=c.paragraphs[0] if i==0 else c.add_paragraph(); q.paragraph_format.space_after=Pt(2); r=q.add_run(line); r.font.name='Consolas'; r.font.size=Pt(8)
para(doc,'El resultado respalda decisiones de updateQuantity en los escenarios registrados; no representa cobertura instrumentada del archivo completo ni todos los escenarios originalmente propuestos.')
head(doc,'Anexo C. Fuentes de trazabilidad',2)
for x in ['Primer entregable Design Thinking y rúbrica: 48.20/50.','Presentación del segundo entregable y retroalimentación: 20/50.','MesaExpress_Casos_de_Prueba: matriz original de 20 casos.','Informe de pruebas evaluado el 27 de octubre de 2026: 16/18 y observaciones.','README.md y código del repositorio actual v2.8.','Capturas E01–E32 y videos E13/E23 aportados por el equipo.']:
    para(doc,'• '+x,after=3)

doc.core_properties.title='MesaExpress Proyecto de Implementación y Validación de Software'
doc.core_properties.subject='Integración de Design Thinking, implementación, control de cambios, pruebas y defectos'
doc.core_properties.author='Equipo MesaExpress'; doc.core_properties.keywords='MesaExpress, Design Thinking, Firebase, Git, pruebas de software'
doc.save(OUT)
print('CREATED',OUT,'size',OUT.stat().st_size,'cases',len(CASES),'images',sum((EV/f).exists() for _,f,_ in IMAGES))
