import type { ReactNode } from 'react'
import type { ShippingFormRow } from './shippingApi'

const upperWidths = [50,50,104,132,272,105,87,86,89,86,86,90,96]
const lowerWidths = [50,50,75,105,240,100,87,87,87,131,131,87,87,88]
export function ShippingGrid({ lower, rows, checked, trouble, toggle, all }: {
  lower?: boolean; rows: ShippingFormRow[]; checked: string[]; trouble: string[]
  toggle: (row: ShippingFormRow) => void; all: () => void
}) {
  const widths = lower ? lowerWidths : upperWidths
  const two = (top: ReactNode, bottom: ReactNode) => <td className="ship-banded"><div>{top}</div><div>{bottom}</div></td>
  return <div className={'ship-grid ' + (lower ? 'ship-lower' : 'ship-upper')} role="region" aria-label={lower ? '출하 내역' : '포장 내역'}>
    <table style={{width: widths.reduce((total,n) => total+n,0)}}><colgroup>{widths.map((width,i) => <col key={i} style={{width}} />)}</colgroup>
      <thead><tr><th rowSpan={2}>No</th><th rowSpan={2}><button onClick={all}>선택</button></th>
        <th rowSpan={2}>포장일</th><th rowSpan={2}>{lower ? '출하번호' : '포장번호'}</th>
        <th>거래처</th><th>품목 유형</th><th rowSpan={2}>두께</th><th rowSpan={2}>폭</th><th rowSpan={2}>길이</th>
        {lower && <><th>출고 창고</th><th rowSpan={2}>Lot No</th></>}<th colSpan={3}>수주 수량</th>
        {!lower && <th rowSpan={2}>수주담당자</th>}
      </tr><tr><th>수주번호</th><th>재질</th>{lower && <th>Location</th>}
        {(lower ? ['재고 수량', '기 출하 수량', '출하 수량'] : ['기 출하 수량', '포장 수량', '재고 수량']).map(t => <th key={t} title={t}>{t}</th>)}
      </tr></thead>
      <tbody>{rows.map(({snapshot, info}, i) => <tr key={snapshot.handoff.id} aria-selected={checked.includes(snapshot.handoff.id)}
        className={trouble.includes(snapshot.handoff.id) ? 'ship-error-row' : ''} onClick={() => toggle(rows[i])}>
        <td>{i + 1}</td><td><input type="checkbox" checked={checked.includes(snapshot.handoff.id)} readOnly aria-label={(lower ? '출하 ' : '포장 ') + info.packingNumber + ' 선택'} /></td>
        <td>{info.packingDate}</td><td>{lower ? snapshot.shipment?.number : info.packingNumber}</td>
        {two(info.customer,info.order)}{two(info.itemKind, info.material)}<td>{info.thickness}</td><td>{info.width}</td><td>{info.length}</td>
        {lower && <>{two(info.warehouse, info.location)}<td>{snapshot.handoff.lot}</td></>}
        <td className="ship-qty" colSpan={3}><div>{info.orderQty}</div><div>{(lower ? [info.stock,info.previous,snapshot.handoff.quantity] :
          [info.previous,snapshot.handoff.quantity,info.stock]).map((v,j) => <span key={j}>{v}</span>)}</div></td>
        {!lower && <td>{info.orderWorker}</td>}
      </tr>)}</tbody></table>
  </div>
}
