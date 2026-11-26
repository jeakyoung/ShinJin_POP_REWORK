import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import assert from 'node:assert/strict'
const [profile,out,url,mode]=process.argv.slice(2),dir=join(out,mode)
assert.equal(new URL(url).hostname,'127.0.0.1');assert.equal(new URL(url).protocol,'http:')
await mkdir(dir,{recursive:true})
const pause=ms=>new Promise(r=>setTimeout(r,ms))
let tab
for(let i=0;i<150&&!tab;i++){
 try{const port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]
 tab=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page'&&t.url.startsWith(url))}catch{}
 if(!tab)await pause(100)
}
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}))
let id=0;const pending=new Map(),events=[]
ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}
 if(m.method==='Runtime.exceptionThrown')events.push(m.params.exceptionDetails.text)}
async function c(method,params={}){const n=++id;const p=new Promise((r,reject)=>{const timer=setTimeout(()=>reject(Error('CDP timeout '+method)),12000);pending.set(n,m=>{clearTimeout(timer);r(m)})});ws.send(JSON.stringify({id:n,method,params}));const m=await p;if(m.error)throw Error(JSON.stringify(m.error));return m.result}
async function ev(expression){const v=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(v.exceptionDetails)throw Error(v.exceptionDetails.exception?.description||v.exceptionDetails.text);return v.result.value}
async function wait(exp,label){for(let i=0;i<350;i++){const v=await ev("Boolean("+exp+")");if(v)return v;await pause(75)}throw Error('timeout '+label+' '+await ev('document.body.innerText.slice(-900)'))}
const s=q=>'document.querySelector('+JSON.stringify(q)+')'
const btn=(label,container='document')=>'[...(('+container+')?.querySelectorAll("button")??[])].find(b=>b.textContent.trim()==='+JSON.stringify(label)+')'
async function click(exp){await wait('Boolean(('+exp+') && !('+exp+').disabled)',exp);await ev('('+exp+').scrollIntoView({block:"nearest"})')
 const pt=await ev('(()=>{const e=('+exp+'),r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return {x,y,ok:e.contains(document.elementFromPoint(x,y))}})()')
 assert(pt.ok,'control obscured '+exp);await c('Input.dispatchMouseEvent',{type:'mousePressed',x:pt.x,y:pt.y,button:'left',clickCount:1});await c('Input.dispatchMouseEvent',{type:'mouseReleased',x:pt.x,y:pt.y,button:'left',clickCount:1});await pause(90)
}
async function shot(name,sel){await pause(100);const clip=sel?await ev('(()=>{const r='+s(sel)+'.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1}})()'):null
 const p=await c('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,...(clip?{clip}:{})});await writeFile(join(dir,name+'.png'),Buffer.from(p.data,'base64'))}
const logs=[];function ok(text){logs.push(text);console.log(text)}
async function post(path,body,method='POST'){return ev('(async()=>{const r=await fetch('+JSON.stringify(path)+',{method:'+JSON.stringify(method)+',headers:{"Content-Type":"application/json"},body:'+JSON.stringify(JSON.stringify(body))+'});return [r.status,await r.json()]})()')}
async function get(path){return ev('(async()=>await(await fetch('+JSON.stringify(path)+')).json())()')}
async function type(q,text){await ev(s(q)+'.focus()');await c('Input.insertText',{text})}
async function enter(){for(const type of ['keyDown','keyUp'])await c('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13})}
const open='dialog.wp-dialog[open]',active='[...document.querySelectorAll("dialog.wp-dialog[open]")].at(-1)',close=()=>click(btn('닫기',active))
async function run(){
 await c('Runtime.enable');await c('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false})
 await wait('document.querySelector("#root main") && location.origin==='+JSON.stringify(url),'load')
 const login='/api/pop/session',settings='/api/pop/admin/terminal-settings/DEMO-A'
 assert.equal((await post(login,{terminalId:'DEMO-A',method:'scan',identifier:'0000'}))[0],200)
 const admin=(await get(settings)).view, [doc,,ship,label]=admin.catalog.printers
 assert.equal((await post(settings+'/printers',{expectedVersion:admin.saved.version,outputs:{document:doc,shipment:ship,label}},'PUT'))[0],200)
 assert.equal((await post(login,{terminalId:'DEMO-A',method:'manual',identifier:'DEMO-W01',passcode:'demo-only'}))[0],200)
 await c('Page.reload');await wait(s('.authenticated-bar'),'login')
 if(!await ev(s('.workplace-menu')+'!==null'))await click(s('[aria-label="메뉴 복귀"]'))
 await click(btn('인쇄'));await click(s(mode==='before'?'[data-view=output]':'[data-view=workPrint]'))
 if(mode==='before'){await wait(s('.synthetic-output'),'old output');await shot('C-output');ok('current C snapshot generic output route');return}
 const stage='.wp-stage'
 await wait(s('.wp-band[data-row]'),'auto search')
 assert.equal(await ev('document.querySelectorAll("[data-row]").length'),12)
 await shot('frmWorkPrint',stage)
 await click(s('.productBtn'));await shot('frmProductOption',open)
 await click(s(open+' [aria-label="상품"]'));await click(btn('취소',active))
 await click(s('.productBtn'));assert(await ev(s(open+' [aria-label="상품"]')+'.checked'))
 await click(btn('선택',active));await click(btn('저장',active));await click(s('.searchBtn'))
 assert.equal(await ev('document.querySelectorAll("[data-row]").length'),1)
 await click(s('.productBtn'));await click(btn('선택',active));await click(btn('저장',active));await click(s('.searchBtn'))
 await click(s('.materialBtn'));await shot('frmMaterialOption',open);await click(s(open+' [aria-label="SKD61"]'));await click(btn('저장',active))
 await click(s('.searchBtn'));await wait('document.querySelectorAll("[data-row]").length===10','two material filter')
 await click(s('.materialBtn'));assert.equal(await ev(s(open+' [aria-label="SKD61"]')+'.checked'),false)
 await click(btn('사용',active));await click(btn('저장',active));await click(s('.searchBtn'));await wait('document.querySelectorAll("[data-row]").length===12','all material restored')
 await click(s('.completeEdit'));await shot('complete-lookup',stage);await click(s('.wp-choice-list button[aria-pressed=true]'))
 await click(s('.sDateEdit'));await shot('date-touch',stage);await click(s('.wp-calendar button[aria-pressed=true]'))
 await click(s('.wp-operator'));await type('.wp-operator','일치하지않음');await enter();await wait('!document.querySelector("[data-row]")','empty operator')
 await ev(s('.wp-operator')+'.select()');await c('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',windowsVirtualKeyCode:8});await c('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',windowsVirtualKeyCode:8});await enter()
 await wait('document.querySelectorAll("[data-row]").length===12','reset operator')
 await click(btn('시험금속',s('.wp-customers')));await click(btn('선택',s('.wp-band-header')))
 assert(await ev('[...document.querySelectorAll("[data-row] input")].every(x=>x.checked)'))
 await click(btn('전체',s('.wp-customers')));await click(btn('선택',s('.wp-band-header')));await click(btn('선택',s('.wp-band-header')))
 await click(s('.printBtn'));await shot('ComWorkPrintSelect',open);await click(s('[data-report=Single]'))
 await wait('document.body.innerText.includes("출력하실 데이터를 선택하십시오.")','no selection');await click(btn('확인',active));await close()
 await click(s('[data-row="WPTEST000001-0-1"] input'))
 ok('full App menu, 12 rows, operator Enter, option save/cancel, blank category, visible customer selection, no-selection error')
 for(const form of ['Single','Multiple','Multiple1','Multiple2','Multiple3']){
  await click(s('.printBtn'));await click(s('[data-report='+form+']'))
  await wait(s('.wp-page img')+'?.naturalWidth>500','render '+form);await shot(form+'-preview',open)
  const data=await ev('(async()=>{const b=await(await fetch(document.querySelector(".wp-page img").src)).blob();return await new Promise(resolve=>{const f=new FileReader();f.onload=()=>resolve(f.result.split(",")[1]);f.readAsDataURL(b)})})()')
  await writeFile(join(dir,form+'.png'),Buffer.from(data,'base64'));await close()
 }
 assert.equal(await ev('document.querySelectorAll("[data-row]").length'),12)
 await click(s('.printBtn'));await click(s('[data-report=Single]'));await click(btn('합성 제출',active))
 await wait('document.body.innerText.includes("출력되었습니다.")','receipt');await click(btn('확인',active))
 await wait('document.querySelectorAll("[data-row]").length===11','print count exclusion')
 await click(s('.pnDelete'));await shot('ComOrderNoScan',open);await type(open+' input','123');await enter()
 await wait('document.body.innerText.includes("수주번호가 없습니다.")','invalid scan');await click(btn('확인',active))
 assert.equal(await ev(s(open+' input')+'.value'),'')
 await type(open+' input','WPTEST0000019999');await enter()
 await wait('document.body.innerText.includes("WPTEST000001를 삭제")','first confirm');await click(btn('예',active))
 await wait('document.body.innerText.includes("생산실적이 있는")','performance');await shot('delete-performance',open);await click(btn('아니오',active))
 await click(s('.searchBtn'));assert.equal(await ev('document.querySelectorAll("[data-row]").length'),11)
 ok('all five real rendered reports; close unchanged; explicit synthetic submit increments one row; 16-char scan, second confirmation cancelled')
 await click(s('.productBtn'));await click(btn('선택',active));await click(btn('저장',active));await click(s('.searchBtn'))
 await wait('document.querySelectorAll("[data-row]").length===1','saved in this screen')
 await click(s('[aria-label="메뉴 복귀"]'));await click(btn('인쇄'));await click(s('[data-view="workPrint"]'))
 await wait('document.querySelectorAll("[data-row]").length===11','re-entry resets screen options')
 ok('material multiselect save and reopen; customer account filters reset at screen re-entry; no preference persistence')
 assert.deepEqual(events,[])
}
try{await run();await writeFile(join(dir,'chrome.txt'),logs.join('\n')+'\n')}catch(e){console.error(e);if(ws.readyState===1)await shot('failure');throw e}finally{ws.close()}
