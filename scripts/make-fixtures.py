"""Generate small, deterministic PDF correctness fixtures without third-party packages."""
from pathlib import Path
import zlib, random
OUT=Path('tests/fixtures');OUT.mkdir(parents=True,exist_ok=True)
class PDF:
 def __init__(self):self.objects=[]
 def add(self,data):self.objects.append(data if isinstance(data,bytes) else data.encode());return len(self.objects)
 def save(self,path,root):
  out=bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');offsets=[0]
  for n,obj in enumerate(self.objects,1):offsets.append(len(out));out.extend(f'{n} 0 obj\n'.encode()+obj+b'\nendobj\n')
  start=len(out);out.extend(f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode())
  for x in offsets[1:]:out.extend(f'{x:010d} 00000 n \n'.encode())
  out.extend(f'trailer\n<< /Size {len(offsets)} /Root {root} 0 R >>\nstartxref\n{start}\n%%EOF\n'.encode());path.write_bytes(out)
def stream(data,extra=''):
 return f'<< /Length {len(data)} {extra} >>\nstream\n'.encode()+data+b'\nendstream'
def build(path,pages=1,image=False,text=False):
 pdf=PDF();catalog=pdf.add('');page_tree=pdf.add('');font=pdf.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>') if text else 0
 img=0
 if image:
  rng=random.Random(1729);raw=bytes(rng.randrange(256) for _ in range(450*450*3));encoded=zlib.compress(raw,6)
  img=pdf.add(stream(encoded,'/Type /XObject /Subtype /Image /Width 450 /Height 450 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode'))
 page_ids=[]
 for n in range(pages):
  content=b''
  if image:content+=b'q 450 0 0 450 72 250 cm /Im1 Do Q\n'
  if text:content+=f'BT /F1 20 Tf 72 180 Td (Selectable page {n+1}) Tj ET\n'.encode()
  if not content:content=b'0 0 0 RG 72 72 450 650 re S\n'
  contents=pdf.add(stream(content));annotation=pdf.add('<< /Type /Annot /Subtype /Link /Rect [72 170 240 205] /Border [0 0 0] /A << /S /URI /URI (https://example.org) >> >>') if text else 0;resources='<<'
  if img:resources+=f' /XObject << /Im1 {img} 0 R >>'
  if font:resources+=f' /Font << /F1 {font} 0 R >>'
  resources+=' >>';annots=f'/Annots [{annotation} 0 R]' if annotation else '';page=pdf.add(f'<< /Type /Page /Parent {page_tree} 0 R /MediaBox [0 0 595 842] /Resources {resources} /Contents {contents} 0 R {annots} >>');page_ids.append(page)
 pdf.objects[page_tree-1]=(f'<< /Type /Pages /Count {pages} /Kids [ '+''.join(f'{p} 0 R ' for p in page_ids)+'] >>').encode();pdf.objects[catalog-1]=f'<< /Type /Catalog /Pages {page_tree} 0 R >>'.encode();pdf.save(OUT/path,catalog)
build('scan.pdf',image=True);build('text-vector.pdf',text=True);build('mixed.pdf',image=True,text=True);build('multipage.pdf',pages=3,image=True,text=True);build('already-optimized.pdf',text=True);(OUT/'corrupted.pdf').write_bytes(b'%PDF-1.4\nnot a complete PDF')

# A visible text-field widget exercises the unsupported-form guard.
form=PDF();catalog=form.add('');tree=form.add('');font=form.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
content=form.add(stream(b'BT /F1 20 Tf 72 700 Td (Form fixture) Tj ET'))
widget=form.add('<< /Type /Annot /Subtype /Widget /FT /Tx /T (Name) /V (Synthetic value) /Rect [72 600 300 640] /F 4 >>')
page=form.add(f'<< /Type /Page /Parent {tree} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 {font} 0 R >> >> /Contents {content} 0 R /Annots [{widget} 0 R] >>')
form.objects[tree-1]=f'<< /Type /Pages /Count 1 /Kids [{page} 0 R] >>'.encode()
form.objects[catalog-1]=f'<< /Type /Catalog /Pages {tree} 0 R /AcroForm << /Fields [{widget} 0 R] /DA (/F1 12 Tf 0 g) /DR << /Font << /F1 {font} 0 R >> >> >> >>'.encode()
form.save(OUT/'form.pdf',catalog)
