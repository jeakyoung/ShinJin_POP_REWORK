export type ReturnRow = {
  id: string
  warehouse: string
  location: string
  thickness: number
  width: number
  length: number
  quantity: number
  item: string | null
}
export type Option = { code: string; name: string }
export type Warehouse = Option & { scrap: boolean; locations: Option[] }
export type Material = {
  grade: string
  returnGrade: string
  thickness: number
  width: number
  warehouses: Warehouse[]
  defaults: { warehouse: string; location: string }[]
  matches: { warehouse: string; thickness: number; width: number; length: number; item: string }[]
}
export type Field = 'thickness' | 'width' | 'length' | 'quantity'
export const labels: Record<Field, string> = {
  thickness: '두께',
  width: '폭',
  length: '길이',
  quantity: '반납수량',
}
export function returnProblem(rows: ReturnRow[], material: Material | null, finishing: boolean) {
  for (const row of rows) {
    const wh = material?.warehouses.find((w) => w.code === row.warehouse)
    if (!wh || (!wh.scrap && !wh.locations.some((l) => l.code === row.location)))
      return '반납 입력된 자재의 대한 창고, 로케이션을 설정해주십시오.'
    if (finishing && !wh.scrap && row.quantity < 1) return '반납수량을 입력하십시오.'
  }
  for (const row of rows)
    for (const key of ['thickness', 'width', 'length'] as const)
      if (!row[key]) return '반납자재의 대한 ' + labels[key] + '를 입력하십시오.'
  return ''
}
