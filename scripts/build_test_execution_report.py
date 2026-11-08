from pathlib import Path
import shutil

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn


ROOT = Path(r"C:\Users\Andy\Documents\mesa_express")
SOURCE = Path(r"C:\Users\Andy\AppData\Local\Temp")
OUT = ROOT / "Informe_Pruebas_y_Defectos_MesaExpress.docx"
EVIDENCE_DIR = ROOT / "evidencia_pruebas"

evidence = [
    ("E01", "codex-clipboard-c80fad2b-449a-485e-b63f-5fe227340a03.png", "Carrito: 2 unidades de cacao, subtotal y total de C$40.00; servicio C$0.00."),
    ("E02", "codex-clipboard-f8563f16-9e87-4f49-b7d8-0e7da3559fd7.png", "El menú muestra Mesa 01 y el carrito conserva los productos agregados."),
    ("E03", "codex-clipboard-fe7462cd-9b23-4f02-8979-d81b80c34d14.png", "Pedido ALECLR recibido por el cliente y visible en Cocina."),
    ("E04", "codex-clipboard-2c86ab0a-a629-4c45-8e79-d334c2a97626.png", "Pedido ALECLR en preparación en el cliente y en Cocina."),
    ("E05", "codex-clipboard-59c06d8a-fcaf-416f-b0d1-d2a7efe843bc.png", "Pedido ALECLR listo; el cliente ve que espera al mesero."),
    ("E06", "codex-clipboard-8d45c7d1-e79a-4eba-a4da-6edd3946eb3e.png", "Pedido ALECLR entregado y ya no aparece entre las órdenes activas."),
    ("E07", "codex-clipboard-f71a63e9-64bd-4a4a-be79-ec09586eede0.png", "Solicitud de cuenta por C$40.00 visible en menú y en el panel de solicitudes."),
    ("E08", "codex-clipboard-f1413ed0-b895-44a4-a1e0-f072a351e2e1.png", "Pago registrado, visita cerrada y Mesa 01 disponible; pago visible en historial."),
    ("E09", "codex-clipboard-39f3d2df-083a-42c7-a6e2-9a462a7a5183.png", "El menú informa que no existen pedidos pendientes de pago."),
    ("E10", "codex-clipboard-c467ff13-391c-4b65-a0c0-2b41f2171f0f.png", "El panel de staff confirma que no hay solicitudes pendientes."),
    ("E11", "codex-clipboard-a4644027-96e1-4e64-8951-6e2c7f0e6b89.png", "Solicitud de ayuda de Mesa 01 visible en tiempo real en el staff."),
    ("E12", "codex-clipboard-3c5cb03a-1736-482a-9ddf-eb25830e334c.png", "La cancelación retira la solicitud de ayuda del panel sin recargar."),
]

for eid, filename, _ in evidence:
    src = SOURCE / filename
    if not src.exists():
        raise FileNotFoundError(f"Falta evidencia {eid}: {src}")
    EVIDENCE_DIR.mkdir(exist_ok=True)
    shutil.copy2(src, EVIDENCE_DIR / f"{eid}_{filename}")

doc = Document()
sec = doc.sections[0]
sec.page_width = Inches(8.5)
sec.page_height = Inches(11)
sec.top_margin = Inches(0.65)
sec.bottom_margin = Inches(0.65)
sec.left_margin = Inches(0.7)
sec.right_margin = Inches(0.7)

styles = doc.styles
styles["Normal"].font.name = "Arial"
styles["Normal"]._element.rPr.rFonts.set(qn("w:eastAsia"), "Arial")
styles["Normal"].font.size = Pt(10.5)
styles["Normal"].font.color.rgb = RGBColor(35, 45, 42)
styles["Normal"].paragraph_format.space_after = Pt(6)
for sname, size in [("Title", 25), ("Heading 1", 17), ("Heading 2", 13), ("Heading 3", 11)]:
    st = styles[sname]
    st.font.name = "Arial"
    st._element.rPr.rFonts.set(qn("w:eastAsia"), "Arial")
    st.font.size = Pt(size)
    st.font.bold = True
    st.font.color.rgb = RGBColor(0, 0, 0)
    st.paragraph_format.space_before = Pt(12 if sname != "Title" else 0)
    st.paragraph_format.space_after = Pt(6)

header = sec.header.paragraphs[0]
header.alignment = WD_ALIGN_PARAGRAPH.RIGHT
hr = header.add_run("MESAEXPRESS  |  IMPLEMENTACIÓN Y VALIDACIÓN")
hr.bold = True
hr.font.name = "Arial"
hr.font.size = Pt(8)
hr.font.color.rgb = RGBColor(40, 94, 79)

