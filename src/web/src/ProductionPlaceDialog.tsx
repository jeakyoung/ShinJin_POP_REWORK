import { useState } from 'react'
import { InventoryDialog, InventoryMessage } from './InventoryDialogs'

export type PlaceOption = { code:string; name:string }
export type PlaceWarehouse = PlaceOption & { locations:PlaceOption[] }
type Props = {
  warehouseLabel:string
  locationLabel:string
  initial:{warehouse:string;location:string}
  warehouses:PlaceWarehouse[]
  retainOpeningLocation?:boolean
  onClose:()=>void
  onApply:(warehouse:string,location:string)=>void
}

export default function ProductionPlaceDialog({warehouseLabel,locationLabel,initial,warehouses,retainOpeningLocation=false,onClose,onApply}:Props) {
  const [warehouse, setWarehouse] = useState(initial.warehouse),
    [location, setLocation] = useState(initial.location)
  const [list, setList] = useState<'warehouse' | 'location'>(),
    [confirm, setConfirm] = useState(false),
    [error, setError] = useState('')
  const wh = warehouses.find((w) => w.code === warehouse),
    loc = wh?.locations.find((l) => l.code === location)
  const choices = list === 'warehouse' ? warehouses : (wh?.locations ?? [])
  function select(code: string) {
    if (list === 'warehouse') {
      setWarehouse(code)
      const next = warehouses.find((w) => w.code === code)
      setLocation(retainOpeningLocation || next?.locations.some((l) => l.code === initial.location) ? initial.location : '')
    } else setLocation(code)
    setList(undefined)
  }
  return (
    <InventoryDialog
      label={warehouseLabel + ' 및 로케이션'}
      className="group5-place"
      onDismiss={list ? () => setList(undefined) : onClose}
    >
      <span>{warehouseLabel}</span>
      <span>{locationLabel}</span>
      <button aria-label={warehouseLabel + ' 조회'} onClick={() => setList('warehouse')}>
        {wh?.name}
        <i aria-hidden="true" />
      </button>
      <button aria-label={locationLabel + ' 조회'} onClick={() => setList('location')}>
        {loc?.name}
        <i aria-hidden="true" />
      </button>
      <button
        onClick={() =>
          !wh
            ? setError('창고를 입력하십시오.')
            : !(retainOpeningLocation ? location : loc)
              ? setError('로케이션을 입력하십시오.')
              : setConfirm(true)
        }
      >
        적용
      </button>
      <button onClick={onClose}>취소</button>
      {list && (
        <div
          className={'group5-options ' + list}
          role="listbox"
          aria-label={list === 'warehouse' ? '창고 목록' : '로케이션 목록'}
        >
          <header>{list === 'warehouse' ? '창고코드　　창고명' : '로케이션코드　　로케이션명'}</header>
          {choices.map((o) => (
            <button
              key={o.code}
              role="option"
              aria-selected={o.code === (list === 'warehouse' ? warehouse : location)}
              onClick={() => select(o.code)}
            >
              <span>{o.code}</span>
              {o.name}
            </button>
          ))}
        </div>
      )}
      {confirm && (
        <InventoryMessage
          text="창고 및 로케이션 정보를 적용하시겠습니까?"
          onClose={() => setConfirm(false)}
          onYes={() => onApply(warehouse, location)}
        />
      )}
      {error && <InventoryMessage text={error} onClose={() => setError('')} />}
    </InventoryDialog>
  )
}

