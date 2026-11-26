import { PlanningError } from './planningApi'
import type { Command, MaterialKey, OrderKey, PlanKey, View } from './planningApi'

export type SiteCatalog = {
  date:string; plantCode:string; workCode:string; directApply:boolean; process:string; warehouses:string[]; qualities:string[]
  stock:{target:PlanKey;source:MaterialKey}[]; orders:{key:OrderKey;month:string;stock:number;inProcess:number;defaultListed?:boolean|null}[]
}
export type PlanScreen={initialQuality?:string;parentQualities:string[];planning:View;catalog:SiteCatalog;prints:{key:PlanKey;count:number}[]}
export type ProcessCommand=Extract<Command,{action:'MANAGEMENT'|'OUTPUT'}>|(Extract<Command,{action:'BATCH'}>&{parentPlans?:PlanKey[]})|{action:'ATTACH'; requestId:string;expectedRevision:number;plans:PlanKey[]}
export const processPlanBase='/api/pop/process1/planning'
async function read<T>(response:Response):Promise<T> {
  const body=await response.json().catch(()=>null)
  if (!response.ok || body===null) throw new PlanningError(response.status,body?.code??'REQUEST_FAILED')
  return body as T
}
function workHeaders(workCode?:string):Record<string,string> {
  return workCode===undefined?{}:{'X-Pop-Work-Code':workCode}
}
export const loadScreen=(signal?:AbortSignal,base=processPlanBase,workCode?:string)=>fetch(base,{signal,cache:'no-store',headers:workHeaders(workCode)}).then(read<PlanScreen>)
export function unlock(password:string,base=processPlanBase) {return post(base+'/administrator',{password})}
function post(path:string,body:unknown,workCode?:string) {
  return fetch(path,{method:'POST',headers:{'Content-Type':'application/json',...workHeaders(workCode)},body:JSON.stringify(body)}).then(read)
}
export async function apply(command:ProcessCommand,base=processPlanBase,workCode?:string) {
  const {action,...body}=command
  const paths={ATTACH:'/attach',OUTPUT:'/output',BATCH:'/publish',MANAGEMENT:'/management'}
  return await post(base+paths[action],body,workCode) as {attached?:PlanKey[];skipped?:string[];pdf?:string}
}
export const planId=(key:PlanKey)=>key.date+'/'+key.sequence
export const orderId=(key:OrderKey)=>JSON.stringify([key.number,key.history,key.line])
export const materialId=(key:MaterialKey)=>JSON.stringify([key.item,key.lot,key.warehouse,key.position])
