export type Spec = { quality: string; first: string; second: string; third: string; thickness: number; width: number; length: number }
export type Route = { outPlant: string; inPlant: string; source: string; destination: string }
export type FormLine = Route & { spec: Spec; quantity: number; lot?: string; location?: string; item?: string }
export type FormBody = { key: string; action: 'REQUEST' | 'QUICK_TRANSFER'; lines: FormLine[]; date?: string }
export type FormRecord = { number: string; erpRequest: string; day: string; plant: string; worker: string; lines: FormLine[] }
type Kind = Pick<Spec,'first' | 'second' | 'third'> & { plant: string; warehouse: string; name: string; code2: string }
export type Catalog = {
  sites: { code: string; name: string }[]
  warehouses: { plant: string; code: string; name: string; etc: string }[]
  qualities: { code: string; name: string; etc: string }[]
  kinds: Kind[]
  stockSearches: {plant:string;warehouse:string;quality:string;thickness:number;location:string;lot:string;item:string}[]
  requestStocks: {outPlant:string;spec:Spec;warehouse:string;item:string}[]
  materials: (Route & {spec: Spec; item: string; part: string})[]
}
export type Lot = { plant: string; warehouse: string; location: string; lot: string; item: string; spec: Spec; quantity: number }
export type FormView = { catalog: Catalog; records: FormRecord[]; stock: { lot: Lot; remaining: number }[] }
export type RectControl = { id: string; kind: string; text: string; rect: number[]; popup?: number[]; optionColumns?: (number|string)[][]; style: object }
export function position(c: RectControl): import('react').CSSProperties {
  const [left,top,width,height] = c.rect
  return { position: 'absolute', minHeight:0, minWidth:0, left, top, width, height, ...c.style }
}
