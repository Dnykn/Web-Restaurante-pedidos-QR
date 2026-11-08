from pypdf import PdfReader
from pptx import Presentation
import sys
sys.stdout.reconfigure(encoding='utf-8')
for f in [r'C:\Users\Andy\Downloads\MesaExpress_1er_Entregable_Design_Thinking.pdf',r'C:\Users\Andy\Downloads\Rubrica de Evaluación 1P IVS.xlsx - Hoja1 (4).pdf']:
 reader=PdfReader(f); print('\n###',f,'pages',len(reader.pages))
 for i,p in enumerate(reader.pages): print(f'--PAGE {i+1}--\n{p.extract_text()[:3200]}')
ppt=Presentation(r'C:\Users\Andy\Downloads\🖥presentación  de proyectos 🖥.pptx')
print('\n### PPTX SLIDES',len(ppt.slides))
for i,s in enumerate(ppt.slides):
 print(f'--SLIDE {i+1}--')
 for sh in s.shapes:
  if getattr(sh,'has_text_frame',False) and sh.text.strip(): print(sh.text)
