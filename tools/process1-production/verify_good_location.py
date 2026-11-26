"""Run after building the React bundle. Requires Python Playwright, Chrome and Java 17+. Uses an isolated demo server."""
import os,socket,time,sys,subprocess,urllib.request,http.client
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright,expect
def port():
 with socket.socket() as s:
  s.bind(("127.0.0.1",0))
  return s.getsockname()[1]
import argparse,tempfile
repo=Path(__file__).resolve().parents[2]
args=argparse.ArgumentParser(description='001 양품위치 합성 브라우저 검증')
args.add_argument('jar',type=Path)
args.add_argument('evidence',type=Path,help='합성 검증 캡처와 측정 JSON을 저장할 디렉터리')
args=args.parse_args()
args.evidence.mkdir(parents=True,exist_ok=True)
scratch=tempfile.TemporaryDirectory(prefix='pop-good-location-')
root=Path(scratch.name)
api=port()
jar=args.jar.resolve()
log=(root/"spring.log").open("wb")
import tempfile
local_store=root/"session-details.json"
import json, tempfile,uuid
resources=repo/'src/api/src/main/resources/demo'
fixture=json.loads((resources/'process1-production.json').read_text('utf-8'))
fixture['terminals']['DEMO-A']['good']=['WH-GOOD-A2','WH-GOOD-A']
custom=local_store.parent/'process.json';custom.write_text(json.dumps(fixture,ensure_ascii=False),'utf-8')
placeData=json.loads((resources/'good-product-locations.json').read_text('utf-8'))
long='합성양품위치명현장작업자창고선택문자길이측정'
# Put the opening code outside the second warehouse to exercise unbound EditValue.
second=placeData['terminals']['DEMO-A']['warehouses'][1]
second['locations']=[loc for loc in second['locations'] if loc['code']!='GOOD-01']
for warehouse in placeData['terminals']['DEMO-A']['warehouses']:
 warehouse['name']=long+warehouse['code']
 for loc in warehouse['locations']:loc['name']=long+loc['code']
placeFile=local_store.parent/'places.json';placeFile.write_text(json.dumps(placeData,ensure_ascii=False),'utf-8')
java = str(Path(os.environ["JAVA_HOME"]) / "bin" / ("java.exe" if os.name == "nt" else "java")) if os.getenv("JAVA_HOME") else "java"
proc=subprocess.Popen([java,"-jar",str(jar),"--spring.profiles.active=demo","--shinjin.demo.process1-production="+custom.as_uri(),"--shinjin.demo.good-product-locations="+placeFile.as_uri(),"--shinjin.prelogin.local-store="+str(local_store),"--server.address=127.0.0.1","--server.port="+str(api)],stdout=log,stderr=log)
dist=repo/'src/web/dist'
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(dist),**kwargs)
 def log_message(self,*args):pass
 def relay(self):
  conn=http.client.HTTPConnection("127.0.0.1",api,timeout=10)
  try:
   body=self.rfile.read(int(self.headers.get("Content-Length",0))) or None
   conn.request(self.command,self.path,body,{k:v for k,v in self.headers.items() if k.lower() not in ("host","connection")})
   resp=conn.getresponse()
   content=resp.read();self.send_response(resp.status)
   for k,v in resp.getheaders():
    if k.lower() not in ("content-length","transfer-encoding","connection","date","server"):self.send_header(k,v)
   self.send_header("Content-Length",str(len(content)));self.end_headers();self.wfile.write(content)
  finally:conn.close()
 def do_GET(self):
  if self.path.startswith("/api/"):self.relay()
  else:super().do_GET()
 do_POST=relay
 do_PUT=relay
