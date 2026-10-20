"""Optional correctness smoke check against native Ghostscript 10.08 and Poppler."""
from pathlib import Path
import subprocess,tempfile

def run(*args):return subprocess.check_output(args,stderr=subprocess.DEVNULL)
def pages(path):
 lines=run('pdfinfo',str(path)).decode().splitlines();return int(next(line.split(':',1)[1] for line in lines if line.startswith('Pages:')))
def text(path):return run('pdftotext',str(path),'-').decode().strip()
def links(path):return run('pdfinfo','-url',str(path)).decode().count('https://example.org')
def pixels(path,out):
 subprocess.run(['gs','-q','-dSAFER','-dBATCH','-dNOPAUSE','-sDEVICE=ppmraw','-r72','-sOutputFile='+str(out),str(path)],check=True,stdout=subprocess.DEVNULL);return out.read_bytes().split(b'\n',3)[3]
with tempfile.TemporaryDirectory() as tmp:
 directory=Path(tmp);results=[]
 for name in ['scan','text-vector','mixed','already-optimized','multipage']:
  source=Path('tests/fixtures')/(name+'.pdf');output=directory/(name+'.pdf');args=['gs','-q','-dSAFER','-dBATCH','-dNOPAUSE','-sDEVICE=pdfwrite','-dAutoFilterColorImages=false','-dColorImageFilter=/DCTEncode','-sOutputFile='+str(output),'-c','<< /ColorImageDict << /QFactor 0.25 /Blend 1 /HSamples [1 1 1 1] /VSamples [1 1 1 1] >> >> setdistillerparams','-f',str(source)];subprocess.run(args,check=True,stdout=subprocess.DEVNULL)
  assert pages(source)==pages(output),(name,'pages');assert (not text(source)) or text(source)==text(output),(name,'text');assert links(source)==links(output),(name,'links');assert output.stat().st_size>0
  if name=='scan':
   assert output.stat().st_size<source.stat().st_size,(name,'size');before=pixels(source,directory/'before.ppm');after=pixels(output,directory/'after.ppm');assert len(before)==len(after);mean=sum(abs(a-b) for a,b in zip(before,after))/len(before);assert mean<12,(name,'visual difference',mean)
  results.append((name,source.stat().st_size,output.stat().st_size,pages(output)))
 for row in results:print(*row)
 print('5 native PDF fixtures passed')
