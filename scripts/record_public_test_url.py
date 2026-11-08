from pathlib import Path
from docx import Document

path = Path(r"C:\Users\Andy\Documents\mesa_express\Informe_Pruebas_y_Defectos_MesaExpress.docx")
doc = Document(path)
target = next((p for p in doc.paragraphs if p.text.startswith("Datos observados:")), None)
if target is None:
    raise RuntimeError("No se encontró la sección de ambiente de prueba.")
old = "URL pública usada: pendiente de confirmación del equipo."
new = (
    "URL pública de la aplicación: https://dnykn.github.io/Web-Restaurante-pedidos-QR/menu.html. "
    "Escenario QR: mesa=01; el token de acceso se omite del informe."
)
if old not in target.text:
    raise RuntimeError("No se encontró el marcador de URL pendiente.")
target.text = target.text.replace(old, new)
doc.save(path)
print(path)
