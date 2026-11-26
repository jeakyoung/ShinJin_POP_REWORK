import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { canOpenProcessLot } from '../../src/web/src/processLot/processLotAccess.ts'

// node --experimental-strip-types tools/process-lot/verify-slots.mjs <jar> <default dataset>
const jar = resolve(process.argv[2])
const dataset = JSON.parse(await readFile(process.argv[3], 'utf8'))
const dir = await mkdtemp(join(tmpdir(), 'process-lot-slot2-'))
dataset.stations['DEMO-A'].slots = [2]
dataset.menuProcesses['DEMO-A'].slots = {'2':'SYNTHETIC-CUT-2'}
const filename = join(dir, 'slot2.json')
await writeFile(filename, JSON.stringify(dataset))
const probe = createServer()
await new Promise(ready => probe.listen(0, '127.0.0.1', ready))
const port = probe.address().port
await new Promise(done => probe.close(done))
const base = 'http://127.0.0.1:'+port
const launch = process.env.DEMO_TEST_LIB ? ['-cp', jar+delimiter+join(process.env.DEMO_TEST_LIB,'*'), 'com.shinjin.pop.PopApplication'] : ['-jar',jar]
const spring = spawn('java',[...launch,'--spring.profiles.active=demo','--spring.config.location=optional:classpath:/',
  '--server.address=127.0.0.1','--server.port='+port,'--shinjin.demo.dataset='+filename],{cwd:dir,windowsHide:true,stdio:'ignore'})
try {
  let started = false
  for (let i=0;i<250 && !started;i++) {
    await new Promise(done=>setTimeout(done,200))
    started = await fetch(base+'/api/pop/context').then(r=>r.ok).catch(()=>false)
  }
  assert.ok(started,'isolated Spring demo')
  const http = (path, data, cookie='') => fetch(base+path,{method:'POST',
    headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(data)})
  const endpoint='/api/pop/work-orders/2026-11-25/101/material-scan'
  const scan=(slot,cookie)=>http(endpoint+(slot===undefined?'':'?slot='+slot),{raw:'LOT-A-01'},cookie)
  assert.equal((await scan(2)).status,401)
  const login=await http('/api/pop/session',{terminalId:'DEMO-A',method:'scan',identifier:'SCAN:DEMO-W01'})
  assert.equal(login.status,200)
  const actor=await login.json()
  assert.deepEqual(actor.processSlots,[2])
  assert.equal(actor.workCodes[2],'SYNTHETIC-CUT-2')
  const cookie=login.headers.getSetCookie()[0].split(';')[0]
  for(const slot of [2,undefined]) {
    const response=await scan(slot,cookie)
    assert.equal(response.status,200)
    assert.equal((await response.json()).length,3)
  }
  for(const slot of [0,1,3,4,5,6,7]) assert.equal((await scan(slot,cookie)).status,403)
  assert.equal(canOpenProcessLot(actor,2),true)
  for(const slot of [undefined,1,3,4,5,6,7]) assert.equal(canOpenProcessLot(actor,slot),false)
  for(const slot of [1,2,3,4,5]) assert.equal(canOpenProcessLot({...actor,processSlots:[slot],workCodes:{[slot]:'SYN'}},slot),true)
  for(const value of [{groupWork:true},{workCenterCode:'OTHER'},{workCodes:{}},{processSlots:[]}])
    assert.equal(canOpenProcessLot({...actor,...value},2),false)
  console.log('PASS slot 2 only: real login, authenticated three-position scan, slotless compatibility, unauthorized slots 403, anonymous 401, UI guard slots 1–5 and excluded forms.')
} finally { spring.kill() }
