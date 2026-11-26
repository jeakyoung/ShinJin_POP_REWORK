import {SessionExpired} from './workHistoryApi'

const messages:Record<string,string>={
  BAD_WAREHOUSE_REQUIRED:'불량창고가 설정되지 않았습니다. 환경설정을 확인하십시오.',
  RETURN_WAREHOUSE_REQUIRED:'반납창고가 설정되지 않았습니다. 환경설정을 확인하십시오.',
  GOOD_LOCATION_INVALID:'양품 창고와 로케이션을 확인하십시오.',
  GOOD_WAREHOUSE_REQUIRED:'양품창고가 설정되지 않았습니다. 환경설정을 확인하십시오.',
  BAD_LOCATION_REQUIRED:'불량 창고와 로케이션을 입력하십시오.',
  STARTED_WORK_REQUIRED:'작업 시작 후 입력하십시오.', START_ALL_FIRST:'작업 일괄 시작 후 작업 완료 가능합니다.',
  DIFFERENT_GROUP:'같은 작업그룹끼리 작업완료 가능합니다.', COMPLETED_IN_LIST:'작업완료된 건이 존재합니다. 확인하십시오.',
  FOCUS_STARTED_ORDER:'병합은 작업시작된 수주건이 마지막 선택이 되어야 합니다.',
  INPUT_WAREHOUSE_REQUIRED:'투입창고가 설정되지 않았습니다. 환경설정을 확인하십시오.',
  INPUT_MATERIAL_REQUIRED:'투입자재를 투입하여 주십시오.', INPUT_QUANTITY_REQUIRED:'투입수량을 입력하십시오.',
  RETURN_DIMENSIONS_REQUIRED:'반납자재의 두께·폭·길이를 입력하십시오.', RETURN_ROW_INVALID:'반납자재의 창고·로케이션·수량을 확인하십시오.',
  LAST_MATERIAL:'작업 중 투입자재 전체를 삭제할 수 없습니다.',SCRAP_RETURN:'산철, 분철은 삭제할 수 없습니다.',
  MATERIAL_CHANGED:'자재가 변경되었습니다. 다시 확인하십시오.',INSUFFICIENT_STOCK:'해당 LOT의 재고수량을 확인하십시오.',
  PRODUCTION_QUANTITY_REQUIRED:'생산수량을 입력하십시오.', INVALID_QUANTITY:'생산수량을 확인하십시오.',
  INVALID_ARRANGEMENT:'배치 수를 확인하십시오.',WORK_CHANGED:'다른 작업에서 변경되었습니다. 다시 확인하십시오.',
}
export class ProductionError extends Error {
  readonly status:number
  constructor(status:number,code:string){super(messages[code]??'선택한 작업의 상태와 입력값을 확인하십시오.');this.status=status}
}
export async function productionRequest<T>(path:string,body?:unknown,workCode?:string,signal?:AbortSignal):Promise<T> {
  const response=await fetch(path,{method:body===undefined?'GET':'POST',cache:'no-store',signal,
    headers:{'Content-Type':'application/json',...(workCode===undefined?{}:{'X-Pop-Work-Code':workCode})},body:body===undefined?undefined:JSON.stringify(body)})
  if(response.status===401)throw new SessionExpired()
  const result=await response.json()
  if(!response.ok)throw new ProductionError(response.status,result.code??'WORK_CHANGED')
  return result
}
export type ProductionRow={date:string;sequence:number;revision:number;good:string|null;arrangement:string|null;goodPlace?:{warehouse:string;location:string;slot:number}}
export type MaterialSpec={quality:string|null;thickness:number|null;width:number|null;length:number|null}
export type MaterialKind='ISSUE_MATERIAL'|'RETURN_MATERIAL'
export type MaterialPatch={date:string;sequence:number;revision:number;event:number;quantity:number;spec:MaterialSpec|null}
export type MaterialDraft={date:string;sequence:number;action:MaterialKind;lines:MaterialPatch[]}
export type MaterialGridRow={date:string;sequence:number;revision:number;available:number;event:{action:MaterialKind;lotCode:string;quantity:number;position:{warehouse:string;location:string};revision:number;spec:MaterialSpec|null}}
export type ScannedIssue={date:string;sequence:number;warehouse:string;location:string;lot:string;material:string;quantity:number;slot?:number;source?:"manual"|"scan"}
export type ManualIssue={requestId:string;revision:number;line:ScannedIssue}
export type ProductionBatch={requestId:string;action:'START'|'PAUSE'|'RESUME'|'COMPLETE';selected:ProductionRow[];visible:ProductionRow[];autoPrint:boolean;materialDrafts?:MaterialDraft[];scannedIssues?:ScannedIssue[];focus?:{date:string;sequence:number}}
export type DefectsView={revision:number;warehouses:string[];locations:Record<string,string[]>;reasons:{code:string;name:string}[];
  saved:{warehouse:string|null;location:string|null;lines:{code:string;quantity:number}[];total:number}}
export type DefectsCommand={requestId:string;revision:number;warehouse:string;location:string;lines:{code:string;quantity:number}[]}
export function pendingCommand<T>(key:string):T|undefined {
  try{return JSON.parse(sessionStorage.getItem(key)??'null')??undefined}catch{return undefined}
}
