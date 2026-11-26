import '../pop-form-frame.css'
import { useEffect, useRef, useState } from 'react'
import CommonNumericPad from '../commonInput/CommonNumericPad'
import '../adminTouch.css'
import { SessionExpired } from '../workHistoryApi'
import { issueExpendables, loadExpendables, ManagementError, returnExpendables } from './managementApi'
import type { Actor, StockKey, SupplyScreen } from './managementApi'
import './Expendables.css'

const tabs = { catalog: '소모품 목록', held: '소모품 신청재고', recent: '최근 1개월 신청내역' } as const
type Tab = keyof typeof tabs
const filterLabels = { materialFlag: '품목분류', kind1: '대분류', kind2: '중분류' } as const
type Filter = keyof typeof filterLabels
const all = { materialFlag: '', kind1: '', kind2: '' }
type Row = { id: string; stock: StockKey; available: number; prior: string | null; movement?: string }
type Edit = { checked?: boolean; quantity?: number }
type Action = { kind: 'issue' | 'return'; body: string }
type Confirmation = { action?: Action; text: string }
const messages: Record<string, string> = {
  STALE_REVISION: '재고가 갱신되었습니다. 수량 확인 후 재신청 바랍니다.',
  STOCK_EXCEEDED: '선택한 수량의 합계가 현재 재고를 초과합니다.',
  RETURN_EXCEEDS_REMAINING: '반납 가능 수량이 변경되었습니다. 수량 확인 후 재신청 바랍니다.',
  RECENT_REQUEST_NOT_FOUND: '현재 작업장에서 재신청할 수 없는 품목입니다.',
}
function rows(data: SupplyScreen, tab: Tab): Row[] {
  if (tab === 'held') return data.held.map(row => ({ id: tab + row.movementId, prior: row.issue,
    movement: row.movementId, stock: row.stock, available: row.remaining }))
  if (tab === 'recent') return data.recent.map(row => ({ id: tab + JSON.stringify([row.request, row.stock]),
    prior: row.request, stock: row.stock, available: row.available }))
  return data.catalog.map(row => ({ id: tab + JSON.stringify(row.key), stock: row.key, available: row.available, prior: null }))
}

export default function Expendables({ actor, onSessionExpired }: { actor: Actor; onSessionExpired: () => void }) {
  const scope = JSON.stringify([actor.terminalId, actor.workerId])
  return <SupplyForm key={scope} scope={scope} onSessionExpired={onSessionExpired} />
}