footer = sec.footer.paragraphs[0]
footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
fr = footer.add_run("Universidad Central de Nicaragua  ·  Jinotepe, Carazo  ·  22 de octubre de 2026")
fr.font.name = "Arial"
fr.font.size = Pt(8)
fr.font.color.rgb = RGBColor(95, 105, 101)

def shade(cell, color):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), color)
    tcPr.append(shd)

def set_cell_margins(cell, top=90, start=100, bottom=90, end=100):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcMar = tcPr.first_child_found_in("w:tcMar")
    if tcMar is None:
        tcMar = OxmlElement("w:tcMar")
        tcPr.append(tcMar)
    for m, v in [("top", top), ("start", start), ("bottom", bottom), ("end", end)]:
        el = tcMar.find(qn(f"w:{m}"))
        if el is None:
            el = OxmlElement(f"w:{m}")
            tcMar.append(el)
        el.set(qn("w:w"), str(v))
        el.set(qn("w:type"), "dxa")

def set_table_borders(table):
    tblPr = table._tbl.tblPr
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        e = OxmlElement(f"w:{edge}")
        e.set(qn("w:val"), "single")
        e.set(qn("w:sz"), "5")
        e.set(qn("w:color"), "D9E0DD")
        borders.append(e)
    tblPr.append(borders)

def format_table(table, header=True, font_size=9):
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = True
    set_table_borders(table)
    for ri, row in enumerate(table.rows):
        for cell in row.cells:
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            set_cell_margins(cell)
            if ri == 0 and header:
                shade(cell, "17483D")
            elif ri % 2 == 0:
                shade(cell, "F1F5F3")
            for p in cell.paragraphs:
                p.paragraph_format.space_after = Pt(2)
                for run in p.runs:
                    run.font.name = "Arial"
                    run.font.size = Pt(font_size)
                    if ri == 0 and header:
                        run.bold = True
                        run.font.color.rgb = RGBColor(255, 255, 255)

def add_bullet(text):
    p = doc.add_paragraph(style="List Bullet")
    p.add_run(text)
    return p

# Cover page
p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(82)
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("UNIVERSIDAD CENTRAL DE NICARAGUA\nJINOTEPE, CARAZO\nFACULTAD DE INGENIERÍA")
r.bold = True
r.font.name = "Arial"
r.font.size = Pt(12)
r.font.color.rgb = RGBColor(40, 94, 79)

p = doc.add_paragraph(style="Title")
p.paragraph_format.space_before = Pt(46)
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.add_run("Informe de ejecución de pruebas y defectos")

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("MesaExpress")
r.bold = True
r.font.size = Pt(17)
r.font.color.rgb = RGBColor(40, 94, 79)

p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(22)
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.add_run("Asignatura: Implementación y validación de software\n")
p.add_run("Profesor: Pedro Luis Vanegas Lara\n")
p.add_run("Equipo: Andy Dennis Campos · Anthony Agustín Canales · Erick David Guevara · Elias Enmanuel Ruíz\n")
p.add_run("Fecha de ejecución: 22 de octubre de 2026")

p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(52)
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("Anexo para complementar el plan de casos de prueba del proyecto")
r.italic = True
r.font.color.rgb = RGBColor(95, 105, 101)
doc.add_page_break()

doc.add_heading("1. Resumen de resultados", level=1)
doc.add_paragraph(
    "Se ejecutaron manualmente 12 casos sobre el flujo de cliente y el panel del personal. "
    "Los resultados observados fueron satisfactorios en los 12 casos. Once casos cuentan con capturas "
    "incluidas en este anexo; la prueba de límites de cantidad fue reportada como exitosa y grabada en video "
    "por el equipo, pero el archivo de video no se recibió para incorporarlo."
)
summary = doc.add_table(rows=1, cols=3)
for i, val in enumerate(["Indicador", "Resultado", "Alcance"]):
    summary.rows[0].cells[i].text = val
for row in [
    ("Casos ejecutados", "12", "Flujos seleccionados de cliente, Cocina y cuenta"),
    ("Casos satisfactorios reportados", "12", "Sin fallos observados en el alcance ejecutado"),
    ("Evidencias gráficas", "12 capturas", "Una captura de cobertura de límites sigue pendiente"),
    ("Técnica de caja negra", "Análisis de valores límite", "6 de 6 puntos revisados: 100 % de cobertura definida"),
    ("Defectos encontrados en esta ejecución", "0", "No equivale a afirmar que el sistema no tenga defectos"),
]:
    cells = summary.add_row().cells
    for i, val in enumerate(row):
        cells[i].text = val
format_table(summary, font_size=9)

