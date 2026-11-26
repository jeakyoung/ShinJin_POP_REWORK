
const endpoint = process.argv[2]
const targetUrl = process.argv[3]
const artifacts = process.argv[4]
const timeout = (ms) => new Promise(resolve => setTimeout(resolve, ms))
let pages
for (let retry = 0; retry < 60; retry++) {
  try { pages = await (await fetch(endpoint + '/json/list')).json(); break } catch { await timeout(250) }
}
if (!pages) throw new Error('Chrome debugging endpoint unavailable')
const socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, {once: true})
  socket.addEventListener('error', reject, {once: true})
})
let id = 0
async function rpc(method, params = {}) {
  const current = ++id
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.removeEventListener('message', listener); reject(new Error(method + ' timed out')) }, 10000)
    function listener(message) {
      const result = JSON.parse(message.data)
      if (result.id !== current) return
      clearTimeout(timer)
      socket.removeEventListener('message', listener)
      if (result.error) reject(new Error(JSON.stringify(result.error)))
      else resolve(result.result)
    }
    socket.addEventListener('message', listener)
    socket.send(JSON.stringify({ id: current, method, params }))
  })
}
async function evaluate(fn, ...args) {
  const expression = '(' + fn.toString() + ')(...' + JSON.stringify(args) + ')'
  const result = await rpc('Runtime.evaluate', {expression, returnByValue: true})
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception.description)
  return result.result.value
}
async function waitFor(fn, ...args) {
  for (let retry = 0; retry < 60; retry++) {
    const result = await evaluate(fn, ...args)
    if (result) return
    await timeout(200)
  }
  throw new Error('Timed out waiting for ' + args.join(' ') + ': ' + await evaluate(() => document.body.innerText))
}
const click = (label) => waitFor(text => {
  const element = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text)
  if (!element || element.disabled) return false
  element.click()
  return true
}, label)
const contains = (text) => waitFor(value => document.body.innerText.includes(value), text)
try {
 await rpc('Emulation.setDeviceMetricsOverride',{width:1260,height:1000,deviceScaleFactor:1,mobile:false})
 await rpc('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1})
 await rpc('Page.navigate',{url:targetUrl})
 await waitFor(()=>!!document.querySelector('.login-panel'))
 async function request(path,method='GET',body){
  const result=await rpc('Runtime.evaluate',{expression:'fetch('+JSON.stringify('/api/pop/'+path)+','+
    JSON.stringify({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})+').then(async r=>[r.status,await r.text()])',awaitPromise:true,returnByValue:true})
  return [result.result.value[0],JSON.parse(result.result.value[1]||'null')]
 }
 const login=async(t,w)=>{if((await request('session','POST',{terminalId:t,method:'manual',identifier:w,passcode:'demo-only'}))[0]!==200)throw Error('login')}
 async function finger(sel){await waitFor(s=>!!document.querySelector(s),sel)
  const pt=await evaluate(s=>{const e=document.querySelector(s);e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}},sel)
  await rpc('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[pt]})
  await rpc('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}
 async function tap(sel) {
   await finger(sel)
   // Touch each real settings message. Foreign-assignment warnings precede a separate yes/no dialog.
   for (let i=0;i<4;i++) {
     await timeout(145)
     const kind=await evaluate(()=>{
       const box=document.querySelector('.settings-message-scope dialog[open]')
       if (!box) return ''
       if (box.querySelector('.answer-ok')) {window.lastPrompt=box.querySelector('.transfer-message-text').innerText;return 'ok'}
       return window.qaApprove===false?'no':'yes'
     })
     if (!kind) break
     await capture('.settings-message-scope dialog[open]',kind==='ok'?'confirm-ok':'confirm-yn')
     await finger('.settings-message-scope dialog[open] .answer-'+kind)
   }
 }
 const fs=await import('node:fs')
 const geometry={}
 async function capture(sel,name,w,h){
  const clip=await evaluate(s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.left+window.scrollX,y:r.top+window.scrollY,width:r.width,height:r.height,scale:1}},sel)
  if (w && h) Object.assign(clip,{width:w,height:h})
  const res=await rpc('Page.captureScreenshot',{format:'png',clip,captureBeyondViewport:true})
  geometry[name]=await evaluate(s=>{
    const root=document.querySelector(s), r=root.getBoundingClientRect()
    const bounds=e=>{const b=e.getBoundingClientRect();return [b.x-r.x,b.y-r.y,b.width,b.height].map(Math.round)}
    const entries=q=>[...root.querySelectorAll(q)].filter(e=>e.getBoundingClientRect().width).map(bounds)
    return {size:bounds(root).slice(2),headers:entries(':scope > header,:scope > h2'),grids:entries('.eq-grid,fieldset,.wh-grid,.wh-order-grid'),
      headerCells:entries('thead th'),rows:entries('tbody tr'),buttons:entries('footer button,.answer-yes,.answer-no,.answer-ok'),
      checkboxes:entries('input[type=checkbox]'),tiles:entries(':scope > button,:scope > span')}
  },sel)
  fs.writeFileSync(artifacts+'/geometry.json',JSON.stringify(geometry,null,2))
  fs.writeFileSync(artifacts+'/'+name+'.png',Buffer.from(res.data,'base64'))
 }
 const assert=(ok,msg)=>{if(!ok)throw Error(msg)}
 async function json(path,body,method=body?'POST':'GET',want=200){
  const r=await rpc('Runtime.evaluate',{expression:'fetch('+JSON.stringify(path)+','+JSON.stringify({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})+').then(async r=>[r.status,await r.text()])',awaitPromise:true,returnByValue:true})
  const [status,raw]=r.result.value
  assert(status===want,path+' '+status+' '+raw)
  return JSON.parse(raw||'null')
 }
 const base='/api/pop/admin/terminal-settings/'
 const eq=t=>base+t+'/equipment'
 const A='DEMO-A',Z='DEMO-A2',B='DEMO-B'
 const get=()=>json(eq(A))
 const btn=label=>'button[aria-label="'+label+'"]'
 async function boot(t,w) {
   await login(t,w);await rpc('Page.reload')
   await waitFor(()=>!!document.querySelector('.authenticated-bar'))
   await tap('button[aria-label="메뉴 복귀"]')
   await click('생산')
   const present=await evaluate(()=>!!document.querySelector('[data-slot="robot"]:not(:disabled)'))
   assert(present===(t!==B),'group menu '+t)
 }
 async function settings() {await click('관리');await tap('[data-view="admin"]');await contains('세션 설정 새로고침')}
 const panel='.settings-tiles > button:nth-child(4)',group='.settings-tiles > button:nth-child(9)'
 const save='.eq-dialog footer button:first-child',cancel='.eq-dialog footer button:last-child'
 async function open(sel){
  await tap(sel);await waitFor(()=>!!document.querySelector('.eq-dialog[open] footer button:first-child:not(:disabled)'))
 }
 async function close(){await tap(cancel);await waitFor(()=>!document.querySelector('.eq-dialog'))}
 async function yes(allow){await evaluate(value=>{window.qaApprove=value;window.confirm=()=>value;window.alert=m=>window.lastPrompt=m},allow)}
 if (['warehouse','missing','official'].includes(process.argv[5])) {
   const { verifyWarehouse } = await import('./verify-warehouse-touch.mjs')
   await verifyWarehouse({ login, rpc, waitFor, tap, finger, click, settings, evaluate, capture, assert, yes }, process.argv[5])
 } else if (process.argv[5] === 'site') {
   const { verifySite } = await import('./verify-site-touch.mjs')
   await verifySite({ login, rpc, waitFor, tap, click, settings, evaluate, json, capture, contains, assert, yes })
 } else {
 await boot(A,'DEMO-W01');await settings();await open(panel)
 await tap('input[aria-label="합성 설비 1"]');await close()
 assert((await get()).version===0,'machine cancel wrote')
 await open(panel);await tap('input[aria-label="NONE"]');await tap('input[aria-label="합성 설비 2"]')
 assert(!await evaluate(()=>document.querySelector('input[aria-label="NONE"]').checked),'NONE exclusion')
 await capture('.eq-dialog','machine')
 await yes(false);await tap(save);assert((await get()).version===0,'machine declined wrote')
 await yes(true);await tap(save);await waitFor(()=>!document.querySelector('.eq-dialog'))
 assert((await get()).saved.machines.join()==='M02'&&!(await get()).applied.machines.length,'saved/applied')
 await open(panel)
 await json(eq(A)+'/machines',{expectedVersion:1,machines:['M03']},'PUT')
 await tap(save);await contains('다른 세션에서 변경했습니다.')
 assert(await evaluate(()=>document.querySelector('input[aria-label="합성 설비 3"]').checked),'stale UI selection')
 await close();await open(group);await tap(btn('그룹 추가'))
 await waitFor(()=>!!document.querySelector('input[aria-label="001 시작"]'))
 await tap(btn('001 공정설정'));await tap(btn('공정 추가'));await tap(save)
 assert(await evaluate(()=>window.lastPrompt.includes('창고')),'warehouse required')
 await tap(btn('P01 창고명'));await capture('#wh-P01','warehouse-popup');await tap('#wh-P01 tbody tr:nth-child(2) button')
 await tap('.eq-process-body > .eq-grid:first-child tbody tr:nth-child(2) button')
 await tap(btn('공정 추가'));await tap(btn('P02 창고명'));await tap('#wh-P02 tbody tr:first-child button')
 await tap(btn('위로'));await capture('.eq-dialog','process')
 await tap(save);await waitFor(()=>!!document.querySelector('.eq-group'))
 assert((await get()).groups[0].steps.map(s=>s.process).join()==='P02,P01','process ordering')
 await tap(btn('001 공정설정'));await tap(btn('공정 삭제'));await tap(cancel)
 assert((await get()).groups[0].steps.length===2,'process cancel')
 await tap('input[aria-label="001 시작"]');await tap('input[aria-label="001 종료"]')
 assert(!await evaluate(()=>document.querySelector('input[aria-label="001 시작"]').checked),'exclusive sides')
 await close();assert((await get()).saved.group===null,'group close assigned')
 await open(group);await tap('input[aria-label="001 시작"]');await tap(save);await waitFor(()=>window.lastPrompt==='저장 되었습니다.')
 await capture('.eq-dialog','group')
 await yes(false);await tap(btn('그룹 삭제'));assert((await get()).groups.length===1,'declined delete')
 await close()
 await boot(A,'DEMO-W01')
 await capture('.workplace-menu','menu-005');await tap('[data-slot="robot"]');await contains('합성 검사 · 합성 창고 A');await contains('합성 절단 · 합성 창고 B')
 assert((await get()).applied.machines.join()==='M03','machine relogin')
 await boot(Z,'DEMO-W04');await settings();await open(group);await yes(true)
 await tap('input[aria-label="001 종료"]');await tap(save);await waitFor(()=>window.lastPrompt==='저장 되었습니다.')
 await close();await boot(Z,'DEMO-W04');await tap('[data-slot="robot"]');await contains('합성 검사 · 합성 창고 A')
 await capture('.floor-work','route-105');await tap('button[aria-label="메뉴 복귀"]');await capture('.workplace-menu','menu-105')
 await boot(B,'DEMO-W03');await capture('.workplace-menu','menu-ordinary');await settings();await waitFor(s=>document.querySelector(s)?.disabled,group)
 await boot(A,'DEMO-W02');await settings();await tap(panel)
 await waitFor(()=>document.querySelector('.eq-dialog input')?.disabled)
 assert(await evaluate(()=>document.querySelector('.eq-dialog footer button').disabled),'readonly save')
 await close()
 await boot(A,'DEMO-W01');await settings();await open(group);await yes(true)
 await json('/api/pop/session/logout',{},'POST',204)
 await tap(btn('그룹 추가'));await waitFor(()=>!!document.querySelector('.login-panel'))
 await login(A,'DEMO-W01');assert((await get()).groups.length===1,'expired write')
 console.log('PASS Chrome touch: tile entry, NONE, cancel/decline, stale reload, process+warehouse popup, reorder/cancel, exclusive roles, immediate child save, 005 and 105 relogin -> group routes, ordinary menu, worker read-only, 401')
 }
} finally {socket.close()}
