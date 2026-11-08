from docx import Document
from pathlib import Path
import sys
sys.stdout.reconfigure(encoding='utf-8')
files=[Path(r'C:\Users\Andy\Downloads\MesaExpress_Casos_de_Prueba.docx'),Path(r'C:\Users\Andy\Downloads\Informe_Pruebas_y_Defectos_MesaExpress.docx'),Path(r'C:\Users\Andy\Documents\mesa_express\Informe_Pruebas_y_Defectos_MesaExpress.docx')]
for f in files:
 print('\n###',f, f.exists())
 if f.exists():
  d=Document(f)
  for p in d.paragraphs:
   if p.text.strip(): print(p.text)
  for ti,t in enumerate(d.tables):
   print('TABLE',ti)
   for row in t.rows: print(' | '.join(c.text.replace('\n',' / ') for c in row.cells))
