import { useSettingsPrompt } from './settingsPrompt'
import { useEffect, useRef, useState } from 'react'
import './equipmentSettings.css'

import type { Group, Step, View } from './equipmentSettingsApi'
type Side = 'START' | 'END'
type Selection = { number: string; side: Side }
type Props = { page: 'machines' | 'groups'; terminal: string; url: string; view?: View; onCommitted?: () => void; onView: (v: View) => void
  onExpired: () => void; onClose: (changed?:boolean) => void }

const asset = (id: string) => import.meta.env.BASE_URL + 'terminal-settings/' + id + '.png'
function choice(v: View, terminal: string): Selection | undefined {
  for (const row of v.groups) {
    if (row.start === terminal) return { number: row.number, side: 'START' }
    if (row.end === terminal) return { number: row.number, side: 'END' }
  }
}
function Tool({ icon, label, disabled, action }: { icon: string; label: string; disabled: boolean; action: () => void }) {
  return <button type="button" className="equipment-tool" aria-label={label} disabled={disabled} onClick={action}>
    <img src={asset('group-' + icon)} alt="" /></button>
}

export default function EquipmentDialog({ page, terminal, url, view, onView, onCommitted, onExpired, onClose }: Props) {
  const prompt = useSettingsPrompt()
  const dialog = useRef<HTMLDialogElement>(null)
  const active = useRef<AbortController | null>(null)
  const [machineFocus, setMachineFocus] = useState('')
  const [machines, setMachines] = useState<string[]>(view?.saved.machines ?? [])
  const [selected, setSelected] = useState<Selection | undefined>(() => view && choice(view, terminal))
  const [focused, setFocused] = useState(view?.groups[0]?.number ?? '')
  const [reload, setReload] = useState(0)
  const [editing, setEditing] = useState<Group>()
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(true)
  const [saving, setSaving] = useState(false)
  const blocked = busy || !view?.canEdit
  const machine = page === 'machines'
  useEffect(() => {
    const box = dialog.current
    box?.showModal()
    return () => { box?.close(); active.current?.abort() }
  }, [])
  useEffect(() => {
    const ctrl = new AbortController()
    fetch(url, { signal: ctrl.signal, cache: 'no-store' }).then(async r => {
      if (r.status === 401) { if (!ctrl.signal.aborted) onExpired(); return }
      if (!r.ok) throw Error()
      const v: View = await r.json()
      if (ctrl.signal.aborted) return
      onView(v); setMachines(v.saved.machines); setSelected(choice(v, terminal)); setFocused(v.groups[0]?.number ?? '')
      setBusy(false)
    }).catch(() => {
      if (!ctrl.signal.aborted) setNotice('설정을 불러오지 못했습니다. 닫고 다시 열어주세요.')
    })
    return () => ctrl.abort()
  }, [url, terminal, onView, onExpired, reload])

  async function change(operation: string, data: object = {}) {
    if (!view || blocked || active.current) return
    const ctrl = new AbortController()
    active.current = ctrl
    setBusy(true); setSaving(true); setNotice('')
    try {
      const r = await fetch(url + '/' + operation, { method: 'PUT', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: view.version, ...(view.siteRevision==null?{}:{siteRevision:view.siteRevision,scopePlant:view.site.plant,scopeCenter:view.site.center}), ...data }) })
      if (ctrl.signal.aborted) return
      if (r.status === 401) { onExpired(); return }
      if (!r.ok && r.status !== 409) throw Error()
      const v: View = await r.json()
      if (ctrl.signal.aborted) return
      if (r.ok) onCommitted?.()
      onView(v); setMachines(v.saved.machines); setSelected(choice(v, terminal)); setEditing(undefined)
      setFocused(v.groups.find(row => row.number === focused)?.number ?? v.groups[0]?.number ?? '')
      if (r.status === 409) setNotice('다른 세션에서 변경했습니다. 최신 목록에서 다시 선택하세요.')
      else if (operation === 'machines') onClose(true)
      else if (operation === 'assign') await prompt('저장 되었습니다.')
    } catch { if (!ctrl.signal.aborted) setNotice('저장 결과를 확인하지 못했습니다. 다시 조회하세요.') }
    finally { active.current = null; if (!ctrl.signal.aborted) { setBusy(false); setSaving(false) } }
  }
  function toggle(code: string) {
    setMachineFocus(code)
    if (blocked) return
    setMachines(previous => previous.includes(code) ? previous.filter(c => c !== code) :
      code === '000000' ? [code] : [...previous.filter(c => c !== '000000'), code])
  }
  async function save() {
    if (!view) return
    if (machine) {
      for (const m of view.machines) if (machines.includes(m.code) && m.owner && m.owner !== terminal)
        if (!await prompt('해당 설비는 타설비에서 POP IP를 설정했습니다.\n확인하십시오.')) return
      if (!machines.length) return prompt('설비를 선택하여주십시오.')
      if (machines.length > 6) return prompt('최대 설비 갯수는 6개입니다.')
      if (await prompt('설비 설정을 저장 하시겠습니까?', true)) void change('machines', { machines })
    } else {
      if (!selected) return prompt('적용할 설비를 선택하여주십시오.')
      if (await prompt('해당 설비에 POP ID를 저장 하시겠습니까?', true)) void change('assign', selected)
    }
  }
  const title = editing ? '공정 설정' : machine ? '설비 설정' : 'POP 그룹설정'
  function close() {
    if (active.current) return
    if (editing) {
      setBusy(true)
      setNotice('')
      setEditing(undefined)
      setReload(n => n + 1)
    }
    else onClose()
  }
  return <dialog ref={dialog} aria-label={title} className={'eq-dialog ' + (editing ? 'eq-process' : machine ? 'eq-machine' : 'eq-group')}
    onCancel={e => { e.preventDefault(); close() }}>
    <header><img src={asset(editing ? 'group-process-title' : machine ? 'machine-title' : 'group-title')} alt="" />
      <h2>{title}</h2><button type="button" aria-label="닫기" disabled={saving} onClick={close}>
        <img src={asset('printer-close')} alt="" /></button></header>
    {view && (editing ? <ProcessEditor key={editing.number} group={editing} view={view} blocked={blocked} busy={busy}
      close={close} save={steps => void change('processes', { number: editing.number, steps })} /> : <>
      <div className="eq-info"><strong>POP ID</strong>{terminal}</div>
      {machine ? <div className="eq-info"><strong>설정설비</strong>{machines.map(code => view.machines.find(m => m.code === code)?.name).join(', ') || 'NONE'}</div>
      : <div className="eq-group-tools"><span>POP ID : 해당 PC의 메인보드 고유 번호입니다.</span>
        <Tool icon="add" label="그룹 추가" disabled={blocked} action={() => void change('add')} />
        <Tool icon="remove" label="그룹 삭제" disabled={blocked || !focused} action={async () => {
          if (await prompt('POP 그룹을 정말 삭제하시겠습니까?', true)) void change('remove', { number: focused })
        }} /></div>}
      <div className="eq-grid"><table><thead><tr>{(machine ? ['사용', '순번', '설비코드', '설비명', '설비명2', 'POP ID']
        : ['시작', '종료', '그룹번호', '시작 POP ID', '종료 POP ID', '공정설정']).map(label => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{machine ? view.machines.map((m, i) => <tr key={m.code} aria-current={machineFocus === m.code} onClick={() => toggle(m.code)}>
          <td><input aria-label={m.name} type="checkbox" checked={machines.includes(m.code)} disabled={blocked}
            onClick={e => e.stopPropagation()} onChange={() => toggle(m.code)} /></td>
          <td>{i}</td><td>{m.code}</td><td>{m.name}</td><td>{m.description}</td><td>{m.owner}</td></tr>) :
          view.groups.map(g => <tr key={g.number} aria-current={focused === g.number} onClick={() => setFocused(g.number)}>
            {(['START', 'END'] as const).map(side => <td key={side}><input type="checkbox" disabled={blocked}
              aria-label={g.number + (side === 'START' ? ' 시작' : ' 종료')} checked={selected?.number === g.number && selected.side === side}
              onChange={e => setSelected(e.target.checked ? { number: g.number, side } : undefined)} /></td>)}
            <td>{g.number}</td><td>{g.start}</td><td>{g.end}</td><td><button type="button" disabled={busy}
              aria-label={g.number + ' 공정설정'} onClick={() => { setNotice(''); setEditing(g) }}>
              {g.steps.map((step, i) => <span key={step.process}>({i + 1}){view.processes.find(p => p.code === step.process)?.name}
                {' | '}{view.warehouses.find(w => w.code === step.warehouse)?.name}</span>)}</button></td></tr>)}</tbody></table></div>
      <footer><button type="button" disabled={blocked} onClick={save}>저장</button>
        <button type="button" disabled={saving} onClick={close}>{machine ? '취소' : '닫기'}</button></footer>
    </>)}
    {notice && <p role="status">{notice}</p>}
  </dialog>
}

function ProcessEditor({ group, view, blocked, busy, close, save }: { group: Group; view: View; blocked: boolean
  busy: boolean; close: () => void; save: (steps: Step[]) => void }) {
  const prompt = useSettingsPrompt()
  const [steps, setSteps] = useState(group.steps)
  const [candidate, setCandidate] = useState(view.processes[0]?.code ?? '')
  const [index, setIndex] = useState(0)
  function add(code: string) {
    if (!blocked && code && !steps.some(s => s.process === code)) setSteps([...steps, { process: code, warehouse: '' }])
  }
  function move(delta: number) {
    const next = [...steps]
    const [step] = next.splice(index, 1)
    next.splice(index + delta, 0, step)
    setSteps(next); setIndex(index + delta)
  }
  return <><div className="eq-process-body"><div className="eq-grid"><table><thead><tr><th>순번</th><th>공정코드</th><th>공정명</th></tr></thead>
    <tbody>{view.processes.map((item, i) => <tr key={item.code} aria-current={candidate === item.code} onClick={() => setCandidate(item.code)}
      onDoubleClick={() => add(item.code)}><td>{i + 1}</td><td>{item.code}</td><td><button type="button" onClick={() => setCandidate(item.code)}>{item.name}</button></td></tr>)}</tbody></table></div>
    <div className="eq-step-tools"><Tool icon="add" label="공정 추가" disabled={blocked} action={() => add(candidate)} />
      <Tool icon="remove" label="공정 삭제" disabled={blocked || !steps[index]} action={() => {
        setSteps(steps.filter((_, i) => i !== index)); setIndex(Math.max(0, Math.min(index, steps.length - 2)))
      }} /><Tool icon="up" label="위로" disabled={blocked || index < 1} action={() => move(-1)} />
      <Tool icon="down" label="아래로" disabled={blocked || index + 1 >= steps.length} action={() => move(1)} /></div>
    <div className="eq-grid"><table><thead><tr><th>순번</th><th>공정코드</th><th>공정명</th><th>창고명</th></tr></thead>
      <tbody>{steps.map((step, i) => <tr key={step.process} aria-current={index === i} onClick={() => setIndex(i)}>
        <td>{i + 1}</td><td>{step.process}</td><td>{view.processes.find(p => p.code === step.process)?.name}</td>
        <td><button type="button" aria-label={step.process + ' 창고명'} popoverTarget={'wh-' + step.process}
          disabled={blocked} onFocus={() => setIndex(i)}>{view.warehouses.find(w => w.code === step.warehouse)?.name} ▾</button>
          <div popover="auto" id={'wh-' + step.process} className="eq-wh" aria-label="창고 목록"><table><thead><tr><th>창고코드</th><th>창고명</th></tr></thead>
            <tbody>{view.warehouses.map(w => <tr key={w.code} onClick={() => {
              setSteps(steps.map((s, n) => n === i ? { ...s, warehouse: w.code } : s))
              document.getElementById('wh-' + step.process)?.hidePopover()
            }}><td>{w.code}</td><td><button type="button">{w.name}</button></td></tr>)}</tbody></table></div></td></tr>)}</tbody></table></div></div>
    <footer><button type="button" disabled={blocked} onClick={async () => {
      if (!steps.length) return prompt('공정을 추가 해주세요.')
      if (steps.some(s => !s.warehouse)) return prompt('창고 설정을 해주세요..')
      if (await prompt('공정 설정을 저장 하시겠습니까?', true)) save(steps)
    }}>저장</button><button type="button" disabled={busy} onClick={close}>취소</button></footer></>
}
