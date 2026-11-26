import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Modal } from './Modal'
import { assets } from './contract'
import type { Report, Request } from './contract'
import EmployeePreview from './EmployeePreview'
import './employeePrint.css'

const api = '/api/demo/employee-print'

type Choice = { code: string; name: string }
type Employee = { plant: string; no: number; department: string; departmentName: string; id: string; name: string; checked: boolean }
type Listing = { departments: Choice[]; employees: Employee[] }
type Grant = { entry: string; plants: Choice[] }
function Lookup({ label, codeTitle, options, value, opened, toggle, select }: {
  label: string; codeTitle: string; options: Choice[]; value: string; opened: boolean; toggle: () => void; select: (code: string) => void
}) {
  return <div className="employee-lookup">
    <span>{label}</span><button aria-label={label + ' 선택'} aria-expanded={opened} onClick={toggle}>{options.find(o => o.code === value)?.name}<img src={assets + 'lookup.png'} alt="" /></button>
    {opened && <div className="employee-choices" onKeyDown={e => { if (e.key === 'Escape') toggle() }}>
      <div><strong>{codeTitle}</strong><strong>{label}</strong></div>
      {options.map(o => <button key={o.code} onClick={() => select(o.code)}><span>{o.code}</span><span>{o.name}</span></button>)}
    </div>}
  </div>
}

export default function EmployeePrint({ onEnter, onExit, onSessionExpired }: { onEnter: () => void; onExit: () => void; onSessionExpired: () => void }) {
  const [grant, setGrant] = useState<Grant>()
  const token = useRef('')
  const life = useRef<AbortController | null>(null)
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const password = useRef<HTMLInputElement>(null)
  const [plant, setPlant] = useState('')
  const [focused, setFocused] = useState('')
  const [department, setDepartment] = useState('')
  const [listing, setListing] = useState<Listing>({ departments: [], employees: [] })
  const [lookup, setLookup] = useState('')
  const [checked, setChecked] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [report, setReport] = useState<Report>()
  useEffect(() => {
    life.current = new AbortController()
    return () => {
      life.current?.abort()
      if (token.current) void fetch(api + '/entry', { method: 'DELETE', headers: { 'X-Employee-Entry': token.current }, keepalive: true }).catch(() => {})
      token.current = ''
    }
  }, [])

  const request = useCallback<Request>(async (path, method = 'GET', body) => {
    const signal = life.current!.signal
    const res = await fetch(api + path, { method, signal, cache: 'no-store',
      headers: { 'X-Employee-Entry': token.current, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body) })
    if (!signal.aborted && res.status === 401) onSessionExpired()
    if (!res.ok) throw new Error(String(res.status))
    return res
  }, [onSessionExpired])
  async function action(fn: () => Promise<void>, message: string) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    try { await fn() } catch (e) {
      if (!life.current?.signal.aborted && (e as Error).message !== '401') setNotice(message)
    } finally { lock.current = false; if (!life.current?.signal.aborted) setBusy(false) }
  }
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => { setNotice(''); password.current?.focus() }, 2000)
    return () => window.clearTimeout(timer)
  }, [notice])
  function authenticate(e: FormEvent) {
    e.preventDefault()
    const field = password.current!
    void action(async () => {
      const value = field.value
      field.value = ''
      try {
        const access: Grant = await (await request('/entry', 'POST', { password: value })).json()
        if (life.current?.signal.aborted) return
        token.current = access.entry
        setGrant(access)
        onEnter()
      } catch (error) {
        if ((error as Error).message !== '403') throw error
        setNotice('비밀번호를 다시 입력하십시오.')
      }
    }, '추가 인증을 완료하지 못했습니다.')
  }
  function load(p: string, d: string) {
    setLookup('')
    setPlant(p); setDepartment(d); setChecked([])
    setListing(old => ({ departments: d ? old.departments : [], employees: [] }))
    void action(async () => {
      const data: Listing = await (await request('/employees?' + new URLSearchParams({ plant: p, department: d }))).json()
      setListing(data)
      setFocused(data.employees[0]?.id ?? '')
      setChecked(data.employees.filter(e => e.checked).map(e => e.id))
    }, 'DEPARTMENT_LIST ERROR 01')
  }
  function preview(form: 'QR' | 'BARCODE') {
    setLookup('')
    if (!checked.length) { setNotice('출력 할 항목을 선택 해주세요.'); return }
    void action(async () => setReport(await (await request('/preview', 'POST', { plant, department, ids: checked, form })).json()), '미리보기를 열지 못했습니다.')
  }
  function toggle(id: string) { setFocused(id); setChecked(old => old.includes(id) ? old.filter(i => i !== id) : [...old, id]) }
  function closeNotice() { setNotice(''); if (!grant) password.current?.focus() }
  return <>
    {!grant && <Modal className="employee-password" label="사용제한" onClose={onExit}>
      <form onSubmit={authenticate}>
        <header><img src={assets + 'password.png'} alt="" /><b>사용제한</b><button type="button" aria-label="닫기" onClick={onExit}><img src={assets + 'close.png'} alt="" /></button></header>
        <label>비밀번호 입력<input ref={password} type="password" autoComplete="off" autoFocus /></label>
        <footer><button disabled={busy}>확인</button><button type="button" onClick={onExit}>닫기</button></footer>
      </form>
    </Modal>}
    {grant && <section className="employee-form" aria-label="사원번호 출력">
      <fieldset disabled={busy}><Lookup label="사업장" codeTitle="사업장 코드" value={plant} options={grant.plants}
        opened={lookup === 'plant'} toggle={() => setLookup(lookup === 'plant' ? '' : 'plant')} select={p => load(p, '')} />
        <Lookup label="부서" codeTitle="부서코드" value={department} options={listing.departments}
          opened={lookup === 'department'} toggle={() => setLookup(lookup === 'department' ? '' : 'department')} select={d => load(plant, d)} />
        <button onClick={() => preview('QR')}>QR</button><button onClick={() => preview('BARCODE')}>바코드</button>
      </fieldset>
      <div className="employee-list"><table><thead><tr><th><button aria-label="선택 전체" onClick={() => setChecked(checked.length === listing.employees.length ? [] : listing.employees.map(e => e.id))}>선택</button></th>
        {['순번','사업장','부서코드','부서명','사원번호','사원명'].map(v => <th key={v}>{v}</th>)}</tr></thead>
        <tbody>{listing.employees.map(e => <tr key={e.id} data-focused={focused === e.id} onClick={() => toggle(e.id)}>
          <td><input type="checkbox" aria-label={e.name + ' 선택'} checked={checked.includes(e.id)} onClick={ev => ev.stopPropagation()} onChange={() => toggle(e.id)} /></td>
          <td>{e.no}</td><td>{grant.plants.find(p => p.code === e.plant)?.name}</td><td>{e.department}</td><td>{e.departmentName}</td><td>{e.id}</td><td>{e.name}</td>
        </tr>)}</tbody></table></div>
    </section>}
    {report && <EmployeePreview key={report.id} report={report} request={request} onClose={() => {
      void request('/preview/' + report.id, 'DELETE').catch(() => {}); setReport(undefined)
    }} />}
    {notice && <Modal className="employee-message" label="알림" onClose={closeNotice}><p>{notice}</p><button onClick={closeNotice}>확인</button></Modal>}
  </>
}
