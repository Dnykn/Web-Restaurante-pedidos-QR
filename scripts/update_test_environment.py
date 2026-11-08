from pathlib import Path
import shutil

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.text.paragraph import Paragraph
from docx.shared import Inches, Pt, RGBColor

root = Path(r"C:\Users\Andy\Documents\mesa_express")
docx_path = root / "Informe_Pruebas_y_Defectos_MesaExpress.docx"
source_image = Path(r"C:\Users\Andy\AppData\Local\Temp\codex-clipboard-6964b03d-61d2-4bca-8ae9-5e148a6669da.png")
image_path = root / "evidencia_pruebas" / "E14_OperaGX_ambiente.png"
shutil.copy2(source_image, image_path)

doc = Document(docx_path)
env_paragraph = next((p for p in doc.paragraphs if p.text.startswith("Datos observados:")), None)
if env_paragraph is None:
    raise RuntimeError("No se encontró el párrafo de datos de ambiente.")

env_paragraph.text = (
    "Datos observados: Mesa 01; producto cacao a C$20.00 por unidad; pedido ALECLR de dos unidades; "
    "subtotal y total de C$40.00; cargo de servicio de C$0.00; pago registrado en efectivo. "
    "Ambiente: Windows 11 de 64 bits; Opera GX Early Access 138.0.6044.45; Chromium 154.0.8037.99. "
    "URL pública usada: pendiente de confirmación del equipo."
)

caption_xml = OxmlElement("w:p")
env_paragraph._p.addnext(caption_xml)
caption = Paragraph(caption_xml, env_paragraph._parent)
caption.paragraph_format.keep_with_next = True
caption.paragraph_format.space_before = Pt(2)
caption.paragraph_format.space_after = Pt(3)
run = caption.add_run("E14 · Captura de la versión del navegador y sistema operativo")
run.bold = True
run.font.name = "Arial"
run.font.size = Pt(9)
run.font.color.rgb = RGBColor(40, 94, 79)
caption.alignment = WD_ALIGN_PARAGRAPH.CENTER

image_xml = OxmlElement("w:p")
caption._p.addnext(image_xml)
image_paragraph = Paragraph(image_xml, caption._parent)
image_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
image_paragraph.paragraph_format.space_after = Pt(6)
image_paragraph.add_run().add_picture(str(image_path), width=Inches(6.1))

doc.save(docx_path)
print(docx_path)
