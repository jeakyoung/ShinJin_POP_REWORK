import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [origin, mode, output] = process.argv.slice(2)
if (new URL(origin).hostname !== '127.0.0.1') throw Error('Loopback only')
await mkdir(output,{recursive:true})
const profile = await mkdtemp(join(tmpdir(),'pop-login-'))
const chrome = spawn(process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new','--disable-gpu','--disable-background-networking','--no-first-run','--no-sandbox','--no-proxy-server',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'
], {windowsHide:true,stdio:'ignore'})
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms))
async function until(fn,label) {
  for (let n=0;n<120;n++) { const value=await fn(); if(value) return value; await sleep(100) }
  throw Error('Timeout '+label)
}
let socket
try {
  const port=await until(async()=>{try{return (await readFile(join(profile,'DevToolsActivePort'),'utf8')).split(/\s/)[0]}catch{return null}},'Chrome')
  const pages=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json()
  socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl)
  await new Promise(r=>socket.addEventListener('open',r,{once:true}))
  let id=0
  const call=(method,params={})=>new Promise((resolve,reject)=>{
    const seq=++id
    const timer=setTimeout(()=>{socket.removeEventListener('message',listener);reject(Error(method+' timeout'))},10000)
    function listener(e){const v=JSON.parse(e.data);if(v.id!==seq)return;clearTimeout(timer);socket.removeEventListener('message',listener);v.error?reject(Error(method)):resolve(v.result)}
    socket.addEventListener('message',listener);socket.send(JSON.stringify({id:seq,method,params}))
  })
  async function run(expression) {
    const v=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})
    if(v.exceptionDetails)throw Error(v.exceptionDetails.exception?.description ?? 'browser expression')
    return v.result.value
  }
  const wait=(selector)=>until(()=>run('!!document.querySelector('+JSON.stringify(selector)+')'),selector)
  async function tap(selector){
    await wait(selector)
    const pos=await run('(()=>{let e=document.querySelector('+JSON.stringify(selector)+');e.scrollIntoView({block:"nearest"});let r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()')
    await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[pos]})
    await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  }
  async function capture(selector,name,width,height){
    await wait(selector)
    await sleep(450)
    const actual=await run('(()=>{let r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect(); return {x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height}})()')
    const clip={x:Math.max(0,actual.x+(actual.width-width)/2),y:Math.max(0,actual.y+(actual.height-height)/2),width,height,scale:1}
    if (selector==='html') { clip.x=0; clip.y=0 }
    const frame=await call('Page.captureScreenshot',{format:'png',clip,captureBeyondViewport:true})
    await writeFile(join(output,name+'.png'),Buffer.from(frame.data,'base64'))
    await writeFile(join(output,name+'.json'),JSON.stringify({actual,clip},null,2))
  }
  const enter=async()=>{for(const type of ['keyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13})}
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false})
  await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1})
  await call('Page.navigate',{url:origin})
  await wait('.login-panel')
  const group = mode==='group005' || mode==='group105'
  const scan=mode==='before'?'.login-dialog[open]':'.scan-login[open]'
  await wait(scan)
  if(mode!=='before') assert.equal(await run("performance.getEntriesByType('resource').some(r=>new URL(r.name).pathname==='/api/pop/context')"),false)
  await capture(scan,'scan',729,278)
  if(mode!=='before') {
    assert.ok(await run("(()=>{const e=document.querySelector('.scan-login'),r=e.getBoundingClientRect();return r.left>=0 && r.top>=0 && r.right<=innerWidth+1 && r.bottom<=innerHeight+1 && [...e.querySelectorAll('button,input')].filter(n=>n.checkVisibility()).every(n=>{const b=n.getBoundingClientRect();return n.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2))})})()"))
  }
  await capture('html','scan-host',1280,1000)
  await tap(scan+' button:last-of-type')
  if(mode!=='before') await until(()=>run("document.activeElement.id==='login-employee'"),'employee after scan close')
  await capture('.login-panel','login',1005,857)
  await tap('.login-settings')
  const settings=mode==='before'?'.login-dialog[open]':'.prelogin-settings[open]'
  await capture(settings,'settings',1000,500)
  if(mode==='before') {
    assert.ok(await run("!!document.querySelector('dialog[open] select')"))
    await tap(settings+' button:last-child')
  } else {
    assert.equal(await run("document.querySelectorAll('.prelogin-settings [data-setting]').length"),10)
    assert.equal(await run("document.querySelectorAll('.login-panel select').length"),0)
    assert.equal(await run("document.querySelector('[data-setting=group]').disabled"),!group)
    if(group) {
      assert.ok(await run("document.querySelector('[data-setting=group]').classList.contains('unset')"))
      await tap('[data-setting="group"]');await wait('.eq-group[open] button[aria-label="그룹 추가"]:enabled');await tap('.eq-group footer button:last-child')
    }
    await tap('[data-setting="printer"]')
    await wait('.printer-dialog[open]')
    assert.equal(await run("document.querySelectorAll('.printer-dialog[open] .printer-roles button').length"),3)
    await tap('.printer-dialog footer button:last-child')
    await tap('[data-setting="info"]')
    await capture('.prelogin-info[open]','info',800,900)
    if(mode==='single') await until(()=>run("document.querySelector('.pre-version input')?.value==='1.2.3'"),'FTP profile version')
    await tap('.prelogin-info footer button:last-child')
    await tap('[data-setting="info"]')
    await tap('.prelogin-info header button')
    await wait('.prelogin-settings[open]')
    if(mode==='missing'){
      await tap('[data-setting="process"]')
      await wait('.transfer-message[open]')
      assert.ok(await run("document.querySelector('.transfer-message-text').textContent.includes('공장 설정')"))
      await tap('.answer-ok')
    }
    await tap('[data-setting="close"]')
    await until(()=>run("document.activeElement.matches('.login-settings')"),'gear after settings close')
  }
  await tap('.login-scan')
  const input=scan+' input'
  await wait(input)
  await run('document.querySelector('+JSON.stringify(input)+').focus()')
  if (mode==='default') {
    await call('Input.insertText',{text:'INVALID-SYNTHETIC'})
    await enter();await wait('.transfer-message[open]')
    assert.ok(await run("document.querySelector('.transfer-message-text').textContent.includes('로그인 정보를 확인')"))
    await tap('.answer-ok')
    assert.equal(await run("document.querySelector('#scan-employee').value"),'')
    await until(()=>run("document.activeElement.id==='scan-employee'"),'scan focus restored')
  }
  // Use Chrome's clipboard and paste command, as on a keyboard-wedge terminal.
  await call('Browser.grantPermissions',{origin,permissions:['clipboardReadWrite','clipboardSanitizedWrite']})
  await run("navigator.clipboard.writeText('0000')")
  assert.equal(await run("navigator.clipboard.readText().then(v=>v==='0000')"),true)
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'v',code:'KeyV',modifiers:2,windowsVirtualKeyCode:86,commands:['Paste']})
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'v',code:'KeyV',modifiers:2,windowsVirtualKeyCode:86})
  await until(()=>run('document.querySelector('+JSON.stringify(input)+').value==="0000"'),'paste')
  await enter()
  if(mode==='missing' || group){
    await wait('.transfer-message[open]')
    assert.ok(await run("document.querySelector('.transfer-message-text').textContent.includes('환경설정을 확인하십시오.')"))
    assert.equal(await run("fetch('/api/pop/session').then(r=>r.status)"),401)
    await tap('.answer-ok');await tap(scan+' button:last-of-type')
    await tap('.login-submit')
    await wait('.transfer-message[open]')
    assert.ok(await run("document.querySelector('.transfer-message-text').textContent.includes('환경설정을 확인하십시오.')"))
    await tap('.answer-ok')
    console.log('PASS missing prerequisites, status, scan paste and blocked manual/scan login')
  }else{
    await wait('.authenticated-bar')
    await call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false})
    if(mode==='single') {
      assert.equal(await run("document.querySelectorAll('section.workplace-menu').length"),0)
      await tap('button[aria-label="메뉴 복귀"]')
    }
    await capture('html','main',1280,800)
    await tap('button[aria-label="로그아웃"]')
    await tap('.logout-confirm[open] button[type=button]')
    await wait('.login-panel')
    if(mode!=='before'){
      await sleep(1500)
      assert.equal(await run("document.activeElement.id"),'login-employee')
      assert.equal(await run("document.querySelectorAll('dialog[open]').length"),0)
      if(mode==='default'){
        await tap('.login-submit')
        await wait('.transfer-message[open]')
        assert.ok(await run("document.querySelector('.transfer-message-text').textContent.includes('사원번호를 입력')"))
        await tap('.answer-ok')
        await until(()=>run("!document.querySelector('.transfer-message') && document.activeElement.id==='login-employee'"),'employee input restored')
        await call('Input.insertText',{text:'DEMO-W01'})
        await enter()
        assert.equal(await run("document.activeElement.type"),'password')
        await call('Input.insertText',{text:'demo-only'});await enter()
        assert.ok(await run("document.activeElement.matches('.login-submit')"))
        await tap('.login-submit');await wait('.authenticated-bar')
      }
    }
    console.log('PASS settings, scanner paste, login, main and logout')
  }
} finally {socket?.close();chrome.kill()}
