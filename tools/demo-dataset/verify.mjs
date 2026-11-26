import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep, delimiter } from 'node:path'
import assert from 'node:assert/strict'

// Arguments: Spring Boot jar, Vite dist, default or alternate.json.
const jar = resolve(process.argv[2])
const build = dirname(jar)
const alternate = process.argv[4] !== 'default'
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
  ...(alternate ? ['--shinjin.demo.dataset=' + resolve(process.argv[4])] : []),
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
  const context=await state('/api/pop/context')
  const group='/api/pop/process-group-demo'
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
  const home=()=>run("document.querySelector('button[aria-label=\"메뉴 복귀\"]').click()")
  assert.equal(await status(group),401)
  if (!alternate) {
    assert.equal(context.sampleDate,'2026-11-25')
    assert.deepEqual(context.terminals.map(t=>t.id),['DEMO-A','DEMO-B','DEMO-A2'])
    await login('DEMO-A','DEMO-W01');await shown('작업장 메뉴')
    assert.equal(await includes('그룹 작업'),false)
    await click('작업실적조회');await click('조회');await shown('샘플 강판 A')
    assert.equal(await status('/api/pop/work-baskets'),200)
    assert.equal(await status(group+'/sample-a',true),403)
    const orderScan = (barcode, listed) => run(`fetch('/api/drawing-008/order-scan', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: ${JSON.stringify(JSON.stringify({barcode, listed}))}
    }).then(async r => ({status:r.status, result:await r.json()}))`)
    const label = '202611S00001Q01S'
    const first = 'F1/000001/20261125/1'
    const second = 'F1/000001/20261125/2'
    assert.deepEqual((await orderScan(label, [])).result.map(plan => plan.key), [first, second])
    assert.deepEqual((await orderScan(label, [first])).result.map(plan => plan.key), [second])
    assert.deepEqual((await orderScan(label, [first, second])).result, [])
    assert.equal((await orderScan('202611S00003Q01S', [])).result.error, 'ORDER_NOT_DRAWING')
    assert.equal((await orderScan('202611S00004Q01S', [])).status, 404)
    console.log('PASS order scan returns all matching plans, omits listed rows and isolates sites')
    console.log('PASS default identities, original menu and history, basket access, denied group')
  } else {
    assert.equal(context.sampleDate,'2030-02-01')
    await login('GROUP-A','QA-1');await shown('작업장 메뉴')
    await click('작업실적조회');await click('조회');await shown('검증용 소재')
    await home();await click('그룹 작업');await shown('공정 A · 창고 A')
    assert.equal(await run("!!document.querySelector('section.floor-work select')"),false)
    assert.equal(await includes('frmProcess'),false)
    assert.equal(await status(group+'/group-B',true),403)
    assert.equal(await status('/api/pop/work-baskets'),403)
    await run("document.querySelector('section.floor-work input[type=checkbox]').click()")
    await click('그룹 작업 시작');await click('확정','document.querySelector("dialog[open]")')
    await shown('시작한 계획의 실적 입력')
    assert.deepEqual((await state(group)).started,['PLAN-A'])
    await login('GROUP-A','QA-2');await shown('작업장 메뉴')
    await click('작업실적조회');await click('조회');await shown('조건에 맞는 작업이력이 없습니다.')
    assert.deepEqual((await state(group)).started,[])
    await login('GROUP-B','QA-1');await shown('작업장 메뉴')
    await click('그룹 작업');await shown('공정 B · 창고 B')
    assert.equal(await status(group+'/group-A'),403)
    await login('DEMO-A','DEMO-W01');await shown('작업 장바구니')
    await cdp('Page.navigate',{url});await shown('작업 장바구니')
    await home();await shown('작업장 메뉴');assert.equal(await includes('그룹 작업'),false)
    assert.equal(await status(group, true),403)
    await login('DEMO-B','DEMO-W03');await shown('작업장 메뉴');assert.equal(await includes('그룹 작업'),false)
    console.log('PASS alternate dataset: login/menu, nonempty and empty history, server-bound 005/105, actor isolation, forged profile rejected, single-slot entry and restored session / '+version.Browser)
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
