import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep, delimiter } from 'node:path'
import assert from 'node:assert/strict'

// Arguments: built Spring Boot jar and Vite dist. Uses an isolated synthetic Spring process.
const jar = resolve(process.argv[2])
const build = dirname(jar)
const testPassword = crypto.randomUUID()
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
const backend = spawn('java', [...launch, '--spring.profiles.active=demo', '--shinjin.demo.employee-print-submit=true',

  '--spring.config.location=optional:classpath:/', '--server.address=127.0.0.1', '--server.port=' + apiPort],
  { windowsHide: true, cwd: build, env: { ...process.env, SHINJIN_DEMO_EMPLOYEE_PRINT_PASSWORD: testPassword } })
let pageFault = true
let printFault = false
let lostReceipt
let replayReceipt
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
        headers: { ...(req.headers['x-employee-entry'] ? { 'X-Employee-Entry': req.headers['x-employee-entry'] } : {}),
          ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}),
          ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {}) },
        body,
      })
      const data = Buffer.from(await upstream.arrayBuffer())
      if (pageFault && req.method === 'GET' && /^\/api\/demo\/employee-print\/preview\/[^/]+\/1$/.test(req.url) && upstream.ok) {
        pageFault = false
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end('invalid image for regression')
        return
      }
      if (req.url.endsWith('/print') && upstream.ok) {
        if (printFault) {
          printFault = false
          lostReceipt = JSON.parse(data)
          res.writeHead(503).end()
          return
        }
        if (lostReceipt && !replayReceipt) replayReceipt = JSON.parse(data)
      }
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

  const logout = () => run("fetch('/api/pop/session/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.status)")
  await cdp('Page.enable')
  await until(() => run('location.origin === ' + JSON.stringify(url) + ' && document.readyState === "complete"'), 'loopback origin')


  const status=(path,post=false)=>run(`fetch(${JSON.stringify(path)},${post ? "{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}" : '{}'}).then(r=>r.status)`)
  async function login(terminal,worker){
    await logout()
    await cdp('Page.navigate',{url})
    await until(()=>run("!!document.querySelector('.login-settings')"),'login')
    assert.equal(await includes(worker),false)
    assert.equal(await includes('demo-only'),false)
    const identity={terminalId:terminal,method:'scan',identifier:'SCAN:'+worker}
    assert.equal(await run(`fetch('/api/pop/session',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify(identity))}}).then(r=>r.status)`),200)
    await cdp('Page.navigate',{url})
  }
  const home=()=>run("document.querySelector('button[aria-label=\"메뉴 복귀\"]').click()")
  async function inspectPage(tag, form, expectedIds) {
    const image = await run(`(async()=>{
      const img = document.querySelector('.employee-paper img')
      const response = await fetch(img.src)
      const svg = new DOMParser().parseFromString(await response.text(),'image/svg+xml')
      const canvas = document.createElement('canvas'); canvas.width=img.naturalWidth;canvas.height=img.naturalHeight
      canvas.getContext('2d').drawImage(img,0,0)
      return {type:response.headers.get('content-type'), labels:[...svg.querySelectorAll('text')].map(e=>e.textContent),
        width:canvas.width,height:canvas.height,png:canvas.toDataURL('image/png').split(',')[1]}
    })()`)
    assert.equal(image.type,'image/svg+xml');assert.equal(image.width,994);assert.equal(image.height,1405)
    if(form==='바코드') for(const id of expectedIds) assert.equal(image.labels.filter(text=>text===id).length,2)
    else for(const id of expectedIds) assert.equal(image.labels.includes(id),false)
    if(process.env.EMPLOYEE_CAPTURE_DIR) await writeFile(join(process.env.EMPLOYEE_CAPTURE_DIR,tag+'-'+(form==='QR'?'QR':'BARCODE')+'.png'),Buffer.from(image.png,'base64'))
  }
  const endpoint = '/api/demo/employee-print'
  const press = label => until(() => run(`(() => { const b = document.querySelector('button[aria-label="'+${JSON.stringify(label)}+'"]'); if (!b || b.matches(':disabled')) return false; b.click(); return true })()`), label)
  const grantPassword = value => run(`document.querySelector('.employee-password input').value=${JSON.stringify(value)}; document.querySelector('.employee-password form').requestSubmit()`)
  const option = name => until(() => run(`(() => {const b = [...document.querySelectorAll('.employee-choices button')].find(x=>x.lastElementChild.textContent===${JSON.stringify(name)}); if(b)b.click(); return !!b})()`), name)
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:980,deviceScaleFactor:1,mobile:false})
  let entryHeader
  let lastPrint
  await cdp('Network.enable')
  ws.addEventListener('message', e => {
    const msg = JSON.parse(e.data)
    if (msg.method !== 'Network.requestWillBeSent') return
    const req = msg.params.request
    if (!req.url.startsWith(url + endpoint)) return
    if (req.headers['X-Employee-Entry']) entryHeader = req.headers['X-Employee-Entry']
    if (req.url.endsWith('/print') && req.method === 'POST') lastPrint = { path: new URL(req.url).pathname, body: req.postData }
  })
  assert.equal(await status(endpoint+'/employees?plant=TEST-A'),401)
  await login('DEMO-A','DEMO-W01'); await until(() => run("!!document.querySelector('.workplace-menu')"), 'workplace menu')
  assert.equal(await status(endpoint+'/employees?plant=TEST-A'),403)
  await click('인쇄'); await click('사원번호 인쇄'); await shown('사용제한')
  await click('닫기','document.querySelector(".employee-password")');await until(() => run("!!document.querySelector('.workplace-menu')"), 'workplace menu')
  await click('사원번호 인쇄');await shown('비밀번호 입력');await grantPassword('incorrect');await shown('비밀번호를 다시 입력하십시오.')
  await click('확인','document.querySelector(".employee-message")')
  await grantPassword(testPassword);await until(()=>run("!!document.querySelector('.employee-form')"),'employee roster')
  assert.equal(await run("document.querySelectorAll('.employee-form tbody tr').length"),0)
  await click('QR');await shown('출력 할 항목을 선택 해주세요.');await click('확인','document.querySelector(".employee-message")')
  await press('사업장 선택');await option('합성사업장');await shown('QA0002')
  await press('부서 선택');await option('검증부');await shown('QA0001')
  await until(()=>run("document.querySelectorAll('.employee-form tbody tr').length===1"),'department scoped')
  await press('부서 선택');await option('전체');await shown('QA0002')
  await press('선택 전체')
  await click('QR')
  await shown('페이지를 열지 못했습니다.')
  assert.equal(await run("document.querySelector('[aria-label=\"Quick Print\"]').disabled"),true)
  await click('다시 불러오기','document.querySelector(".employee-preview")')
  await until(()=>run("document.querySelector('.employee-paper img')?.naturalWidth>500"),'preview with unregistered Printer1')
  console.log('PASS damaged image cannot print; page retry decodes original SVG')
  await press('Quick Print');await shown('Printer1 설정을 적용한 후 미리보기를 다시 여십시오.')
  assert.equal(await includes('합성 출력 접수'),false)
  await press('Close Preview')
  await click('QR');await until(()=>run("document.querySelector('.employee-paper img')?.naturalWidth>500"),'second preview with no device')
  const printerSettings='/api/pop/admin/terminal-settings/DEMO-A'
  assert.equal(await run(`(async()=>{const path=${JSON.stringify(printerSettings)}; const view=(await (await fetch(path)).json()).view; const [doc,,shipment,label]=view.catalog.printers;
    const saved=await fetch(path+'/printers',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedVersion:view.saved.version,outputs:{document:doc,shipment,label}})});
    if(!saved.ok)return saved.status; return (await fetch(path+'/refresh',{method:'POST'})).status})()`),200)
  await press('Quick Print');await shown('Printer1 설정을 적용한 후 미리보기를 다시 여십시오.')
  assert.equal(await includes('합성 출력 접수'),false)
  await press('Close Preview')
  console.log('PASS unregistered Printer1: preview and close, no receipt on submission, old preview remains unprintable after settings refresh')
  for(const form of ['QR','바코드']){
    await click(form);await until(()=>run("document.querySelector('.employee-paper img')?.naturalWidth>500"),'native A4 image')
    assert.equal(await run("document.querySelector('.employee-preview output').textContent"),'')
    await inspectPage('spring-pair',form,['QA0001','QA0002'])
    await press('Zoom In');await shown('110%');await press('Zoom Out')
    assert.equal(await run("document.querySelector('button[aria-label=\"Next Page\"]').disabled"),true)
    if(process.env.EMPLOYEE_CAPTURE_DIR){
      const screen=await cdp('Page.captureScreenshot',{format:'png'})
      await writeFile(join(process.env.EMPLOYEE_CAPTURE_DIR,form==='QR'?'web-qr.png':'web-barcode.png'),Buffer.from(screen.data,'base64'))
    }
    if (form==='QR' && !lostReceipt) {
      printFault = true
      await press('Quick Print');await shown('출력 접수를 확인하지 못했습니다.')
      assert.equal(await includes('합성 출력 접수'),false)
    }
    await press('Quick Print');await shown('합성 출력 접수 · A-DOC · 1쪽')
    if (form==='QR') { assert.deepEqual(replayReceipt,lostReceipt); console.log('PASS response lost after submission; retry returned same key and nextKey') }
    await until(()=>lastPrint && entryHeader,'print request observed')
    const replay = await run(`(async()=>{const resp=await fetch(${JSON.stringify(lastPrint.path)},{method:'POST',headers:{'Content-Type':'application/json','X-Employee-Entry':${JSON.stringify(entryHeader)}},body:${JSON.stringify(lastPrint.body)}});return {code:resp.status,result:await resp.json()}})()`)
    assert.equal(replay.code,200)
    assert.equal(replay.result.key,JSON.parse(lastPrint.body).key)
    assert.equal(replay.result.printer,'A-DOC')
    assert.equal(replay.result.copies,null)
    const oldRequest = {...lastPrint}
    assert.equal(await run(`fetch(${JSON.stringify(oldRequest.path)}, {method:'POST',headers:{'Content-Type':'application/json','X-Employee-Entry':${JSON.stringify(entryHeader)}},body:JSON.stringify({...JSON.parse(${JSON.stringify(oldRequest.body)}),copies:2})}).then(r=>r.status)`),409)
    await press('Close Preview')
    assert.equal(await run("document.querySelectorAll('.employee-form tbody input:checked').length"),2)
  }
  await press('사업장 선택');await option('빈 사업장')
  await until(()=>run("document.querySelectorAll('.employee-form tbody tr').length===0"),'empty site')
  if (process.env.EMPLOYEE_MULTIPAGE) {
    await press('사업장 선택');await option('연속 시험장');await shown('L22');await press('선택 전체')
    for(const form of ['QR','바코드']){
      await click(form)
      await until(()=>run("document.querySelector('.employee-paper img')?.naturalWidth>500"),'long report')
      const pageStatus=()=>run("document.querySelector('.employee-preview footer span').textContent")
      const pages=Number((await pageStatus()).split(' ').at(-1))
      assert.ok(pages>1)
      await press('Next Page');await until(async()=> (await pageStatus()).startsWith('Page 2 '),'next')
      if (pages>2) await press('Last Page');await until(async()=> (await pageStatus()).startsWith('Page '+pages+' '),'last')
      await press('Previous Page');if (pages>2) await press('First Page')
      await until(()=>run("document.querySelector('.employee-paper img')?.alt==='A4 1쪽'"),'first page reloaded')
      await press('Close Preview')
      console.log('PASS Spring multi-page '+form+' ('+pages+' pages)')
    }
  }
  if (process.env.EMPLOYEE_DYNAMIC) {
    await press('사업장 선택');await option('연속 시험장');await shown('NEW/77')
    for (const id of ['L02','NEW/77']) await run(`[...document.querySelectorAll('.employee-form tbody tr')].find(row=>row.cells[5].textContent===${JSON.stringify(id)}).click()`)
    for(const form of ['QR','바코드']){
      await click(form);await until(()=>run("document.querySelector('.employee-paper img')?.naturalWidth>500"),'new employee and noncontiguous selection')
      await inspectPage('spring-extra',form,['L02','NEW/77'])
      await press('Quick Print');await shown('합성 출력 접수 · A-DOC · 1쪽');await press('Close Preview')
    }
    console.log('PASS extra fixture employee and arbitrary subset, two Spring-generated A4 reports')
  }
  await home();await until(() => run("!!document.querySelector('.workplace-menu')"), 'workplace menu');
  assert.equal(await run(`fetch('/api/demo/employee-print/employees?plant=TEST-A',{headers:{'X-Employee-Entry':${JSON.stringify(entryHeader)}}}).then(r=>r.status)`),403)
  await click('사원번호 인쇄');await shown('비밀번호 입력')
  await click('닫기','document.querySelector(".employee-password")')
  console.log('PASS '+version.Browser+' / Spring, login, gated menu/cancel/wrong password/re-entry, plant/department/empty/selection, QR and Code128 Spring pages, zoom, page boundary, explicit Printer1 submissions, preserved checks')
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
