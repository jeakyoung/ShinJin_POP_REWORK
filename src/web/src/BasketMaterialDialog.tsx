import { useEffect, useRef, useState } from 'react'
import { BasketApiError, loadBasketGroup } from './basketApi'
import type { BasketProcess, ClearMaterialAction, GroupDetail, Lot } from './basketApi'
import './BasketMaterialDialog.css'

type Props = {
  process?:BasketProcess
  groupId: string
  canWrite: boolean
  locked: boolean
  message: string
  onClose: () => void
  onClear: (action: ClearMaterialAction, revision: number) => void
  onSessionExpired: () => void
}

function sameLot(a: Lot, b: Lot) {
  return a.item === b.item && a.lot === b.lot && a.warehouse === b.warehouse && a.position === b.position
}

export default function BasketMaterialDialog({ process,groupId, canWrite, locked, message, onClose, onClear, onSessionExpired }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const prompt = useRef<HTMLDialogElement>(null)
  const [tab, setTab] = useState<'issues' | 'returns'>('issues')
  const [detail, setDetail] = useState<GroupDetail>()
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<number>()
  const [question, setQuestion] = useState<'confirm' | 'empty'>('empty')
  const title = tab === 'issues' ? '투입자재' : '반납자재'

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  useEffect(() => {
    let active = true
    void loadBasketGroup(groupId,process).then(data => {
      if (active) setDetail(data)
    }).catch((err: unknown) => {
      if (!active) return
      if (err instanceof BasketApiError && err.status === 401) onSessionExpired()
      else setError('장바구니 자재를 조회할 수 없습니다.')
    })
    return () => { active = false }
  }, [process,groupId, tab, onSessionExpired])

  const rows = detail?.group[tab] ?? []
  return <dialog className="basket-material" aria-label="장바구니 자재" ref={dialog} onCancel={event => {
    event.preventDefault()
    if (!locked) onClose()
  }}>
    <div className="basket-tabs" role="tablist" aria-label="자재 구분">
      {(['issues', 'returns'] as const).map(key => <button type="button" role="tab" key={key}
        aria-selected={key === tab} disabled={locked} onClick={() => {
          if (key === tab) return
          setDetail(undefined)
          setError('')
          setSelected(undefined)
          setTab(key)
        }}>{key === 'issues' ? '투입자재' : '반납자재'}</button>)}
    </div>
    <button type="button" className="basket-reset" disabled={!detail || !canWrite || locked} onClick={() => {
      setQuestion(rows.length ? 'confirm' : 'empty')
      prompt.current?.showModal()
    }}>초기화</button>
    <div className="basket-lines" role="tabpanel" aria-label={title}>
      {(error || message) && <p role="alert">{error || message}</p>}
      <table><thead><tr>{['창고명','로케이션명','재질명','두께','폭','길이','담은수량'].map(label => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => {
          const lot = detail?.materials.find(entry => sameLot(entry.lot,row.lot))?.display
            ??detail?.displayLots.find(entry => sameLot(entry.lot, row.lot))
          const length = 'length' in row ? Number(row.length) : lot?.length
          return <tr key={index} className={selected === index ? 'basket-selected' : undefined} onClick={() => setSelected(index)}>
            <td>{lot?.warehouseName}</td><td>{lot?.locationName}</td><td>{lot?.qualityName}</td>
            <td>{lot?.thickness}</td><td>{lot?.width}</td><td>{length}</td><td>{row.quantity}</td>
          </tr>
        })}</tbody></table>
    </div>
    <button type="button" className="basket-close" disabled={locked} onClick={onClose}>닫기</button>
    <dialog ref={prompt} className="floor-confirm" aria-label="자재 초기화 확인"
      onCancel={event => event.stopPropagation()}>
      <p>{question === 'confirm' ? '담긴 ' + title + '를 일괄 삭제 하시겠습니까?' : title + ' 리스트가 없습니다.'}</p>
      {question === 'confirm' && <button type="button" disabled={locked} onClick={() => {
        prompt.current?.close()
        if (detail) onClear(tab === 'issues' ? 'CLEAR_BASKET_ISSUES' : 'CLEAR_BASKET_RETURNS', detail.revision)
      }}>예</button>}
      <button type="button" onClick={() => prompt.current?.close()}>{question === 'confirm' ? '아니오' : '확인'}</button>
    </dialog>
  </dialog>
}
