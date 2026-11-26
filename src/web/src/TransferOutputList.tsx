import { useLayoutEffect, useRef } from 'react'
import type { OutputList } from './transferApi'
import './transferOutputList.css'

const amount = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 })
const rowWeights = ['0.72258fr', '3.48431fr', '1.80375fr', '4.96872fr', '1.92786fr', '4.90721fr'].join(' ')

function issuedTime(value: string) {
  const [date, time] = value.split('T')
  const [year, month, day] = date.split('-')
  return `${year}-${Number(month)}-${Number(day)} ${time.slice(0, 5)}`
}

export default function TransferOutputList({ report, onClose }: { report: OutputList; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => { dialog.current?.showModal() }, [])
  // rptOutputList lengths are hundredths of an inch. Reserve the non-repeating group footer on the last page.
  const available = 1169 - 25.62501 - 69.46878 - 170.561 - 0.9455045
  const perPage = Math.floor(available / 35)
  // The native footer table starts at y=0 and prints at its 30.20835-unit height.
  const footer = 30.20835
  const pages = report.groups.flatMap(group => {
    const chunks = []
    for (let i = 0; i < group.rows.length; i += perPage) chunks.push(group.rows.slice(i, i + perPage))
    if (chunks.length && chunks[chunks.length - 1].length * 35 + footer > available) chunks.push([])
    return chunks.map((rows, idx) => ({ group, rows, last: idx === chunks.length - 1 }))
  })
  return <dialog ref={dialog} className="transfer-output-dialog" aria-label="출고요청 리스트 미리보기" onClose={onClose}>
    <form method="dialog"><button type="submit" autoFocus aria-label="미리보기 닫기">닫기</button></form>
    {pages.map(({ group, rows, last }, i) =>
      <article className="transfer-output-page" key={i} aria-label={`${group.request} · ${i + 1}페이지`}>
        <h2>출고요청 리스트</h2>
        <div className="report-row report-note"><span>헤더비고</span><span>{group.headerRemark}</span></div>
        <div className="report-row report-meta"><span>발행일자</span><time>{issuedTime(report.issuedAt)}</time>
          <span>입고공장</span><span>{group.receivingPlant}</span><span>부서</span><span>{group.department}</span></div>
        <div className="report-row report-columns">{['NO', '요청번호', '요청일', '규격', '요청수량', '비고'].map(title =>
          <span key={title}>{title}</span>)}</div>
        {rows.map(row => <div className="report-row report-detail" style={{ gridTemplateColumns: rowWeights }} key={row.number}>
          <span>{row.number}</span><span>{group.request}</span><span>{group.requestDate.slice(2)}</span>
          <span>{row.specification}</span><span>{amount.format(row.quantity)}</span><span>{row.remark}</span></div>)}
        {last && <div className="report-row report-total"><span /><span>합계</span><span>{amount.format(group.total)}</span><span /></div>}
        <small>{i + 1} / {pages.length}</small>
      </article>)}
  </dialog>
}
