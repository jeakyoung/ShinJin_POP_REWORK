export type Stock = { warehouse: string; location: string; lot: string; material: string; name: string; quality: string
  thickness: number; width: number; length: number; available: number; workStatus: string; warehouseName?:string; locationName?:string }
export type PickerSource = {path:string;suffix:string;headers:Record<string,string>; initialSize?:{thickness:string;width:string}}
export type Pick = { stock: Stock; quantity: number; checked: boolean; materialSequence?:number }
export const key = (s: Stock) => JSON.stringify([s.warehouse, s.location, s.lot, s.material])
export const over = '투입수량이 재고 수량보다 높을 순 없습니다.'
