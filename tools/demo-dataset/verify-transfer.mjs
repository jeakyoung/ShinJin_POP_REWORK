import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = resolve(process.argv[2])
const sample = fileURLToPath(new URL('./transfer.json', import.meta.url))
const dir = await mkdtemp(join(tmpdir(), 'pop-transfer-'))
const empty = join(dir, 'empty.json')
await writeFile(empty, JSON.stringify({ description: '빈 결과 검증', TCO101: [], TCO102: [], terminalPlants: {} }))
const launch = process.env.DEMO_TEST_LIB
  ? ['-cp', app + delimiter + join(resolve(process.env.DEMO_TEST_LIB), '*'), 'com.shinjin.pop.PopApplication']
  : ['-jar', app]

async function verify(file, isEmpty) {
  const proc = spawn(process.env.JAVA_EXE || 'java', [...launch, '--spring.profiles.active=demo',
    '--spring.config.location=optional:classpath:/isolated.properties', '--server.address=127.0.0.1',
    '--server.port=0', '--shinjin.demo.transfer-master=' + file], { cwd: dir, windowsHide: true })
  const stopped = once(proc, 'exit')
  let log = ''
  proc.stdout.setEncoding('utf8').on('data', chunk => { log += chunk })
  proc.stderr.setEncoding('utf8').on('data', chunk => { log += chunk })
  try {
    const deadline = Date.now() + 60000
    while (proc.exitCode === null && !/Tomcat started on port (\d+)/.test(log) && Date.now() < deadline)
      await new Promise(r => setTimeout(r, 100))
    const match = /Tomcat started on port (\d+)/.exec(log)
    assert.ok(match, log.slice(-2000))
    const api = 'http://127.0.0.1:' + match[1] + '/api/pop'
    let cookie = ''
    const post = (path, data) => fetch(api + path, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(data) })
    const preview = documents => post('/transfers/output-list/preview', { documents })
    assert.equal((await preview([])).status, 401)
    const login = await post('/session', { terminalId: 'DEMO-A', method: 'manual', identifier: 'DEMO-W01', passcode: 'demo-only' })
    assert.equal(login.status, 200)
    cookie = login.headers.getSetCookie()[0].split(';')[0]
    const state = async () => (await fetch(api + '/transfers', { headers: { cookie } })).json()
    const before = await state()
    assert.equal(before.master.configured, true)
    if (isEmpty) {
      assert.deepEqual(before.master.plants, [])
      assert.deepEqual(before.master.warehouses, [])
      assert.equal(before.master.terminalPlant, null)
      assert.equal((await preview([])).status, 400)
      return
    }
    assert.equal(before.master.terminalPlant, '000001')
    assert.deepEqual(before.master.warehouses.map(w => w.WAREHOUSE_CODE), ['BIN-SOURCE', 'BIN-DEST'])
    assert.ok(before.master.plants.some(p => p.CODE_ID2 === 'TEST-EMPTY'))
    assert.ok(!before.master.warehouses.some(w => w.PLANT_CODE === 'TEST-EMPTY'))
    const request = 'QA-OUT-A'
    const send = (command, fail = false) => post('/transfers/commands', { command, simulatePopFailure: fail })
    const lines = [{number: 19, item: 'SKU-Y', quantity: '1.00'}, {number: 7, item: 'SKU-X', quantity: '2'}]
    const saved = await send({request, commandId: 'create', action: 'REQUEST',
      draft: {source: before.source, destination: before.destination, lines}})
    assert.equal(saved.status, 200)
    const id = (await saved.json()).transfer.documents.REQUEST
    const created = await state()
    const output = await (await preview([id, id])).json()
    assert.equal(output.form, 'rptOutputList')
    assert.equal(output.printerRole, 'Printer1')
    assert.equal(output.groups.length, 1)
    const [group] = output.groups
    assert.equal(group.total, 3)
    assert.equal(group.receivingPlant, '시험 입고사업장')
    assert.deepEqual(group.rows.map(r => [r.number, r.specification]), [[7, '시험 20×30'], [19, '시험 40×50']])
    assert.equal((await preview([id, {...id, revision: -1}])).status, 409)
    assert.deepEqual(await state(), created)
    const ship = {request, commandId: 'ship-auto', action: 'SHIP', sourceDocument: id, autoReceive: true}
    assert.equal((await send(ship, true)).status, 503)
    const pending = await state()
    assert.deepEqual(pending.stock, created.stock)
    assert.deepEqual(pending.pending[0].command.sourceDocument, id)
    assert.equal((await send(pending.pending[0].command)).status, 200)
    const after = await state()
    assert.equal(after.transfers[0].status, 'RECEIVED')
    assert.equal(after.stock.find(r => r.warehouse === before.destination && r.item === 'SKU-X').quantity, '2.000')
    assert.equal((await send(ship)).status, 200)
    assert.deepEqual(await state(), after)
  } finally {
    if (proc.exitCode === null) proc.kill()
    await stopped
  }
}
await verify(sample, false)
console.log('PASS transfer master, report grouping and replay')
await verify(empty, true)
console.log('PASS configured empty transfer master')
