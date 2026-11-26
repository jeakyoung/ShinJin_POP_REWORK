export async function verifySite({ login, rpc, waitFor, tap, click, settings, evaluate, json, capture, contains, assert, yes }) {
  const A='DEMO-A', Z='DEMO-A2'
  const root='/api/pop/admin/terminal-settings/'
  const equipment=id=>json(root+id+'/equipment')
  const base=async id=>(await json(root+id)).view
  async function enter(id,worker) {
    await login(id,worker);await rpc('Page.reload');await waitFor(()=>!!document.querySelector('.authenticated-bar'))
    await tap('button[aria-label="메뉴 복귀"]');await settings()
    await evaluate(()=>{window.alert=m=>{window.lastPrompt=m};window.confirm=()=>true})
  }
  const tile=n=>'.settings-tiles > :nth-child('+n+')'
  async function open(n,cls){
    await tap(tile(n))
    await waitFor(s=>!!document.querySelector(s+' footer button:not(:disabled)'),cls)
    await waitFor(s=>!!document.querySelector(s+' td'),cls)
  }
  const save='.eq-dialog footer button:first-child', close='.eq-dialog footer button:last-child'
  await enter(Z,'DEMO-W04');await capture('.settings-tiles','settings',1000,500);await capture('.settings-home','settings-full')
  await open(4,'.eq-machine');await tap('input[aria-label="합성 설비 1"]');await tap(save)
  await waitFor(()=>!document.querySelector('.eq-dialog'))
  await open(5,'.popid-dialog');await tap('input[aria-label="합성 POP 설비 1"]');await tap(save)
  await waitFor(()=>!document.querySelector('.eq-dialog'))
  await enter(A,'DEMO-W01');await open(5,'.popid-dialog')
  await tap('input[aria-label="합성 POP 설비 1"]');await yes(false);await tap(save)
  assert(await evaluate(()=>window.lastPrompt.includes('타설비')),'POP ownership warning')
  assert((await equipment(A)).popRows[0].owner===Z,'decline transfer')
  await yes(true);await tap(save);await waitFor(()=>!document.querySelector('.eq-dialog'))
  assert((await equipment(A)).popRows[0].owner===A,'POP ownership change')
  await open(4,'.eq-machine');await evaluate(()=>{window.lastPrompt=''});await tap('input[aria-label="합성 설비 1"]');await yes(false);await tap(save)
  assert(await evaluate(()=>window.lastPrompt.includes('타설비')),'machine ownership warning')
  assert((await equipment(A)).machines[1].owner===Z,'machine takeover declined')
  await yes(true);await tap(save);await waitFor(()=>!document.querySelector('.eq-dialog'))
  await open(5,'.popid-dialog');await capture('.eq-dialog','pop-id')
  await tap('input[aria-label="합성 POP 설비 2"]');await tap(close)
  assert((await equipment(A)).popRows[0].owner===A,'POP close changed mapping')
  await open(2,'.site-dialog')
  const left='.site-tables .eq-grid:first-child tbody tr:first-child button'
  const last='.site-tables .eq-grid:last-child tbody tr:last-child button'
  await tap(left);assert(await evaluate(()=>window.lastPrompt==='상단 공장을 터치해 주세요.'),'plant focus prerequisite')
  await tap('.site-fields button:first-child');await tap(left);await tap(save)
  assert(await evaluate(()=>window.lastPrompt==='상단 작업장이 선택되지 않았습니다.'),'no auto center')
  await tap(last);assert(await evaluate(()=>window.lastPrompt==='상단 작업장을 터치해 주세요.'),'center focus prerequisite')
  await tap('.site-fields button:last-child');await tap(last);await capture('.eq-dialog','plant')
  await tap(close);assert((await equipment(A)).site.center==='005','plant cancel')
  await open(2,'.site-dialog');await tap('.site-fields button:first-child');await tap(left)
  await tap('.site-fields button:last-child');await tap(last)
  const snap=await equipment(A)
  await json(root+A+'/equipment/pop-id',{number:'POP01',expectedVersion:snap.version},'PUT')
  await tap(save);await contains('최신 목록을 확인하십시오.')
  assert((await equipment(A)).site.center==='005','stale plant mutated')
  await waitFor(()=>!!document.querySelector('.site-fields button:not(:disabled)'))
  await tap('.site-fields button:first-child');await tap(left)
  await tap('.site-fields button:last-child');await tap(last);await tap(save)
  await waitFor(()=>!document.querySelector('.eq-dialog'))
  await waitFor(()=>document.querySelector('.settings-tiles button:nth-child(4)')?.classList.contains('equipment-unset'))
  await tap(tile(5));await waitFor(()=>window.lastPrompt==='공정 설정을 진행하십시오.')
  assert((await base(A)).saved.values.materials.length===0,'material reset')
  await tap(tile(3));await waitFor(()=>!!document.querySelector('.settings-dialog[open]'))
  assert(await evaluate(()=>document.querySelectorAll('.settings-process-slots button:disabled').length===5),'005/105 slots')
  await tap('.settings-slot tbody tr:first-child button');assert(await evaluate(()=>window.lastPrompt.includes('상단 작업 유형')),'slot required')
  await tap('.settings-process-slots [data-slot="6"]');await tap('.settings-slot tbody tr:first-child button');await tap('.settings-dialog[open] footer button:first-child')
  await waitFor(()=>!document.querySelector('.settings-dialog[open]'))
  await open(4,'.eq-machine');await tap('input[aria-label="합성 설비 2"]');await tap(save)
  await waitFor(()=>!document.querySelector('.eq-dialog'))
  await open(5,'.popid-dialog');await tap('input[aria-label="합성 POP 설비 2"]');await tap(save)
  await waitFor(()=>!document.querySelector('.eq-dialog'))
  for (const [n,label,w,h] of [[3,'process-slot',800,900],[6,'material',798,868],[1,'printer',800,900]]) {
    await tap(tile(n));await waitFor(()=>!!document.querySelector('.settings-dialog[open]'))
    await capture('.settings-dialog[open]',label,w,h)
    await tap('.settings-dialog[open] footer button:last-child')
  }
  await login(A,'DEMO-W01');await rpc('Page.reload')
  await waitFor(()=>!!document.querySelector('[data-slot="robot"]:not(:disabled)'))
  assert(!await evaluate(()=>document.querySelector('[data-slot="pack"]').disabled),'saved slot 6 enabled at login')
  await tap('[data-slot="robot"]');await contains('공정·창고 순서가 설정되지 않아')
  const v=await equipment(A)
  assert(v.site.center==='105'&&v.applied.machines.join()==='M02'&&v.applied.popId===A,'105 login snapshot')
  console.log('PASS Chrome touch: site field activation, filtered centers, no auto-selection, cancel, 409/reload, real process -> machine -> POP tiles, machine and POP reassignment warnings, 105 menu and login snapshot')
}