function SupplyForm({ scope, onSessionExpired }: { scope: string; onSessionExpired: () => void }) {
  const [tab, setTab] = useState<Tab>('catalog')
  const [filter, setFilter] = useState(all)
  const [data, setData] = useState<SupplyScreen>()
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [quantityRow, setQuantityRow] = useState<Row>()
  const [picker, setPicker] = useState<Filter>('materialFlag')
  const lookup = useRef<HTMLDialogElement>(null)
  const confirmDialog = useRef<HTMLDialogElement>(null)
  const [confirm, setConfirm] = useState<Confirmation>()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const active = useRef<AbortController | null>(null)
  const issueKey = 'synthetic-expendables-retry:' + scope
  const returnKey = 'synthetic-expendables-return:' + scope
  function stored(): Action | undefined {
    try {
      const issue = sessionStorage.getItem(issueKey)
      if (issue) return { kind: 'issue', body: issue }
      const returned = sessionStorage.getItem(returnKey)
      if (returned) return { kind: 'return', body: returned }
    } catch { /* A write must succeed before submitting any movement. */ }
  }
  const [pending, setPending] = useState(stored)
  useEffect(() => {
    const req = new AbortController()
    loadExpendables(all, req.signal).then(result => { if (!req.signal.aborted) setData(result) })
      .catch(error => {
        if (req.signal.aborted) return
        if (error instanceof SessionExpired) onSessionExpired()
        else setNotice('소모품을 조회하지 못했습니다.')
      })
    return () => { req.abort(); active.current?.abort() }
  }, [onSessionExpired])
  useEffect(() => {
    if (confirm) confirmDialog.current?.showModal()
  }, [confirm])

  async function run(task: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return
    const req = new AbortController()
    active.current = req
    setBusy(true)
    setNotice('')
    try { await task(req.signal) } catch (error) {
      if (req.signal.aborted) return
      if (error instanceof SessionExpired) onSessionExpired()
      else if (error instanceof ManagementError) setNotice(messages[error.message] ?? '요청을 처리하지 못했습니다.')
      else setNotice('서버 응답을 확인하지 못했습니다.')
    } finally {
      active.current = null
      if (!req.signal.aborted) setBusy(false)
    }
  }
  async function reload(signal: AbortSignal, nextFilter = filter, reset: Tab[] = ['catalog', 'recent', 'held']) {
    const snapshot = await loadExpendables(nextFilter, signal)
    if (signal.aborted) return
    setData(snapshot)
    setFilter(nextFilter)
    setEdits(prev => snapshot.revision !== data?.revision ? {} :
      Object.fromEntries(Object.entries(prev).filter(([id]) => !reset.some(which => id.startsWith(which)))))
  }
  function send(action: Action) {
    void run(async signal => {
      const key = action.kind === 'issue' ? issueKey : returnKey
      function finish() {
        if (sessionStorage.getItem(key) === action.body) sessionStorage.removeItem(key)
        setPending(stored())
      }
      try { sessionStorage.setItem(key, action.body) } catch { setNotice('요청을 보존할 수 없습니다.'); return }
      setPending(action)
      try {
        if (action.kind === 'issue') await issueExpendables(action.body, signal)
        else await returnExpendables(action.body, signal)
      } catch (error) {
        if (signal.aborted) return
        if (error instanceof ManagementError && error.status < 500 && error.status !== 408 && error.status !== 429) {
          finish()
          if (error.status === 409) await reload(signal)
        }
        throw error
      }
      if (signal.aborted) return
      finish()
      setData(undefined)
      await reload(signal)
      if (!signal.aborted) setNotice(action.kind === 'issue' ? '소모품 출고 신청 되었습니다.' : '소모품이 반납 되었습니다.')
    })
  }
  function edit(id: string, change: Edit) {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], ...change } }))
  }
  function openIssue() {
    if (!data) return
    const selected = [...rows(data, 'catalog'), ...rows(data, 'recent')].filter(row => edits[row.id]?.checked)
    if (!selected.length) { setNotice('소모품 품목을 선택 해주세요.'); return }
    const lines = selected.filter(row => edits[row.id].quantity).map(row => ({
      origin: row.prior ? 'RECENT' : 'CATALOG', priorRequest: row.prior, stock: row.stock, quantity: edits[row.id].quantity,
    }))
    setConfirm({ text: '선택한 소모품을 출고 하시겠습니까?', action: lines.length ? { kind: 'issue',
      body: JSON.stringify({ requestId: crypto.randomUUID(), expectedRevision: data.revision, lines }) } : undefined })
  }

  const locked = busy || !!pending || !!confirm
  const masters = data?.masters
  const middle = masters && (filter.kind1 ? masters.kind2[filter.kind1] : Object.assign({}, ...Object.values(masters.kind2)))
  const options: Record<Filter, Record<string, string>> = { materialFlag: masters?.materialFlags ?? {}, kind1: masters?.kind1 ?? {}, kind2: middle ?? {} }
  const returnTab = tab === 'held'
  const shown = data ? rows(data, tab) : []

  return <section className="supplies-form" aria-label="소모품">
    <div className="supplies-filters">
      {(Object.keys(filterLabels) as Filter[]).map(key => <div key={key}>
        <span>{filterLabels[key]}</span><button type="button" aria-label={filterLabels[key] + ' 선택'} disabled={locked || !data}
          onClick={() => { setPicker(key); lookup.current?.showModal() }}>{options[key][filter[key]] ?? '전체'} <span aria-hidden="true">⌕</span></button>
      </div>)}
      <button type="button" className="supplies-out" disabled={locked || !data} onClick={openIssue}>소모품<br />출고</button>
    </div>
    <div role="tablist" aria-label="소모품 업무" className="supplies-tabs">
      {(Object.entries(tabs) as [Tab, string][]).map(([key, name]) =>
        <button role="tab" key={key} id={'supply-tab-' + key} aria-selected={tab === key} disabled={locked || !data}
          onClick={() => { if (tab !== key || !data) void run(async signal => {
            await reload(signal, filter, [key]); if (!signal.aborted) setTab(key)
          }) }}>{name}</button>)}
    </div>
    <div role="tabpanel" aria-labelledby={'supply-tab-' + tab} className="supplies-grid">
      <table><colgroup>{(returnTab ? [230,180,157,157,94,52,94,52,78] : [80,220,172,178,150,150,90,50,90,50]).map((w,i)=><col key={i} style={{width: (w / (returnTab ? 1094 : 1230) * 100) + '%'}}/>)}</colgroup><thead>{returnTab ? <tr>
        {['품목명','규격','LOT','PART_NO','현재고','-','반납수량','+','반납'].map(h => <th key={h}>{h}</th>)}
      </tr> : <>
        <tr><th rowSpan={2}>선택</th><th rowSpan={2}>품목명</th><th>규격</th><th>창고</th>
          {['LOT','PART_NO','현재고','-','출고수량','+'].map(h => <th rowSpan={2} key={h}>{h}</th>)}</tr>
        <tr><th>재질</th><th>LOCATION</th></tr>
      </>}</thead>
      <tbody>{shown.map(row => {
        const item = data?.items[row.stock.item]
        const name = item?.name ?? row.stock.item
        const quantity = edits[row.id]?.quantity ?? 0
        const quantityLabel = returnTab ? '반납수량' : '출고수량'
        return <tr key={row.id}>
          {!returnTab && <td><input type="checkbox" aria-label={name + ' 선택'} disabled={locked}
            checked={!!edits[row.id]?.checked} onChange={e => edit(row.id, { checked: e.target.checked })} /></td>}
          <th scope="row">{name}</th><td>{item?.specification}{!returnTab && <span>{item?.quality}</span>}</td>
          {!returnTab && <td>{row.stock.warehouse}<span>{row.stock.location}</span></td>}
          <td>{row.stock.lot}</td><td>{item?.partNumber}</td><td>{row.available}</td>
          <td><button aria-label={name + ' 수량 감소'} disabled={locked || quantity <= 0} onClick={() => edit(row.id, { quantity: quantity - 1 })}>−</button></td>
          <td><input readOnly aria-label={name + ' ' + quantityLabel} disabled={locked} value={quantity}
            onClick={event => { event.currentTarget.focus(); setQuantityRow(row) }} onKeyDown={event => {
              if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); setQuantityRow(row) }
            }} /></td>
          <td><button aria-label={name + ' 수량 증가'} disabled={locked || quantity >= row.available} onClick={() => edit(row.id, { quantity: quantity + 1 })}>+</button></td>
          {returnTab && <td><button disabled={locked || !quantity} onClick={() => {
            if (data) setConfirm({ text: name + ' ' + quantity + '개\n반납 하시겠습니까?', action: { kind: 'return', body: JSON.stringify({
              requestId: crypto.randomUUID(), expectedRevision: data.revision, lines: [{ issue: row.prior, movementId: row.movement, quantity }],
            }) } })
          }}>반납</button></td>}
        </tr>
      })}</tbody></table>
    </div>
    {quantityRow && <CommonNumericPad mode="integer" onCancel={() => setQuantityRow(undefined)}
      onApply={value => {
        if (!locked) edit(quantityRow.id, { quantity: Math.min(Number(value), quantityRow.available) })
        setQuantityRow(undefined)
      }} />}
    {pending && <button disabled={busy} onClick={() => send(pending)}>동일 {pending.kind === 'issue' ? '출고' : '반납'} 요청 재시도</button>}
    {!data && !busy && notice && <button onClick={() => void run(signal => reload(signal))}>다시 조회</button>}
    <p role="status">{busy ? '처리 중입니다.' : notice}</p>
    <dialog ref={lookup} aria-label={filterLabels[picker] + ' 조회'} className="supplies-lookup">
      <table><thead><tr><th>{picker === 'materialFlag' ? '품목코드' : '분류코드'}</th><th>{picker === 'materialFlag' ? '품목 분류명' : '분류명'}</th></tr></thead>
        <tbody>{[['','전체'], ...Object.entries(options[picker])].map(([value, label]) => <tr key={value}>
          <td>{value || (picker === 'materialFlag' ? '0000000' : '000')}</td><td><button onClick={() => {
            lookup.current?.close()
            const next = { ...filter, [picker]: value }
            if (picker === 'kind1') next.kind2 = ''
            void run(signal => reload(signal, next, ['catalog']))
          }}>{label}</button></td></tr>)}</tbody></table>
      <button onClick={() => lookup.current?.close()}>닫기</button>
    </dialog>
    <dialog ref={confirmDialog} aria-label="소모품 처리 확인" onClose={() => setConfirm(undefined)}>
      <p>{confirm?.text}</p><button onClick={() => {
        confirmDialog.current?.close()
        if (confirm?.action) send(confirm.action)
        else void run(async signal => { await reload(signal); if (!signal.aborted) setNotice('소모품 출고 신청 되었습니다.') })
      }}>예</button> <button onClick={() => confirmDialog.current?.close()}>아니오</button>
    </dialog>
  </section>
}