srv=ThreadingHTTPServer(("127.0.0.1",0),Handler)
Thread(target=srv.serve_forever,daemon=True).start()
base="http://127.0.0.1:"+str(srv.server_port)
try:
 for i in range(150):
  if proc.poll() is not None:raise RuntimeError((root/"spring.log").read_text("utf-8",errors="replace")[-2400:])
  try:
   with socket.create_connection(("127.0.0.1",api),timeout=.1):break
  except OSError:time.sleep(.1)


 report={};review=args.evidence
 with sync_playwright() as pw:
  browser=pw.chromium.launch(channel='chrome');ctx=browser.new_context(has_touch=True)
  assert ctx.request.post(base+'/api/pop/session',data={'terminalId':'DEMO-A','method':'scan','identifier':'0000'}).ok
  apiurl=base+'/api/pop/work-orders';day='2026-11-25';head=apiurl+'/'+day
  page=ctx.new_page();page.set_default_timeout(6000)
  def b(n):return page.get_by_role('button',name=n,exact=True)
  def row(seq):return next(x for x in ctx.request.get(apiurl+'/production').json() if x['sequence']==seq)
  getter=head+'/101/good-locations?slot=1'
  assert browser.new_context().request.get(getter).status==401
  assert ctx.request.get(head+'/101/good-locations?slot=6').status==403
  assert ctx.request.get(head+'/201/good-locations?slot=1').status==404
  choices=ctx.request.get(getter).json();assert [w['code'] for w in choices['warehouses']]==['WH-GOOD-A2','WH-GOOD-A'],choices
  assert choices['current']['workStatus']=='LC' and row(102)['goodPlace']['workStatus']=='JC'
  for w,h in [(1280,800),(1366,768),(1024,768)]:
   page.set_viewport_size({'width':w,'height':h});page.goto(base);page.locator('[data-slot="1"]').tap()
   whCell=b(day+'/101 창고명');locCell=b(day+'/101 로케이션');d=page.get_by_role('dialog',name='양품 창고 및 로케이션')
   expect(whCell).to_have_text(long+'WH-GOOD-A');whCell.tap();expect(d).to_be_visible()
   def measure(sel,key):
    val=sel.evaluate("""e=>{let r=e.getBoundingClientRect(), items=[...e.querySelectorAll('button')].filter(b=>b.checkVisibility());return {rect:[r.x,r.y,r.width,r.height],hits:items.every(b=>{let a=b.getBoundingClientRect();return b.contains(document.elementFromPoint(a.x+a.width/2,a.y+a.height/2))}),overlap:[...e.querySelectorAll('button:has(>i)')].some(b=>{let t=[...b.childNodes].find(n=>n.nodeType===3);if(!t)return false;let range=new Range();range.selectNodeContents(t);return [...range.getClientRects()].some(r=>r.right>b.querySelector('i').getBoundingClientRect().left+1)})}}""")
    assert val['hits'] and not val['overlap'],(key,val);report[f'{w}x{h}/{key}']=val
   assert d.evaluate("e=>e.matches(':modal') && e.contains(document.activeElement)")
   measure(d,'dialog')
   if w==1280:page.screenshot(path=str(review/'good-place.png'))
   d.get_by_role('button',name='양품 창고 조회').tap();lst=d.get_by_role('listbox');measure(lst,'warehouse-list')
   if w==1280:page.screenshot(path=str(review/'good-warehouse.png'))
   lst.get_by_role('option').first.tap()
   d.get_by_role('button',name='양품 로케이션 조회').tap();lst=d.get_by_role('listbox');measure(lst,'location-list')
   if w==1280:page.screenshot(path=str(review/'good-location.png'))
   lst.get_by_role('option').last.tap();d.get_by_role('button',name='취소').tap();expect(whCell).to_have_text(long+'WH-GOOD-A')
   locCell.tap();d.get_by_role('button',name='양품 창고 조회').tap();d.get_by_role('option').first.tap()
   expect(d.get_by_role('button',name='양품 로케이션 조회')).to_have_text('')
   d.get_by_role('button',name='적용').tap();b('예').tap();expect(locCell).to_have_text('')
   # Reopening the row preserves its unapplied code. Returning to the original warehouse recovers the name.
   locCell.tap();d.get_by_role('button',name='양품 창고 조회').tap();d.get_by_role('option').last.tap()
   expect(d.get_by_role('button',name='양품 로케이션 조회')).to_contain_text(long+'GOOD-01')
   d.get_by_role('button',name='양품 창고 조회').tap();d.get_by_role('option').first.tap()
   d.get_by_role('button',name='양품 로케이션 조회').tap();d.get_by_role('option').last.tap()
   d.get_by_role('button',name='적용').tap();b('아니오').tap();expect(d).to_be_visible()
   d.get_by_role('button',name='적용').tap();b('예').tap()
   expect(whCell).to_have_text(long+'WH-GOOD-A2');expect(locCell).to_have_text(long+'GOOD-03')
   assert row(101)['goodPlace']['warehouse']=='WH-GOOD-A'
  # Keep one running order in the list through the real parent; material stock is synthetic.
  b(day+'/101 선택삭제').tap();expect(b(day+'/101 로케이션')).to_have_count(0)
  revision=row(102)['revision']
  r=ctx.request.post(head+'/102/actions',data={'action':'ISSUE_MATERIAL','lotCode':'LOT-A-01','quantity':2,'warehouse':'WH-A','location':'BIN-01','expectedRevision':revision})
  assert r.ok,(r.status,r.text())
  page.goto(base);page.locator('[data-slot="1"]').tap()
  # First confirm a listed position that is different from the row's original GOOD-01.
  b(day+'/102 창고명').tap();d.get_by_role('button',name='양품 로케이션 조회').tap();d.get_by_role('option').last.tap()
  d.get_by_role('button',name='적용').tap();b('예').tap()
  expect(b(day+'/102 로케이션')).to_have_text(long+'GOOD-02')
  b(day+'/102 창고명').tap();d.get_by_role('button',name='양품 창고 조회').tap();d.get_by_role('option').first.tap()
  valid_position=os.getenv('POP_QA_LISTED_GOOD')=='1'
  if valid_position:
   d.get_by_role('button',name='양품 로케이션 조회').tap();d.get_by_role('option').last.tap()
  else:
   expect(d.get_by_role('button',name='양품 로케이션 조회')).to_have_text('')
  d.get_by_role('button',name='적용').tap();b('예').tap()
  expect(b(day+'/102 로케이션')).to_have_text(long+'GOOD-03' if valid_position else '')
  candidate={'warehouse':'WH-GOOD-A2','location':'GOOD-02','fromWarehouse':'WH-GOOD-A','fromLocation':'GOOD-02','revision':row(102)['revision']}
  other=browser.new_context();assert other.request.post(base+'/api/pop/session',data={'terminalId':'DEMO-A','method':'scan','identifier':'0000'}).ok
  assert other.request.post(head+'/102/good-locations?slot=1',data=candidate).status==422
  assert ctx.request.post(head+'/102/good-locations?slot=6',data=candidate).status==403
  assert ctx.request.post(head+'/102/good-locations?slot=1',data={**candidate,'revision':-1}).status==409
  assert ctx.request.post(head+'/102/good-locations?slot=1',data={**candidate,'location':'NEVER','fromLocation':'NEVER'}).status==422
  entry={'date':day,'sequence':102,'revision':row(102)['revision'],'good':2,'arrangement':None,'goodPlace':{'warehouse':'WH-GOOD-A2','location':'BAD','slot':1}}
  bad={'requestId':'bad-place','action':'COMPLETE','selected':[entry],'visible':[entry],'autoPrint':False}
  r=ctx.request.post(apiurl+'/production',data=bad);assert r.status==422 and r.json()['code']=='GOOD_LOCATION_INVALID',(r.status,r.text());assert row(102)['revision']==entry['revision']
  b(day+'/102 생산수량').tap()
  page.get_by_role('dialog').get_by_role('button',name='2',exact=True).tap()
  page.get_by_role('dialog').get_by_role('button',name='적용',exact=True).tap()
  b('작업 완료').tap();b('예').tap()
  expect(b(day+'/102 창고명')).to_have_count(0)
  verified=row(102)['goodPlace'];assert verified['warehouse']=='WH-GOOD-A2' and verified['location']==('GOOD-03' if valid_position else 'GOOD-02') and verified['locationName']==(long+'GOOD-03' if valid_position else '') and verified['workStatus']=='N' and verified['etc']=='SYNTH-A2',verified
  assert ctx.request.get(head+'/102/good-locations?slot=1').status==409
  report['batch']={'valid':True,'invalidRollsBack':True,'sourcePrefixAndPlainStatus':True,'finishedReadOnly':True,'unmatchedOpeningCodeEmptyName':True,'confirmedLocationCarrySaved':not valid_position,'normalLocationSaved':valid_position,'otherSessionRejected':True,'unseenCodeRejected':True,'staleRevisionRejected':True}
  (review/('good-place-listed.json' if valid_position else 'good-place.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),'utf-8')
  print(report['batch'],len(report),'entries');browser.close()
finally:srv.shutdown();proc.terminate();proc.wait(15);log.close();scratch.cleanup()
