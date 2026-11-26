export type PlanKey = { date: string; sequence: number }
export type Lot = { item: string; lot: string; warehouse: string; position: string }
export type Issue = { lot: Lot; quantity: string }
export type ReturnLine = Issue & { length: string;material?:DisplayLot|null;sequence?:number|null }
export type ClearMaterialAction = 'CLEAR_BASKET_ISSUES' | 'CLEAR_BASKET_RETURNS'
export type Action = 'SAVE_BASKET' | 'START_BASKET' | 'PAUSE_BASKET' | 'RESUME_BASKET' | 'FINISH_BASKET' | 'DELETE_ROW' | 'DELETE_UNFINISHED' | 'SET_RETURN_QUANTITY' | 'ADD_MANUAL_ISSUE' | 'REMOVE_ISSUE_ROWS' | 'REMOVE_RETURN_ROWS' | 'SAVE_RETURN_GRID' | ClearMaterialAction
export type Actor = { terminal: string; worker: string }
export type DisplayLot = { lot: Lot; warehouseName: string; locationName: string; qualityName: string;qualityCode?:string|null;
  thickness: number; width: number; length: number | null }
export type ProductionReturn = { sequence: number; line: { lot: Lot; quantity: number; length: number;material?:DisplayLot|null };
  material: DisplayLot | null; outputDate: string; createdBy: string; createdAt: string;
  updatedBy: string | null; updatedAt: string | null }
export type BasketView = {
  actor: Actor & { scope: { factory: string; site: string; center: string } }
  mode: 'BASKET' | 'ALL_LIST' | 'CHECKED_LIST'
  revision: number
  canWrite: boolean
  work: { plan: { key: PlanKey; order: string; orderLine: number; item: string; columns?:{mergeKey:string;quality:string;qualityName:string;thickness:number;width:number;length:number;customer:string;orderDate:string;dueDate:string;remark:string}|null }; phase: string; produced?: number; groupId: string | null }[]
  groups: { id: string; terminal: string; issues: { lot: Lot; quantity: number }[]; returns: { lot: Lot; quantity: number; length: number;material?:DisplayLot|null }[]; startedAt: string | null;
    issueSequences:number[];returnSequences:number[];productionReturns: ProductionReturn[]; productionIssues?:{sequence:number;line:{lot:Lot;quantity:number}}[] }[]
  materials: { lot: Lot; available: number;display?:DisplayLot|null }[]
  returnCandidates: Lot[]
}
export type Command = {
  action: Action; requestId: string; expectedRevision: number; groupId?: string
  manualSequence?:number
  removal?:{rows:number[];checked:number[]}
  returnEdit?: { sequence: number; quantity: string }
  amounts?:{key:PlanKey;quantity:string}[]; visible: PlanKey[]; selected: PlanKey[]; issues: Issue[]; returns: ReturnLine[]
}
export type GroupDetail = {
  revision: number
  group: BasketView['groups'][number]
  materials: BasketView['materials']
  displayLots: DisplayLot[]
}
type Result = { revision: number; affected: PlanKey[]; groupId: string | null }
export class BasketApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
async function request<T>(suffix = '', init?: RequestInit): Promise<T> {
  const response = await fetch('/api/pop/work-baskets' + suffix, { ...init, credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new BasketApiError(response.status, typeof body?.code === 'string' ? body.code : 'HTTP ' + response.status)
  }
  return response.json() as Promise<T>
}
export type BasketProcess={slot?:number|null;workCode?:string}
export function stockPickerSource(key:PlanKey,checked:string[],process:BasketProcess){
  return {path:'/api/pop/work-baskets/stock-picker/'+encodeURIComponent(key.date)+'/'+key.sequence,
    suffix:'?'+new URLSearchParams(checked.map(value=>['checked',value])).toString(),headers:headers(process)}
}
function headers(process?:BasketProcess):Record<string,string> {
  if(!process?.slot)return {}
  return {'X-Pop-Process-Slot':String(process.slot),'X-Pop-Work-Code':process.workCode??''}
}
export const loadBasket = (process?:BasketProcess) => request<BasketView>('',{headers:headers(process)})
export type ReturnInput={firstPlan:PlanKey;firstIssue:Lot;focusedIssue:Lot;position?:string;length?:number;row?:DisplayLot|null}
export const lookupBasketReturns=(key:PlanKey,input:ReturnInput,process:BasketProcess)=>request<DisplayLot[]>(
  '/return-lookup/'+encodeURIComponent(key.date)+'/'+key.sequence,{method:'POST',
    headers:{'Content-Type':'application/json',...headers(process)},body:JSON.stringify(input)})
export const basketScanner = (process:BasketProcess) => request<{configured:boolean}>('/scan',{headers:headers(process)})
export const scanBasketOrder = (barcode:string,process:BasketProcess) => request<{keys:PlanKey[];orderNo:string;detailCode:string}>('/scan',{
  method:'POST',headers:{'Content-Type':'application/json',...headers(process)},body:JSON.stringify({barcode}),
})
export const loadBasketGroup = (groupId:string,process?:BasketProcess) => request<GroupDetail>('/groups/'+encodeURIComponent(groupId),{headers:headers(process)})
export const sendBasketCommand = (command:Command,process?:BasketProcess) => request<Result>('/commands',{
  method:'POST',headers:{'Content-Type':'application/json',...headers(process)},body:JSON.stringify(command),
})
