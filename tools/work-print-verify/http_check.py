from urllib import request,error
import shutil
import json,sys,uuid,http.cookiejar,datetime,base64
from pathlib import Path
out=Path(sys.argv[3]);out.mkdir(parents=True,exist_ok=True);port,mode=sys.argv[1:3];assert port.isdecimal() and mode in ('http','off','missing','stress','recover','counts');base='http://127.0.0.1:'+port;root='/api/pop/work-print';log=[]
def user():return request.build_opener(request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def call(c,path,body=None,code=200,method=None):
 url=base+(path if path.startswith('/api') else root+path)
 req=request.Request(url,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json'},method=method)
 try:res=c.open(req,timeout=60)
 except error.HTTPError as e:res=e
 data=res.read();assert res.status==code,(path,res.status,code,data[:500])
 return data if res.headers.get_content_type() in ('image/png','application/pdf') else json.loads(data or '{}')
def login(c,worker='DEMO-W01',term='DEMO-A'):
 return call(c,'/api/pop/session',dict(terminalId=term,identifier=worker,method='manual',passcode='demo-only'))
def ok(msg):log.append(msg);print(msg,flush=True)
def uid():return str(uuid.uuid4())
a,b,c=user(),user(),user();call(a,'/options',code=401);login(a);login(b,'DEMO-W02');login(c,'DEMO-W03','DEMO-B');opt=call(a,'/options');day=opt['today']
f=dict(start=day,end=day,center='000',complete='미완료',printed='미출력',closed=False,drawing=False,operator='',materials=[x[0] for x in opt['materials']],accounts=['제품','상품','교환','자재'])
search=lambda who=a,**kw:call(who,'/search',f|kw)
rows=search();assert rows[0]['fields']['ORDER_NO']>=rows[-1]['fields']['ORDER_NO'];rows.sort(key=lambda r:(r['fields']['ORDER_NO'],int(r['fields']['ORDER_SEQNO'])));keys=[r['key'] for r in rows];assert len(keys)==(28 if mode=="stress" else 12),(opt,len(keys))
if mode=='stress':
 for form,n,expected in [('Single',3,2),('Multiple',15,3),('Multiple1',11,2),('Multiple1',12,2),('Multiple2',26,2),('Multiple2',27,2),('Multiple3',27,2),('Multiple3',28,2)]:
  v=call(a,'/preview',dict(key=uid(),form=form,rows=keys[:n]));url='/preview/'+v['id']
  pdf=call(a,url+'/pdf');(out/(form+'-'+str(n)+'.pdf')).write_bytes(pdf)
  (out/(form+'-'+str(n)+'.groups')).write_text('\n'.join(v['groups']),encoding='utf8')
  for i in range(1,v['pages']+1):(out/(form+'-'+str(n)+'-'+str(i)+'.png')).write_bytes(call(a,url+'/'+str(i)))
  print(form,n,v['pages'],v['groups'],flush=True);assert v['pages']==expected,(form,n,v)
 sys.exit()
foreign=search(c)[0]['key'];p=lambda form,ks:dict(key=uid(),form=form,rows=ks)
call(b,'/preview',p('Multiple2',keys[:1]),403);call(a,'/preview',p('Single',[foreign]),404);call(a,'/preview',p('Single',[]),400)
closed=search(closed=True)[0]['key'];call(a,'/preview',p('Single',[closed]),409)
assert len(search(drawing=True))==1 and not search(operator='시험') and len(search(operator='시험 담당'))==12
assert len(search(accounts=[]))==1 and not search(materials=[]) and len(search(complete='완료'))==1
assert len(search(printed='ERP'))==1 and len(search(printed='POP'))==1
ok('401 / delegated fixture grant 403 / factory 404 / closed 409 / empty 400 / exact operator, account, material, drawing, completion and ERP/POP filters')
yesterday=str(datetime.date.fromisoformat(day)-datetime.timedelta(days=1))
old=search(start=yesterday,end=yesterday);assert len(old)==1;call(a,'/preview',p('Single',[old[0]['key']]),422)
ok('nonempty SINGLE_SELECT2 held before renderer and count; normal fixture explicitly represents SELECT3')
if mode=='recover':
 font=Path(sys.argv[4]);assert not font.exists()
 cmd=p('Multiple2',keys[:2])
 for source in [None,'invalid',sys.argv[6]]:
  if source=='invalid':font.write_bytes(b'invalid font')
  elif source:shutil.copyfile(source,font)
  call(a,'/preview',cmd,503);assert set(keys)=={r['key'] for r in search()}
 shutil.copyfile(sys.argv[5],font)
 v=call(a,'/preview',cmd);assert v==call(a,'/preview',cmd) and v['groups'][0].endswith('000001')
 assert set(keys)=={r['key'] for r in search()}
 ok('missing, malformed, Latin-only font: each 503; same preview key after valid font, group 000001, 12 unprinted rows')
 (out/'http-recover.txt').write_text('\n'.join(log),encoding='utf8');sys.exit()
if mode=='missing':
 call(a,'/preview',p('Multiple2',keys[:1]),503)
 assert len(search())==12
 ok('missing font returns 503 before receipt, group publication, or count')
 (out/'http-missing.txt').write_text('\n'.join(log)+'\n',encoding='utf8')
 sys.exit()
special=p('Multiple2',keys[:1]);doc=call(a,'/preview',special);assert doc==call(a,'/preview',special)
call(a,'/preview',special|{'rows':keys[:2]},409);call(b,'/preview/'+doc['id']+'/1',code=404)
call(a,'/preview/'+doc['id']+'/close',{});assert set(keys)=={r['key'] for r in search()}
call(a,'/preview/'+doc['id']+'/pdf',code=404)
call(a,'/preview/'+doc['id']+'/submit',{'key':doc['submitKey']},403 if mode=='off' else 404)
call(a,'/preview',special,409)
second=call(a,'/preview',p('Multiple3',keys[:1]));assert second['groups'][0][-6:]=='000002'
ok('manual close: count unchanged; special group preserved; first preview replay same group; next group 000002')
if mode=='off':
 call(a,'/preview/'+second['id']+'/submit',{'key':second['submitKey']},403)
 assert len(search())==12;ok('default diagnostic OFF prevents synthetic submission, unchanged count')
else:
 call(a,'/preview/'+second['id']+'/submit',{'key':second['submitKey']},422)
 path='/api/pop/admin/terminal-settings/DEMO-A';admin=user();call(admin,'/api/pop/session',dict(terminalId='DEMO-A',method='scan',identifier='0000'));view=call(admin,path)['view'];devices=view['catalog']['printers']
 call(admin,path+'/printers',dict(expectedVersion=view['saved']['version'],outputs=dict(document=devices[0],shipment=devices[2],label=devices[3])),method='PUT')
 login(a); ok('unregistered Printer1 rejects 422 before any count; explicitly register demo device and re-login')
 if mode=='counts':
  for i,form in enumerate(('Single','Multiple','Multiple1','Multiple2','Multiple3')):
   cmd=p(form,[keys[i]]);v=call(a,'/preview',cmd)
   url='/preview/'+v['id'];call(a,url+'/pdf');call(a,url+'/1')
   assert any(r['key']==keys[i] for r in search())
   req=request.Request(base+root+url+'/submit',data=json.dumps({'key':v['submitKey']}).encode(),headers={'Content-Type':'application/json'})
   # Deliberately abandon the first successful receipt body after the server sent its headers.
   with a.open(req,timeout=60) as response:assert response.status==200
   receipt=call(a,url+'/submit',{'key':v['submitKey']});assert receipt['rows']==1
   assert {r['key'] for r in search(printed='POP') if r['key'] in keys and r['fields']['PRINT_CNT']=='1'}==set(keys[:i+1])
   call(a,url+'/close',{})
  ok('all five forms: PDF + PNG reads count zero; abandoned submit receipt, same key replay, one increment on each selected row, seven unprinted')
  (out/'http-counts.txt').write_text('\n'.join(log),encoding='utf8');sys.exit()
 docs=[]
 for form in ('Single','Multiple','Multiple1','Multiple2','Multiple3'):
  q=p(form,keys[:9]);v=call(a,'/preview',q);docs.append([form,v['pages'],v['groups']])
  assert v['pages']>=1;img=call(a,'/preview/'+v['id']+'/1');assert img[:8]==b'\x89PNG\r\n\x1a\n'
  url='/preview/'+v['id']+'/pdf'
  pdf=call(a,url);assert pdf.startswith(b'%PDF-') and pdf==call(a,url)
  assert v==call(a,'/preview',q) and pdf==call(a,url)
  call(user(),url,code=401);call(b,url,code=404)
  (out/(form+'-9.pdf')).write_bytes(pdf);(out/(form+'-9-1.png')).write_bytes(img)
  (out/(form+'-9.groups')).write_text('\n'.join(v['groups']),encoding='utf8')
  for i in range(2,v['pages']+1):(out/(form+'-9-'+str(i)+'.png')).write_bytes(call(a,'/preview/'+v['id']+'/'+str(i)))
  call(a,'/preview/'+v['id']+'/'+str(v['pages']+1),code=404)
 ok('five live report templates, nine selected details, plate splits into seven plus two and merges on A4: '+str(docs))
 endpoint='/preview/'+v['id']+'/submit';body={'key':v['submitKey']}
 call(a,endpoint,{'key':uid()},409);receipt=call(a,endpoint,body);assert receipt==call(a,endpoint,body)
 printed=search(printed='POP');assert sum(r['key'] in keys[:9] and r['fields']['PRINT_CNT']=='1' for r in printed)==9
 ok('submit exact retry: 9 selected rows +1 each, receipt '+str(receipt))
 no=rows[0]['fields']['ORDER_NO'];call(a,'/delete/scan',{'barcode':no+'12'},400)
 ticket=call(a,'/delete/scan',{'barcode':no+'9999'});assert ticket['performance']
 call(b,'/delete/confirm',{'token':ticket['token'],'includeResults':True},409)
 call(a,'/delete/confirm',{'token':ticket['token'],'includeResults':False},409)
 assert len(search(printed='POP'))==len(printed)
 res={'token':ticket['token'],'includeResults':True};call(a,'/delete/confirm',res);call(a,'/delete/confirm',res)
 assert not any(r['key'] in keys[:9] for r in search(printed='전체'))
 other=rows[9]['fields']['ORDER_NO'];ticket=call(a,'/delete/scan',{'barcode':other});assert not ticket['performance']
 call(a,'/delete/confirm',{'token':ticket['token'],'includeResults':False});assert len(search(c))==1
 ok('12/16-digit scan; first day/distinct plan seq; second confirmation and cancellation leave rows intact; delete both branches; replay and other factory isolated')
(out/('http-'+mode+'.txt')).write_text('\n'.join(log)+'\n',encoding='utf8')
