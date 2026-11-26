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
  await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:1024,deviceScaleFactor:1,mobile:false})
  await cdp('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1})
  async function tap(expression) {
    const point=await until(()=>run(`(()=>{const e=${expression};if(!e || e.disabled)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`),'touch target')
    await cdp('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]})
    await cdp('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  }
  const dlg="document.querySelector('dialog.common-numeric-pad[open]')"
  const key=text=>tap(`[...${dlg}.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)})`)
  const enter = async () => {
    await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'})
    await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  }
  const display=()=>run(dlg+".querySelector('output').textContent")
  async function keyAndWait(k,v){await key(k);await until(async()=>await display()===v,'display '+v)}
  async function capture(name) {
    if(!process.env.COMMON_INPUT_CAPTURE_DIR)return
    const png=await cdp('Page.captureScreenshot',{format:'png'})
    await writeFile(join(process.env.COMMON_INPUT_CAPTURE_DIR,name+'.png'),Buffer.from(png.data,'base64'))
    const bounds=await run("(()=>{const d=document.querySelector('.common-numeric-pad[open],.common-scan-dialog[open]');if(!d)return null;const r=d.getBoundingClientRect();return {x:r.left,y:r.top,width:r.width,height:r.height,scale:1}})()")
    if(bounds){
      const image=await cdp('Page.captureScreenshot',{format:'png',clip:bounds})
      await writeFile(join(process.env.COMMON_INPUT_CAPTURE_DIR,name+'-dialog.png'),Buffer.from(image.data,'base64'))
    }

  }
  await login('DEMO-A','DEMO-W01')
  await until(()=>run("!!document.querySelector('.workplace-menu')"),'workplace menu')
  await click('관리');await click('소모품 요청')
  const cell="document.querySelector('.supplies-grid input[aria-label$=출고수량]')"
  await until(()=>run('!!'+cell),'catalog row from Spring')
  const read=()=>run(cell+'.value')
  const old=await read()
  await capture('web-supplies-before')
  await tap(cell);await until(()=>run('!!'+dlg),'numeric pad')
  assert.equal(await display(),'0')
  await capture('web-integer')
  await keyAndWait('1','1');await keyAndWait('2','12')
  await key('취소');assert.equal(await read(),old)
  assert.equal(await run('document.activeElement === '+cell),true)
  await tap(cell);await until(()=>run('!!'+dlg),'reopen')
  for(let i=0;i<8;i++)await key('9')
  assert.equal(await display(),'9,999,999')
  await keyAndWait('←','999,999');await key('적용')
  const available=await run("Number("+cell+".closest('td').previousElementSibling.previousElementSibling.textContent)")
  assert.ok(available>0 && available<999999);assert.equal(Number(await read()),available)
  await tap(cell);await until(()=>run('!!'+dlg),'reopen zero')
  assert.equal(await run("document.activeElement.textContent"),'적용');await enter();assert.equal(await read(),'0')
  await capture('web-supplies-after')
  console.log('PASS '+version.Browser+' login → 관리 → 소모품 요청 → real quantity cell. Touch accumulation, comma length cap, backspace, cancel unchanged, focus return, caller cap, zero.')
  await cdp('Page.navigate',{url:url+'/numeric-modes.html'})
  await shown('decimal')
  await click('decimal');await until(()=>run('!!'+dlg),'decimal')
  await capture('web-decimal')
  for(const k of ['0','.','.','1','2','0'])await key(k)
  assert.equal(await display(),'0.120');await key('적용');await shown('result=0.12')
  await click('decimal');await until(()=>run('!!'+dlg),'fresh decimal')
  for(const k of '123456789.')await key(k)
  assert.equal(await display(),'12345678.');await key('9');assert.equal(await display(),'12345678.')
  await keyAndWait('C','0');await key('적용');await shown('result=0')
  await click('preset');await until(()=>run('!!'+dlg),'preset')
  await capture('web-preset')
  await key('적용');assert.equal(await display(),'0')
  await keyAndWait('200','200');await keyAndWait('1550','1550')
  await keyAndWait('C','0');await key('적용');assert.equal(await display(),'0')
  await keyAndWait('450','450');await key('적용');await shown('result=450')
  console.log('PASS isolated decimal and preset. Duplicate point, 8-character gate, trailing point, canonical decimal, zero, preset overwrite, clear.')
  const scanField="document.querySelector('.common-scan-dialog input')"
  for (const mode of ['material','order','integrated']) {
    await click(mode);await until(()=>run('document.activeElement === '+scanField),'scan input focus')
    await capture('web-scan-'+mode)
    await cdp('Input.insertText',{text:' ERROR '});await enter();await shown('fixture error')
    await until(()=>run('document.activeElement === '+scanField+" && "+scanField+".value === ''"),'refocus after error')
    await cdp('Input.insertText',{text:'NEXT'});await enter()
    await until(()=>run(scanField+".value === ''"),'ready for next scan')
    await click('닫기',"document.querySelector('.common-scan-dialog')")
    await shown('result='+mode+(mode==='material'?' cancel':' ok'))
  }
  await click('material');await until(()=>run('document.activeElement === '+scanField),'reopen')
  await cdp('Input.insertText',{text:'MULTI'});await enter();await shown('result=material ok')
  console.log('PASS scan surfaces: raw Enter value, retry focus, consecutive reads, material cancel versus accepted close flag and explicit OK.')

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
