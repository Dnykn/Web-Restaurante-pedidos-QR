from pptx import Presentation
p = r'C:\Users\Andy\Downloads\🖥presentación  de proyectos 🖥.pptx'
r = Presentation(p)
print('SLIDES', len(r.slides))
for i, s in enumerate(r.slides, 1):
    print(f'\n===== SLIDE {i} =====')
    for sh in s.shapes:
        if getattr(sh, 'has_text_frame', False) and sh.text.strip():
            print(sh.text.replace('\n', ' / '))
        elif sh.shape_type == 13:
            print('[IMAGE]', sh.width, sh.height)
