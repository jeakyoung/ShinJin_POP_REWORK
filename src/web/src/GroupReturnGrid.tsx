import { useState } from 'react'
import ProductionPlaceDialog from './ProductionPlaceDialog'
import { InventoryMessage, InventoryPad } from './InventoryDialogs'

import type { Field, Material, ReturnRow } from './groupReturn'
import { labels } from './groupReturn'

type Props = {
  rows: ReturnRow[]
  material: Material | null
  enabled: boolean
  hasInput: boolean
  busy: boolean
  change: (rows: ReturnRow[]) => void
  remove: (ids: string[]) => Promise<boolean>
}
export default function GroupReturnGrid({ rows, material, enabled, hasInput, busy, change, remove }: Props) {
  const [focusId, setFocusId] = useState<string>()
  const [checked, setChecked] = useState<string[]>([]),
    [error, setError] = useState(''),
    [deleting, setDeleting] = useState(false)
  const [edit, setEdit] = useState<{ id: string; field: Field | 'place' }>()
  const row = rows.find((r) => r.id === edit?.id)
  const selected = rows.filter((r) => checked.includes(r.id))
  function add() {
    if (!hasInput) return setError('투입자재가 없습니다. 자재 투입 후 진행하십시오.')
    if (!material) return setError('재질을 확인하십시오.')
    if (!material.warehouses.length) return setError('반납창고가 설정되지 않았습니다.')
    const added = material.defaults.map((d) => ({
      ...d,
      id: crypto.randomUUID(),
      thickness: material.thickness,
      width: material.width,
      length: 0,
      quantity: 1,
      item: null,
    }))
    if (added.length) setFocusId(added[added.length-1].id)
    change([...rows, ...added])
    setChecked([...checked, ...added.map((r) => r.id)])
  }
  function update(next: ReturnRow) {
    change(rows.map((r) => (r.id === next.id ? next : r)))
    setEdit(undefined)
  }
  function lookup(next: ReturnRow) {
    const hit = material?.matches
      .filter(
        (m) =>
          m.warehouse === next.warehouse &&
          m.thickness === next.thickness &&
          m.width === next.width &&
          m.length === next.length,
      )
      .at(-1)
    update(hit ? { ...next, item: hit.item } : next)
  }
  function askDelete() {
    if (!rows.length) return setError('반납 자재 정보를 확인하십시오.')
    if (!selected.length) return setError('삭제할 반납자재를 선택하십시오.')
    if (selected.some((r) => material?.warehouses.find((w) => w.code === r.warehouse)?.scrap))
      return setError('산철, 분철은 삭제할 수 없습니다.')
    setDeleting(true)
  }
  return (
    <div className="group5-material returns">
      <header>
        <strong>반납자재</strong>
        <button disabled aria-label="반납자재 라벨출력" className="material-label" />
        <button aria-label="반납자재 추가" disabled={!enabled || busy} onClick={add}>
          ＋
        </button>
        <button aria-label="반납자재 삭제" disabled={!enabled || busy} onClick={askDelete}>
          －
        </button>
      </header>
      <div className="group5-return-rows"><table aria-label="반납자재">
        <colgroup>
          {[50, 140, 130, 70, 60, 60, 60, 70].map((n, i) => (
            <col key={i} style={{ width: n }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {['선택', '창고', '로케이션', '재질', '두께', '폭', '길이', '반납수량'].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const wh = material?.warehouses.find((w) => w.code === r.warehouse),
              prefix = i + 1 + '행 '
            const locked = busy || !enabled || !material?.warehouses.length
            function cell(label: string, value: string | number, field: Field | 'place', disabled: boolean) {
              return (
                <td key={label}>
                  <button
                    aria-label={prefix + label}
                    disabled={disabled}
                    onClick={() => setEdit({ id: r.id, field })}
                  >
                    {value}
                  </button>
                </td>
              )
            }
            return (
              <tr key={r.id} data-focused={r.id === (rows.some(row => row.id === focusId) ? focusId : rows[0]?.id)} onClick={() => setFocusId(r.id)}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={prefix + '반납 선택'}
                    disabled={locked}
                    checked={checked.includes(r.id)}
                    onChange={(e) =>
                      setChecked(e.target.checked ? [...checked, r.id] : checked.filter((id) => id !== r.id))
                    }
                  />
                </td>
                {cell('창고', wh?.name ?? '', 'place', locked || !!wh?.scrap)}
                {cell(
                  '로케이션',
                  wh?.locations.find((l) => l.code === r.location)?.name ?? '',
                  'place',
                  locked || !!wh?.scrap,
                )}
                <td>{material?.returnGrade}</td>
                {(Object.keys(labels) as Field[]).map((k) =>
                  cell(labels[k], r[k], k, locked || (k !== 'quantity' && !!wh?.scrap)),
                )}
              </tr>
            )
          })}
        </tbody>
      </table></div>
      {row && edit?.field === 'place' && material && (
        <ProductionPlaceDialog retainOpeningLocation
          warehouseLabel="반납창고" locationLabel="반납 로케이션" initial={row}
          warehouses={material.warehouses}
          onClose={() => setEdit(undefined)}
          onApply={(warehouse, location) => update({ ...row, warehouse, location, length: 0, item: null })}
        />
      )}
      {row && edit && edit.field !== 'place' && (
        <div className={'group5-pad ' + (edit.field === 'quantity' ? 'count' : 'dimension')}>
          <InventoryPad
            label={labels[edit.field]}
            decimal={edit.field !== 'quantity'}
            onClose={() => {
              if (edit.field === 'quantity') setEdit(undefined)
              else lookup(row)
            }}
            onApply={(n) => {
              const next = { ...row, [edit.field]: n }
              if (edit.field === 'quantity') update(next)
              else lookup(next)
            }}
          />
        </div>
      )}
      {error && <InventoryMessage text={error} onClose={() => setError('')} />}
      {deleting && (
        <InventoryMessage
          text="선택한 반납자재를 삭제하시겠습니까?"
          onClose={() => setDeleting(false)}
          onYes={async () => {
            setDeleting(false)
            if (await remove(selected.map((r) => r.id))) setChecked([])
          }}
        />
      )}
    </div>
  )
}
