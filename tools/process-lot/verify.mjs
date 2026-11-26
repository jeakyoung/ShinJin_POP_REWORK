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
  const qs = selector => 'document.querySelector('+JSON.stringify(selector)+')'
  const endpoint = '/api/pop/work-orders/2026-11-25/101'
  const query = async (raw,path=endpoint) => run(`fetch(${JSON.stringify(path+'/material-scan')},{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify({raw}))}}).then(async r=>[r.status, r.ok ? await r.json() : null])`)
  async function save(name){
    if(process.env.LOT_CAPTURE_DIR){
      const {data}=await cdp('Page.captureScreenshot',{format:'png'})
      await writeFile(join(process.env.LOT_CAPTURE_DIR,name+'.png'),Buffer.from(data,'base64'))
    }
  }
  const field = qs('.common-scan-dialog input')
  const picker = qs('.pl-select[open]')
  const notice = qs('.pl-notice[open]')
  const parent = qs('table[aria-label="투입자재 목록"]')
  const rows = () => run(parent+".querySelectorAll('[data-process-lot]').length")
  const btn = label => qs('button[aria-label="'+label+'"]')
  const scanOpen = async () => {
    await tap(btn('투입 LOT 스캔'))
    await until(()=>run('!!'+field+' && document.activeElement === '+field),'scanner focus')
  }
  async function scan(raw){
    await cdp('Input.insertText',{text:raw})
    await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'})
    await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  }
  const ready = () => until(()=>run(field+" && "+field+".value === '' && document.activeElement === "+field),'clear and refocus')
  if (process.argv.includes('--stock-picker')) {
    const { verifyPicker } = await import('../process-stock-picker/verify-picker.mjs')
    await verifyPicker({login, run, cdp, tap, click, shown, until, url, save, qs, btn, scan, version})
  } else {
  assert.equal((await query('LOT-A-01'))[0],401)
  await login('DEMO-A','DEMO-W01')
  await until(async()=>await run('!!'+qs('button[data-slot="1"]')+' || !!'+btn('투입 LOT 스캔')),'production entrance')
  if(await run('!!'+qs('button[data-slot="1"]'))) await tap(qs('button[data-slot="1"]'))
  await shown('DEMO-ORDER-11')
  await until(()=>run(`(()=>{const row=[...document.querySelectorAll('table[aria-label="작업지시 목록"] tbody tr')].find(r=>r.innerText.includes('DEMO-ORDER-11'));if(!row)return false;row.click();return true})()`),'select plan')
  await until(()=>run("document.querySelector('.prod-info')?.innerText.includes('합성 강재 A')"),'current plan')
  const before=await state(endpoint)
  const [code,multi]=await query('LOT-A-01')
  assert.equal(code,200);assert.equal(multi.length,3)
  assert.equal(new Set(multi.map(s=>JSON.stringify([s.warehouse,s.location]))).size,3)
  assert.equal((await query('LOT-A-01',endpoint.replace('/101','/99999')))[0],404)
  assert.equal((await query(null))[0],400)
  assert.deepEqual(await query(' LOT-A-01'),[200,[]])
  assert.deepEqual(await query('LOT-A-01',endpoint.replace('/101','/102')),[200,[]])
  await save('web-parent-before')
  await scanOpen()
  const box = selector => run(`(()=>{const r=(${selector}).getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()`)
  assert.deepEqual(await box(qs('.common-scan-dialog')),[70,270,880,300])
  await save('web-scan')
  await scan(' LOT-A-01');await shown('유효한 Lot No가 아닙니다.');await save('web-empty')
  await ready()
  assert.equal(await rows(),0)
  await scan('LOT-A-02');await ready();await scan('LOT-A-02');await ready()
  await click('닫기',qs('.common-scan-dialog'));assert.equal(await rows(),1)
  const cells = lot => run(`[...${parent}.querySelectorAll('tr[data-process-lot="${lot}"]')].map(r=>[...r.cells].slice(1).map(c=>c.textContent))`)
  assert.equal((await cells('LOT-A-02'))[0][5],'2')
  await scanOpen();await scan('LOT-A-01');await shown('적용 목록')
  assert.deepEqual((await box(picker)).slice(2),[1280,831])
  await tap(btn('WH-A BIN-01 추가'));await click('닫기',picker)
  assert.equal(await rows(),1)
  await scanOpen();await scan('LOT-A-01');await shown('적용 목록')
  await click('적용',picker);await shown('항목을 선택하십시오.');await click('확인',notice)
  await tap(btn('WH-A BIN-01 추가'));await tap(btn('WH-A BIN-02 추가'))
  await tap(btn('WH-A BIN-01 추가'));await tap(btn('BIN-01 삭제'))
  await save('web-location')
  await click('적용',picker);await until(async()=>await rows()===3,'merge into parent')
  assert.deepEqual((await cells('LOT-A-01')).map(row=>[row[0],row[5],row[6]]),[['WH-A','1','BIN-01'],['WH-A','1','BIN-02']])
  assert.equal(await run(parent+".querySelectorAll('[data-process-lot] input:checked').length"),3)
  await save('web-parent-after')
  await scanOpen();await scan('LOT-A-01');await shown('적용 목록');await tap(btn('WH-A BIN-02 추가'))
  await tap(btn('BIN-02 투입수량'));await click('9',qs('.common-numeric-pad'));await click('적용',qs('.common-numeric-pad'))
  await click('적용',picker);await shown('투입수량이 재고 수량보다 높을 순 없습니다.');await click('확인',notice);await click('닫기',picker)
  assert.deepEqual(await state(endpoint),before)
  console.log(version.Browser+' PASS 1280x1024. Touch slot 1 -> plan -> scanner -> Spring -> choice -> parent. Empty/refocus, single repeat, cancel, 3 locations, empty apply, quantity overflow, exact raw, server ledger/stock unchanged.')
  await login('DEMO-B','DEMO-W03')
  await until(async()=>(await query('LOT-A-01'))[0]===403,'forbidden slot')
  console.log('PASS anonymous 401, unassigned terminal 403, unknown plan 404, missing raw 400, other specification returns empty.')
  }
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
