from pathlib import Path
import shutil

from docx import Document
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor


root = Path(r"C:\Users\Andy\Documents\mesa_express")
source_docx = Path(r"C:\Users\Andy\Downloads\Informe_Pruebas_y_Defectos_MesaExpress.docx")
source_video = Path(r"C:\Users\Andy\Downloads\WhatsApp Video 2026-10-22 at 7.58.48 PM.mp4")
output_docx = root / "Informe_Pruebas_y_Defectos_MesaExpress.docx"
temp_docx = root / "Informe_Pruebas_y_Defectos_MesaExpress.revised.docx"
video_name = "Evidencia_TC-01_Limites_de_cantidad.mp4"
output_video = root / video_name

shutil.copy2(source_video, output_video)
doc = Document(source_docx)

replacements = [
    (
        "Se ejecutaron manualmente 12 casos sobre el flujo de cliente y el panel del personal. Los resultados observados fueron satisfactorios en los 12 casos. Once casos cuentan con capturas incluidas en este anexo; la prueba de límites de cantidad fue reportada como exitosa y grabada en video por el equipo, pero el archivo de video no se recibió para incorporarlo.",
        "Se ejecutaron manualmente 12 casos sobre el flujo de cliente y el panel del personal. Los resultados observados fueron satisfactorios en los 12 casos. Once casos cuentan con capturas incluidas en este anexo y TC-01 cuenta con evidencia audiovisual adjunta al final como E13.",
    ),
    (
        "Cobertura de la técnica: 6 puntos revisados de 6 definidos = 100 %. Esta cobertura corresponde únicamente a los valores límite del control de cantidad, no a todas las funciones ni a todo el sistema. El equipo reportó haber grabado la ejecución; el video no se adjuntó a este anexo y debe incorporarse antes de entregar la versión final.",
        "Cobertura de la técnica: 6 puntos revisados de 6 definidos = 100 %. Esta cobertura corresponde únicamente a los valores límite del control de cantidad, no a todas las funciones ni a todo el sistema. El video de la ejecución se adjunta al final de este documento como evidencia E13.",
    ),
    ("Estado: Aprobado; video pendiente", "Estado: Aprobado"),
    ("Evidencia: Video reportado; no adjunto", "Evidencia: E13 · video adjunto al final"),
    (
        "No se registraron defectos en los 12 casos ejecutados. Las evidencias E01–E12 respaldan los resultados observables; para TC-01 falta adjuntar el video reportado. Este resultado se limita al alcance y a las condiciones de esta ejecución; no demuestra ausencia de defectos en las funciones no probadas.",
        "No se registraron defectos en los 12 casos ejecutados. Las evidencias E01–E13 respaldan los resultados observables. Este resultado se limita al alcance y a las condiciones de esta ejecución; no demuestra ausencia de defectos en las funciones no probadas.",
    ),
    (
        "Antes de entregar, el equipo debe agregar el archivo de video de TC-01 y confirmar el nombre de la URL y el navegador utilizados si el docente exige esos datos en el ambiente de prueba.",
        "Si el docente exige mayor detalle del ambiente, el equipo puede añadir la URL y la versión del navegador utilizados, datos que no quedaron registrados en las capturas.",
    ),
]

found = [False] * len(replacements)
for p in doc.paragraphs:
    text = p.text
    for i, (old, new) in enumerate(replacements):
        if old in text:
            p.text = text.replace(old, new)
            found[i] = True

# Update the defect register evidence reference.
for table in doc.tables:
    for row in table.rows:
        for cell in row.cells:
            if "E01–E12; evidencia TC-01 pendiente" in cell.text:
                cell.text = cell.text.replace("E01–E12; evidencia TC-01 pendiente", "E01–E13")

missing = [i for i, ok in enumerate(found) if not ok]
if missing:
    raise RuntimeError(f"No se encontraron todos los textos esperados para corregir: {missing}")

# Add a portable relative link so the document and MP4 can be submitted in one folder.
doc.add_page_break()
heading = doc.add_heading("Anexo B. Evidencia audiovisual TC-01", level=1)
heading.paragraph_format.keep_with_next = True
p = doc.add_paragraph()
p.add_run("Archivo: ").bold = True
p.add_run(video_name)

p = doc.add_paragraph()
p.add_run("Descripción: ").bold = True
p.add_run(
    "Se verificó el rango permitido de 1 a 20 unidades por producto: mínimo (1), valores interiores (2 y 19), "
    "máximo (20) e intentos de exceder ambos límites. El control mantuvo los valores dentro del rango esperado. "
    "Resultado: aprobado. Cobertura: 6 de 6 puntos (100 %) para el análisis de valores límite de este control."
)

p = doc.add_paragraph()
run = p.add_run("Abrir video de evidencia E13")
run.bold = True
run.font.color.rgb = RGBColor(39, 104, 88)
run.font.size = Pt(12)
rel_id = p.part.relate_to(video_name, RT.HYPERLINK, is_external=True)
hyperlink = OxmlElement("w:hyperlink")
hyperlink.set(qn("r:id"), rel_id)
run_element = p.runs[-1]._r
hyperlink.append(run_element)
p._p.append(hyperlink)

p = doc.add_paragraph()
p.add_run("Entrega conjunta: ").bold = True
p.add_run("mantener este archivo Word y el MP4 en la misma carpeta para que el enlace relativo funcione.")

doc.core_properties.title = "Informe de ejecución de pruebas y defectos de MesaExpress"
doc.save(temp_docx)
temp_docx.replace(output_docx)
print(output_docx)
print(output_video)