doc.add_heading("2. Alcance y condiciones de ejecución", level=1)
doc.add_paragraph(
    "Las pruebas cubrieron el carrito, la identificación de mesa por QR, el envío de pedidos, "
    "la actualización de estados entre cliente y Cocina, las solicitudes de cuenta y ayuda, la cancelación "
    "de una solicitud y el cierre de una cuenta. Se observaron en paralelo la vista del cliente y la vista del staff."
)
doc.add_paragraph(
    "Datos observados: Mesa 01; producto cacao a C$20.00 por unidad; pedido ALECLR de dos unidades; "
    "subtotal y total de C$40.00; cargo de servicio de C$0.00; pago registrado en efectivo. "
    "La URL exacta, navegador y versión no quedaron registrados en las capturas."
)
doc.add_paragraph(
    "Este informe registra únicamente los casos ejecutados en esta sesión. Los demás casos del plan de pruebas "
    "original permanecen pendientes y sus supuestos anteriores —por ejemplo, un servicio del 10 %— no se "
    "consideran requisitos confirmados para esta ejecución."
)

doc.add_heading("3. Técnica de caja negra y cobertura", level=1)
doc.add_paragraph(
    "Se aplicó análisis de valores límite al control de cantidad por producto, cuyo intervalo visible en la "
    "aplicación es de 1 a 20 unidades. Se verificaron los límites y sus valores interiores adyacentes; también "
    "se intentó sobrepasar ambos extremos mediante los controles de decremento e incremento."
)
bva = doc.add_table(rows=1, cols=4)
for i, val in enumerate(["Punto", "Entrada / acción", "Resultado esperado", "Resultado reportado"]):
    bva.rows[0].cells[i].text = val
for row in [
    ("Límite inferior exterior", "Pulsar − estando en 1 (intento de 0)", "La cantidad permanece en 1", "Correcto"),
    ("Límite inferior", "1", "Aceptado", "Correcto"),
    ("Interior inferior", "2", "Aceptado", "Correcto"),
    ("Interior superior", "19", "Aceptado", "Correcto"),
    ("Límite superior", "20", "Aceptado", "Correcto"),
    ("Límite superior exterior", "Pulsar + estando en 20 (intento de 21)", "La cantidad permanece en 20", "Correcto"),
]:
    cells = bva.add_row().cells
    for i, val in enumerate(row):
        cells[i].text = val
format_table(bva, font_size=8.5)
doc.add_paragraph(
    "Cobertura de la técnica: 6 puntos revisados de 6 definidos = 100 %. Esta cobertura corresponde únicamente "
    "a los valores límite del control de cantidad, no a todas las funciones ni a todo el sistema. El equipo reportó "
    "haber grabado la ejecución; el video no se adjuntó a este anexo y debe incorporarse antes de entregar la versión final."
)

doc.add_heading("4. Casos ejecutados", level=1)
cases = [
    ("TC-01", "Límites de cantidad por producto", "Producto en menú.", "Cantidad 1–20; intentos de bajar a 0 y subir a 21.", "Los valores válidos se aceptan; los controles no permiten rebasar 1 ni 20.", "El equipo reportó que todos los puntos funcionaron correctamente.", "Aprobado; video pendiente", "Video reportado; no adjunto"),
    ("TC-02", "Cálculo del carrito", "Mesa identificada y menú cargado.", "2 × cacao a C$20.00.", "Subtotal C$40.00, servicio C$0.00 y total C$40.00.", "La pantalla mostró los importes y cantidad esperados.", "Aprobado", "E01"),
    ("TC-03", "Identificación de mesa y carrito desde QR", "QR de Mesa 01 disponible.", "Abrir el enlace QR y agregar producto.", "El menú indica Mesa 01 y conserva el artículo en el carrito.", "Se observó Mesa 01 y el carrito con los artículos agregados.", "Aprobado", "E02"),
    ("TC-04", "Envío del pedido al staff", "Cliente y Cocina abiertos; Mesa 01.", "2 × cacao; total C$40.00.", "Se confirma el pedido y aparece en Cocina con estado Recibido.", "ALECLR apareció en ambas vistas como Recibido, con 2 × cacao y C$40.00.", "Aprobado", "E03"),
    ("TC-05", "Actualización a En preparación", "Pedido ALECLR recibido.", "Acción Iniciar preparación en Cocina.", "Cliente y staff muestran En preparación sin recargar.", "Ambas vistas se actualizaron en tiempo real.", "Aprobado", "E04"),
    ("TC-06", "Actualización a Listo", "Pedido ALECLR en preparación.", "Acción Marcar como listo.", "Cliente muestra Listo · esperando al mesero; staff muestra Listo.", "Ambas vistas mostraron el estado esperado.", "Aprobado", "E05"),
    ("TC-07", "Confirmación de entrega", "Pedido ALECLR listo.", "Acción Confirmar entrega.", "Cliente muestra Entregado y el pedido deja Activas en Cocina.", "El cliente mostró Entregado y Cocina indicó cero órdenes activas.", "Aprobado", "E06"),
    ("TC-08", "Solicitud de cuenta con saldo pendiente", "Pedido entregado por C$40.00.", "Solicitar cuenta desde el menú.", "Staff recibe la solicitud con el saldo pendiente de C$40.00.", "La solicitud apareció en el staff y el menú indicó que se preparaba la cuenta.", "Aprobado", "E07"),
    ("TC-09", "Registro de pago y cierre de visita", "Cuenta pendiente de C$40.00.", "Registrar pago en efectivo.", "El pago se registra, la mesa queda disponible y el saldo deja de estar activo.", "La visita se cerró; Mesa 01 quedó disponible y el historial registró C$40.00.", "Aprobado", "E08"),
    ("TC-10", "Bloqueo de cuenta sin saldo pendiente", "Visita cerrada y sin compras pendientes.", "Intentar solicitar cuenta.", "No se crea solicitud y se informa que no hay pedidos pendientes de pago.", "El menú mostró el mensaje y el staff no tenía solicitudes pendientes.", "Aprobado", "E09 y E10"),
    ("TC-11", "Solicitud de ayuda", "Menú de Mesa 01 abierto.", "Pulsar Solicitar ayuda.", "La solicitud aparece en el staff sin recargar y el cliente confirma el aviso.", "Ambas vistas mostraron la solicitud de ayuda pendiente.", "Aprobado", "E11"),
    ("TC-12", "Cancelación de solicitud de ayuda", "Solicitud de ayuda pendiente.", "Pulsar Cancelar solicitud pendiente.", "El cliente confirma la cancelación y el staff retira la solicitud sin recargar.", "El cliente mostró que fue cancelada y el staff quedó sin solicitudes pendientes.", "Aprobado", "E12"),
]

