import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

export type GridRecord = { key: string; fields: Record<string, ReactNode>; focus?: () => void; selected?: boolean }
type Props = { columns: (string | number)[][]; rows: GridRecord[]; title: string; style: CSSProperties }

export default function TransferGrid({ columns, rows, title, style }: Props) {
  const [focus,setFocus]=useState('')
  const focused=rows.find(r=>r.key===focus)?.key??rows[0]?.key
  const top = columns.filter(column => column[2] === 0)
  const widths = top.map(column => column[3] + 'px').join(' ')
  function cells(record?: GridRecord) {
    let columnIndex = 0
    return columns.map(([label, field, level, , span], index) => {
      if (!level) columnIndex++
      const header = !record
      return <div key={index} role={header ? 'columnheader' : 'cell'} style={{
        gridColumn: columnIndex, gridRow: (Number(level) + 1) + ' / span ' + span,
      }}>{header ? label : record.fields[field || label]}</div>
    })
  }
  return <div role="table" aria-label={title} className="transfer-grid" style={style}>
    <div className="transfer-grid-head" role="row" style={{ gridTemplateColumns: widths }}>{cells()}</div>
    <div className="transfer-grid-body">{rows.map(row =>
      <div className="transfer-grid-row" role="row" key={row.key} aria-selected={row.selected ?? focused===row.key}
        style={{ gridTemplateColumns: widths }} tabIndex={row.focus ? 0 : undefined}
        onFocus={()=>{setFocus(row.key);row.focus?.()}} onClick={()=>{setFocus(row.key);row.focus?.()}}
        onKeyDown={e => { if (e.target === e.currentTarget && e.key === 'Enter') row.focus?.() }}>
        {cells(row)}
      </div>)}</div>
  </div>
}
