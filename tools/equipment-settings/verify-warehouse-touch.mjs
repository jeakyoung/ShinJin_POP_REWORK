export async function verifyWarehouse({ login, rpc, waitFor, tap, finger, click, settings, evaluate, capture, assert, yes }, mode) {
  await login('DEMO-A','DEMO-W01')
  await rpc('Page.reload')
  await waitFor(() => !!document.querySelector('.authenticated-bar'))
  await tap('button[aria-label="메뉴 복귀"]')
  await click('생산')
  await rpc('Emulation.setDeviceMetricsOverride', { width:1280, height:800, deviceScaleFactor:1, mobile:false })
  if (mode === 'official') {
    assert(await evaluate(() => ['1','2'].every(slot => document.querySelector('[data-slot="'+slot+'"]')?.disabled === false)),
      'original MDI comparison uses POP A slots 1 and 2')
  }
  await capture('html','mdi-menu',1280,800)
  await rpc('Emulation.setDeviceMetricsOverride', { width:1280, height:1000, deviceScaleFactor:1, mobile:false })
  await settings()
  const tile = '.settings-tiles > :nth-child(7)'
  const save = '.wh-settings footer button:first-child'
  const cancel = '.wh-settings footer button:last-child'
  async function open() {
    await tap(tile)
    await waitFor(() => document.activeElement?.id === 'wh-pass')
  }
  async function type(value) {
    await rpc('Input.insertText',{text:value})
  }
  async function enter() {
    await open()
    await type(process.env.POP_WAREHOUSE_TEST_PASSWORD)
    await rpc('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
    await rpc('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
    await waitFor(() => !!document.querySelector('.wh-selection tbody tr'))
  }
  await open()
  await capture('.wh-password', 'password')
  await capture('html','mdi-password',1280,1000)
  if (mode !== 'warehouse') {
    await tap(save)
    await waitFor(() => window.lastPrompt === '설정 암호를 확인할 수 없습니다.' && document.activeElement?.id === 'wh-pass')
    await tap(cancel)
    console.log('PASS unavailable settings authentication stays on the password form, then closes')
    return
  }
  await type('invalid')
  await tap(save)
  await waitFor(() => window.lastPrompt === '비밀번호를 다시 입력하십시오.' && document.activeElement?.id === 'wh-pass' && document.activeElement.value === '')
  await tap(cancel)
  await enter()
  await tap('input[aria-label="WH-X 투입"]')
  await tap(cancel)
  await enter()
  assert(await evaluate(() => document.querySelectorAll('.wh-grid input:checked').length === 0),'selection cancel')
  for (const label of ['투입','반납','양품','불량','보조']) await tap('button[aria-label="'+label+' 전체 선택/해제"]')
  await tap('button[aria-label="보조 전체 선택/해제"]')
  await tap('input[aria-label="WH-Y 보조"]')
  await capture('.wh-selection','selection')
  await capture('html','mdi-selection',1280,1000)
  await yes(false); await tap(save)
  await waitFor(() => !!document.querySelector('.wh-selection'))
  await yes(true); await tap(save)
  await waitFor(() => !!document.querySelector('.wh-priority'))
  const order = n => '.wh-priorities section:nth-child('+n+')'
  const rowButton = (n,i) => order(n)+' tbody tr:nth-child('+i+') button'
  await tap(rowButton(1,2)); await tap('button[aria-label="투입 위로"]'); await tap(cancel)
  await enter()
  assert(await evaluate(() => document.querySelectorAll('.wh-grid input:checked').length === 13),'first save persists on priority cancel')
  await tap(save)
  await waitFor(() => !!document.querySelector('.wh-priority'))
  await tap(rowButton(1,2)); await tap('button[aria-label="투입 위로"]')
  await tap(rowButton(2,3)); await tap('button[aria-label="반납 위로"]'); await tap('button[aria-label="반납 위로"]')
  await tap(rowButton(3,1)); await tap('button[aria-label="양품 아래로"]'); await tap('button[aria-label="양품 아래로"]')
  await tap(rowButton(4,3)); await tap('button[aria-label="불량 위로"]')
  await tap(rowButton(5,1)); await tap('button[aria-label="보조 아래로"]')
  await capture('.wh-priority','priority')
  await capture('html','mdi-priority',1280,1000)
  await tap(save)
  await waitFor(() => !document.querySelector('.wh-settings'))
  // Read the setting after reauthentication and relogin without logging request or response bodies.
  await login('DEMO-A','DEMO-W01')
  const result = await rpc('Runtime.evaluate', {expression:
    "fetch('/api/pop/admin/terminal-settings/DEMO-A/warehouse/entry',{method:'POST',headers:{'Content-Type':'application/json'},body:"+
    JSON.stringify(JSON.stringify({password:process.env.POP_WAREHOUSE_TEST_PASSWORD}))+
    "}).then(r=>r.json()).then(v=>[v.saved.roles,v.applied.roles])",awaitPromise:true,returnByValue:true})
  const expected = {issue:['WH-Y','WH-X','WH-Z'],returns:['WH-Z','WH-X','WH-Y'],good:['WH-Y','WH-Z','WH-X'],bad:['WH-X','WH-Z','WH-Y'],auxiliary:['WH-Y']}
  for (const rules of result.result.value) for (const [key,expectedCodes] of Object.entries(expected))
    assert(JSON.stringify(rules[key]) === JSON.stringify(expectedCodes),'role order '+key)
  await rpc('Page.reload'); await waitFor(() => !!document.querySelector('.authenticated-bar'))
  await tap('button[aria-label="메뉴 복귀"]'); await settings(); await enter()
  await login('DEMO-A','DEMO-W02')
  await tap(save)
  await waitFor(() => !document.querySelector('.wh-settings'))
  await rpc('Page.reload'); await waitFor(() => !!document.querySelector('.authenticated-bar'))
  await tap('button[aria-label="메뉴 복귀"]'); await settings(); await enter()
  assert(await evaluate(() => [...document.querySelectorAll('.wh-grid input,.wh-selection footer button:first-child')].every(e => e.disabled)),'worker read only')
  await finger(cancel)
  console.log('PASS Chrome touch: masked challenge, wrong/cancel/reentry, role headers, independent priority edits, two save boundaries, relogin and worker scope')
}