for cid, name, pre, inp, expected, actual, status, ev in cases:
    doc.add_heading(f"{cid} · {name}", level=2)
    for label, value in [("Precondición", pre), ("Entrada o acción", inp), ("Resultado esperado", expected), ("Resultado observado", actual), ("Estado", status), ("Evidencia", ev)]:
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(3)
        r = p.add_run(label + ": ")
        r.bold = True
        p.add_run(value)

doc.add_heading("5. Informe de defectos", level=1)
doc.add_paragraph(
    "No se registraron defectos en los 12 casos ejecutados. Las evidencias E01–E12 respaldan los resultados "
    "observables; para TC-01 falta adjuntar el video reportado. Este resultado se limita al alcance y a las "
    "condiciones de esta ejecución; no demuestra ausencia de defectos en las funciones no probadas."
)
defects = doc.add_table(rows=1, cols=4)
for i, val in enumerate(["ID", "Defecto", "Evidencia", "Estado"]):
    defects.rows[0].cells[i].text = val
cells = defects.add_row().cells
for i, val in enumerate(["—", "Ningún defecto observado en el alcance ejecutado", "E01–E12; evidencia TC-01 pendiente", "Sin defectos reportados"]):
    cells[i].text = val
format_table(defects, font_size=9)

doc.add_heading("6. Casos que siguen pendientes", level=1)
doc.add_paragraph(
    "La ejecución de estos 12 casos no sustituye la batería completa de 20 casos que aparece en el documento base. "
    "Las pruebas de rendimiento, seguridad del parámetro QR, compatibilidad entre navegadores y dispositivos, "
    "pérdida de conexión, usabilidad con cinco usuarios, cobertura interna de código, flujo de datos inspeccionado, "
    "transiciones inválidas y regresiones no se consideran ejecutadas por este informe."
)
doc.add_paragraph(
    "Antes de entregar, el equipo debe agregar el archivo de video de TC-01 y confirmar el nombre de la URL y "
    "el navegador utilizados si el docente exige esos datos en el ambiente de prueba."
)

doc.add_page_break()
doc.add_heading("Anexo A. Evidencias de ejecución", level=1)
doc.add_paragraph("Las capturas se conservan como fueron recibidas y se identifican con el código citado en cada caso.")
for idx, (eid, filename, caption) in enumerate(evidence):
    image_path = EVIDENCE_DIR / f"{eid}_{filename}"
    p = doc.add_paragraph()
    p.paragraph_format.keep_with_next = True
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(f"{eid} · {caption}")
    r.bold = True
    r.font.size = Pt(9.5)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(4)
    p.add_run().add_picture(str(image_path), width=Inches(6.65))
    if idx != len(evidence) - 1:
        doc.add_page_break()

doc.core_properties.title = "Informe de ejecución de pruebas y defectos de MesaExpress"
doc.core_properties.subject = "Casos ejecutados, cobertura de valores límite y evidencia"
doc.core_properties.author = "Equipo MesaExpress"
doc.save(OUT)
print(OUT)
