import type { ShippingInfo } from './shippingApi'

export type FilterType = 'material' | 'kind' | 'center'
export type Option = { code: string; name: string; abbreviation?: string }
export type SavedFilter = { selected: string[]; known: string[] }
type Settings = Partial<Record<FilterType, SavedFilter>>

export function optionsFor(type: FilterType | 'customer', infos: ShippingInfo[]): Option[] {
  const choices = new Map<string, Option>()
  for (const row of infos) {
    const [code, name] = type === 'material' ? [row.materialCode, row.material]
      : type === 'kind' ? [row.itemKindCode, row.itemKind]
      : type === 'center' ? [row.workCenter, row.workCenterName] : [row.customerCode, row.customer]
    if (!choices.has(code)) choices.set(code, { code, name, abbreviation: row.customerAbbreviation })
  }
  return [...choices.values()].sort((a, b) => a.code.localeCompare(b.code))
}
export function readFilters(terminal: string): Settings {
  try { return JSON.parse(localStorage.getItem('pop-shipping-options:' + terminal) ?? '{}') ?? {} } catch { return {} }
}
export function writeFilter(terminal: string, type: FilterType, entry: SavedFilter) {
  localStorage.setItem('pop-shipping-options:' + terminal, JSON.stringify({ ...readFilters(terminal), [type]: entry }))
}
export function selectedFor(type: FilterType, saved: Settings, options: Option[]) {
  const prior = saved[type]
  return options.filter(({ code }) => !prior || prior.selected.includes(code)
    || type !== 'material' && !prior.known.includes(code)).map(row => row.code)
}

