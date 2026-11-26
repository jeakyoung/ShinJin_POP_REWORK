"""Build only the five data-bound report classes and typed DataSets for offline original-report comparisons only."""
from pathlib import Path
import subprocess,sys,tempfile
root,out=map(lambda a:Path(a).resolve(),sys.argv[1:3]);dll=root/'OUTPUT/temp'
out.mkdir(parents=True,exist_ok=True)
sources=[];resources=[]
for name in ['A4MergedReport','rptSingleWorkOrders','rptMultipleCustomerWorkOrders','rptMultipleCustomerWorkOrders2','rptMultipleCustomerWorkOrders3','rptMultipleCustomerWorkOrders4','dtSingleWorkOders','dtMultipleWorkOders']:
 for suffix in ('.cs','.Designer.cs'):
  f=root/'REPORT'/(name+suffix)
  if f.exists():
   body=f.read_text(encoding='utf-8-sig')
   if any(x in body for x in ('SqlConnection','System.Net.','SqlDataAdapter','.Print()','PrintDialog(')):
    raise RuntimeError('Report dependency needs review: '+str(f))
   sources.append(str(f))
 res=root/'REPORT/obj/Debug'/('REPORT.'+name+'.resources')
 if res.exists():resources.append('/resource:'+str(res)+','+res.name)
refs=['System','System.Core','System.Data','System.Data.DataSetExtensions','System.Drawing','System.Windows.Forms','System.Xml','System.Web.Extensions','System.Xml.Linq','System.ComponentModel.DataAnnotations']
args=['/nologo','/target:exe','/out:'+str(out/'WorkPrintRender.exe')]+['/r:'+r+'.dll' for r in refs]
for name in ('DevExpress.Data','DevExpress.Data.Desktop','DevExpress.Drawing','DevExpress.XtraReports','DevExpress.Printing','DevExpress.Utils','DevExpress.DataAccess','DevExpress.RichEdit'):
 args+=['/r:'+str(f) for f in dll.glob(name+'.v23.1*.dll')]
with tempfile.TemporaryDirectory() as tmp:
 p=Path(tmp);dep=p/'Dependencies.cs'
 dep.write_text('static class Dependencies {public const string Directory = @"'+str(dll).replace('"','""')+'";}',encoding='utf-8-sig')
 rsp=p/'args.rsp';rsp.write_text('\n'.join('"'+v+'"' for v in args+resources+sources+[str(dep),str(Path(__file__).with_name('WorkPrintRender.cs'))]),encoding='utf-8-sig')
 subprocess.run(['C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe','@'+str(rsp)],cwd=out,check=True)
