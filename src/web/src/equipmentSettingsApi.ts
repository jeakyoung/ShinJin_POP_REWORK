import { useEffect, useState } from 'react'

export type Step = { process: string; warehouse: string }
type Item = { code: string; name: string }
type Machine = Item & { description: string; owner: string }
export type Group = { number: string; start: string; end: string; steps: Step[] }
type Settings = { popId: string; machines: string[]; group: Group | null }
export type Site = { plant: string; plantName: string; center: string; centerName: string; description: string }
export type View = { siteRevision?:number|null; slotCodes: Record<number,string>; site: Site; sites: Site[]; popRows: (Item & {owner: string})[]; version: number; groupCenter: boolean; machineSettingsPresent: boolean; canEdit: boolean; machines: Machine[]; groups: Group[]
  processes: Item[]; warehouses: Item[]; saved: Settings; applied: Settings }
export function useEquipmentSettings(url: string, expired: () => void) {
  const [view, setView] = useState<View>()
  const [notice, setNotice] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const ctrl = new AbortController()
    fetch(url + '/equipment', { signal: ctrl.signal, cache: 'no-store' }).then(async r => {
      if (r.status === 401) { if (!ctrl.signal.aborted) expired(); return }
      if (!r.ok) throw Error()
      const result: View = await r.json()
      if (!ctrl.signal.aborted) { setView(result); setNotice('') }
    }).catch(() => { if (!ctrl.signal.aborted) setNotice('설비·그룹 설정을 불러오지 못했습니다.') })
    return () => ctrl.abort()
  }, [url, expired, attempt])
  return { view, setView, notice, reload: () => setAttempt(i => i + 1) }
}

