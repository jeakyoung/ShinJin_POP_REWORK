import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep, delimiter } from 'node:path'
import assert from 'node:assert/strict'

// Arguments: Spring Boot jar and standalone Vite build directory.
const jar = resolve(process.argv[2])
const build = dirname(jar)
const chromePath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const profile = await mkdtemp(join(tmpdir(), 'retry-chrome-'))
const dist = resolve(process.argv[3])
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, label, timeout = 30_000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try {
      const value = await fn()
      if (value) return value
    } catch (error) { last = error }
    await sleep(150)
  }
  throw new Error('Timed out: ' + label, { cause: last })
}
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const portProbe = createServer()
const apiPort = await listen(portProbe)
await new Promise(resolve => portProbe.close(resolve))
const launch = process.env.DEMO_TEST_LIB ? ['-cp', jar + delimiter + join(process.env.DEMO_TEST_LIB, '*'), 'com.shinjin.pop.PopApplication'] : ['-jar', jar]
const backend = spawn('java', [...launch, '--spring.profiles.active=demo',
  '--spring.config.location=optional:classpath:/', '--server.address=127.0.0.1', '--server.port=' + apiPort],
  { windowsHide: true, cwd: build })
let backendOutput = ''
backend.stdout.on('data', chunk => { backendOutput += chunk })
backend.stderr.on('data', chunk => { backendOutput += chunk })
const api = 'http://127.0.0.1:' + apiPort
const web = createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const body = chunks.length ? Buffer.concat(chunks) : undefined
      const upstream = await fetch(api + req.url, {
        method: req.method,
        headers: { ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}),
          ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {}) },
        body,
      })
      const data = Buffer.from(await upstream.arrayBuffer())
      const cookies = upstream.headers.getSetCookie()
      if (cookies.length) res.setHeader('Set-Cookie', cookies)
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' })
      res.end(data)
      return
    }
    const name = resolve(dist, '.' + new URL(req.url, 'http://localhost').pathname)
    const file = name === dist ? join(dist, 'index.html') : name
    if (!file.startsWith(dist + sep)) { res.writeHead(404).end(); return }
    const contentType = file.endsWith('.png') ? 'image/png' : file.endsWith('.js') ? 'text/javascript'
      : file.endsWith('.css') ? 'text/css' : 'text/html'
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(await readFile(file))
  } catch { if (!res.headersSent) res.writeHead(502); res.end() }
})
let chrome
let ws
try {
  await until(async () => (await fetch(api + '/api/pop/context')).ok, 'Spring demo ready')
  const webPort = await listen(web)
  const url = 'http://127.0.0.1:' + webPort
  chrome = spawn(chromePath, ['--headless=new', '--no-sandbox', '--disable-gpu', '--incognito', '--disable-component-update', '--disable-background-networking', '--disable-extensions',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
    '--user-data-dir=' + profile, url + '/api/pop/context'], { windowsHide: true, stdio: 'ignore' })
  const activePort = await until(async () => (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0],
    'Chrome DevTools')
  const devtools = 'http://127.0.0.1:' + activePort
  const target = await until(async () => (await (await fetch(devtools + '/json/list')).json())
    .find(tab => tab.type === 'page' && tab.url.startsWith(url)), 'Chrome page')
  const version = await (await fetch(devtools + '/json/version')).json()
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  let sequence = 0
  const outstanding = new Map()
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (!message.id || !outstanding.has(message.id)) return
    const { resolve, reject, timer } = outstanding.get(message.id)
    outstanding.delete(message.id)
    clearTimeout(timer)
    if (message.error) reject(new Error(message.error.message))
    else resolve(message.result)
  })
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { outstanding.delete(id); reject(new Error('CDP timeout: ' + method)) }, 10_000)
    outstanding.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ id, method, params }))
  })
  const run = async expression => {
    const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? expression)
    return result.result.value
  }
  const includes = text => run('document.body.innerText.includes(' + JSON.stringify(text) + ')')
  const shown = text => until(() => includes(text), text)
  const click = (text, root = 'document') => until(() => run(`(() => {
    const button = [...${root}.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(text)})
    if (!button || button.matches(':disabled')) return false
    button.click(); return true
  })()`), 'click ' + text)
  const state = endpoint => run(`fetch(${JSON.stringify(endpoint)}).then(r=>r.json())`)
  const logout = () => run("fetch('/api/pop/session/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.status)")
  const choose = (selector, index, value) => until(() => run(`(() => {
    const field = document.querySelectorAll(${JSON.stringify(selector)})[${index}]
    const wanted = ${JSON.stringify(value)}
    if (!field || ![...field.options].some(option => option.value === wanted)) return false
    field.value = wanted
    field.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`), 'candidate ' + value)
  await cdp('Page.enable')
  await until(() => run('location.origin === ' + JSON.stringify(url) + ' && document.readyState === "complete"'), 'loopback origin')
  const status=(path,post=false)=>run(`fetch(${JSON.stringify(path)},${post ? "{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}" : '{}'}).then(r=>r.status)`)
  async function login(terminal,worker){
    await logout()
    await cdp('Page.navigate',{url})
    await until(()=>run("!!document.querySelector('.login-settings')"),'login')
    assert.equal(await includes(worker),false)
    assert.equal(await includes('demo-only'),false)
    await run("document.querySelector('.login-panel').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})); document.querySelector('dialog[open]')?.close();document.querySelector('.login-settings').click()")
    await choose('dialog[open] select',0,terminal)
    await click('닫기','document.querySelector("dialog[open]")')
    await click('스캔으로 로그인하기')
    await run(`(()=>{const input=document.querySelector('dialog[open] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify('SCAN:'+worker)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await click('로그인','document.querySelector("dialog[open]")')
  }
  const path='/api/demo/machine-calls'
  const pic=async(name)=>{
    if(!process.env.MACHINE_CAPTURE_DIR)return
    const shot=await cdp('Page.captureScreenshot',{format:'png'})
    await writeFile(join(process.env.MACHINE_CAPTURE_DIR,'web-machine-'+name+'.png'),Buffer.from(shot.data,'base64'))
  }
  const dlg=label=>'document.querySelector('+JSON.stringify('dialog[aria-label="'+label+'"]')+')'
  const press=label=>until(()=>run(`(()=>{const b=document.querySelector('button[aria-label="'+${JSON.stringify(label)}+'"]');if(!b)return false;b.click();return true})()`),label)
  const mark=name=>run(`document.querySelector('input[aria-label="'+${JSON.stringify(name)}+'"]').click()`)
  const enterNumber=async(value)=>{
    await run(`(()=>{const f=document.querySelector('.mc-scan input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(f,${JSON.stringify(value)});f.dispatchEvent(new Event('input',{bubbles:true}));})()`)
    await until(() => run("document.activeElement === document.querySelector('.mc-scan input')"),"scanner receives focus")
    await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'})
    await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  }
  await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false})
  assert.equal(await status(path),401)
  await login('DEMO-A','DEMO-W01');await until(() => run("!!document.querySelector('.workplace-menu')"), 'workplace menu')
  await cdp('Page.navigate',{url:url+'/machine-harness.html'});await shown('합성 설비 가')
  assert.equal(await status(path+'/EQ-B1'),403)
  await pic('entry');await click('합성 설비 가 (0)');await shown('설비 호출내역');await until(()=>run("document.querySelector('.mc-panel > footer button:last-child').getBoundingClientRect().right <= innerWidth && document.querySelector('.mc-module nav').getBoundingClientRect().bottom === innerHeight"),'full-width detail and docked slots');await pic('detail')
  await press('호출');await shown('이슈발생 호출사유');await pic('reasons')
  await click('닫기',dlg('이슈발생 호출사유'));await pic('call-cancel')
  await press('호출');await click('등록',dlg('이슈발생 호출사유'));await shown('이슈 내용을 선택 해주세요.');await click('확인',dlg('알림'))
  await mark('합성 진동');await mark('합성 정지');await click('등록',dlg('이슈발생 호출사유'))
  await shown('선택한 이슈로 호출 하시겠습니까?');await pic('call-confirm');await click('아니오',dlg('확인'))
  assert.equal((await state(path+'/EQ-A1')).issues.length,0)
  await click('등록',dlg('이슈발생 호출사유'));await click('예',dlg('확인'));await shown('호출 요청 되었습니다.');await click('확인',dlg('알림'));await shown('CALL-2');await pic('open')
  await press('조치자');await shown('이슈발생 조치내용');await pic('action');await mark('합성 점검')
  await click('등록',dlg('이슈발생 조치내용'));await shown('사원번호를 스캔하십시오.');await pic('scan')
  await click('닫기',dlg('담당자 스캔'));await pic('scan-cancel')
  await click('닫기',dlg('이슈발생 조치내용'));await pic('action-closed')
  await press('조치자');await mark('합성 점검');await click('등록',dlg('이슈발생 조치내용'))
  await enterNumber('INVALID');await shown('유효하지 않은 사번입니다.');await click('확인',dlg('알림'));await enterNumber('LAB-TECH')
  await shown('선택한 내용으로 조치 하셨습니까?');await pic('action-confirm');await click('아니오',dlg('확인'))
  assert.equal((await state(path+'/EQ-A1')).issues[0].closedAt,null)
  await click('등록',dlg('이슈발생 조치내용'));await enterNumber('LAB-TECH')
  await click('예',dlg('확인'));await shown('조치가 완료되었습니다.');await click('확인',dlg('알림'))
  await shown('시험 조치자');await pic('resolved')
  const history=await state(path+'/EQ-A1')
  assert.equal(history.issues.length,2);assert.equal(history.issues[0].openedBy.id,'DEMO-W01')
  assert.equal(history.issues[0].closedBy.id,'LAB-TECH');assert.equal(history.issues[1].closedAt,null)
  await press('조치자');await shown('조치가 완료 된 호출은 처리 할 수 없습니다.');await click('확인',dlg('알림'))
  await click('닫기','document.querySelector(".mc-panel footer")');await pic('detail-closed');await click('합성 설비 나 (0)')
  assert.equal((await state(path+'/EQ-A2')).issues.length,0)
  const protocol=await run(`(async()=>{
    const target='/api/demo/machine-calls/EQ-A2/issues'
    const send=async(url,body)=>{const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return [res.status,res.ok?await res.json():null]}
    const key=crypto.randomUUID()
    const bad=await send(target,{key,reasons:['R-A','unknown']})
    const empty=await (await fetch('/api/demo/machine-calls/EQ-A2')).json()
    const results=await Promise.all([send(target,{key,reasons:['R-A','R-B']}),send(target,{key,reasons:['R-B','R-A']})])
    const issue=results[0][1][0]
    const scan=await send(target+'/'+issue+'/scan',{action:'A-A',employeeNo:'LAB-TECH'})
    await fetch('/api/demo/machine-calls/scans/'+scan[1].token,{method:'DELETE'})
    const canceled=await send(target+'/'+issue+'/close',{key:crypto.randomUUID(),token:scan[1].token})
    return [bad[0],empty.issues.length,results[0][1],results[1][1],canceled[0]]
  })()`)
  assert.deepEqual(protocol.slice(0,2),[400,0]);assert.equal(protocol[2].length,2);assert.deepEqual(protocol[2],protocol[3]);assert.equal(protocol[4],403)
  await login('DEMO-B','DEMO-W03');await until(async () => (await state('/api/pop/session')).terminal?.id === 'DEMO-B','second terminal session');assert.equal(await status(path+'/EQ-A1'),403)
  console.log('PASS '+version.Browser+' Spring/React machine buttons, machine scope, multi-reason atomic open, cancellation, invalid/valid scan, selected issue close/history, no duplicate close')
} catch (error) {
  console.error(backendOutput.slice(-1200))
  throw error
} finally {
  ws?.close()
  web.close()
  web.closeAllConnections()
  if (chrome?.pid) spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 4000 })
  backend.kill()
  backend.stdout.destroy()
  backend.stderr.destroy()
  setTimeout(() => process.exit(process.exitCode ?? 0), 5000).unref()
}
