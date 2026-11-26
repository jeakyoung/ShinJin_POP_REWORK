import { useState } from 'react'
import type { ReactNode } from 'react'
import TransferFormDialog from './TransferFormDialog'
import type { Pick } from './TransferFormDialog'
import TransferGrid from './TransferEntryGrid'
import type { GridRecord } from './TransferGrid'
import TransferQuickForm from './TransferQuickForm'
import type { Command, TransferState } from './transferApi'
import type { Message } from './TransferMessage'
import { position } from './transferFormTypes'
import type { FormBody, FormView, FormLine, Route, Spec } from './transferFormTypes'
import layout from './transferForm1.json'
import './transferEntry.css'

export type EntryProps = { read: (apply:(s:TransferState)=>void)=>void; state: TransferState; forms: FormView; version: number; locked: boolean; ask: (m:Message)=>void; submit:(c:Command)=>void }
export function localDate(business=false) {
  const d=new Date()
  if(business && d.getHours()<8) d.setDate(d.getDate()-1)
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')
}
export function defaults(site: string, quick=false): Route {
  const out=site==='000001'?'000002':site==='000002'?'000001':''
  const warehouse=(p:string)=>quick?'':p==='000001'?'003':p==='000002'?'203':''
  return {outPlant:out,inPlant:out?site:'',source:warehouse(out),destination:warehouse(out?site:'')}
}
export function formCommand(action: FormBody['action'], lines: FormLine[], date?:string):Command {
  const key=crypto.randomUUID()
  return {request:'',commandId:key,action,form:{key,action,lines,date}}
}
const baseKind={first:'100',second:'110',third:'SL'}
type EditLine=FormLine & {stock?:number; checked?:boolean}
export default function TransferEntryForm(props: EntryProps & {quick:boolean}) {
  return props.quick ? <TransferQuickForm {...props}/> : <RequestForm {...props}/>
}
function RequestForm({state,forms,version,locked,ask,submit,read}: EntryProps) {
  const {catalog}=forms, site=state.master?.terminalPlant??''
  const [route,setRoute]=useState(()=>defaults(site))
  const [kind,setKind]=useState(baseKind),[quality,setQuality]=useState('')
  const [number,setNumber]=useState(''),[rows,setRows]=useState<EditLine[]>([])
  const [pick,setPick]=useState<Pick|null>(null)
  const [last,setLast]=useState(version)
  const record=forms.records.find(r=>r.number===number)
  const doc=state.transfers.find(r=>r.request===record?.erpRequest)
  const issued=!!doc?.documents.SHIP
  if(number && !record){ setNumber('');setRows([]) }
  if(last!==version){ setLast(version);setRows(record?.lines??[]);if(!record)setNumber('') }
  const siteName=(code:string)=>catalog.sites.find(s=>s.code===code)?.name??''
  const whName=(code:string)=>catalog.warehouses.find(s=>s.code===code)?.name??''
  const qualName=(code:string)=>catalog.qualities.find(s=>s.code===code)?.name??''
  const kindName=(k:typeof baseKind)=>catalog.kinds.find(s=>s.first===k.first&&s.second===k.second&&s.third===k.third)?.name??(k.third==='SL'?'SM규격-LONG':'')
  const alert=(text:string)=>ask({text})
  function edit(index:number,delta:Partial<EditLine>){setRows(list=>list.map((r,i)=>i===index?{...r,...delta}:r))}
  function reset(){setNumber('');setRoute(defaults(site));setKind(baseKind);setRows([])}
  function selectKind(index?:number) {
    const row=index===undefined?undefined:rows[index], r=row??route
    if(!r.destination)return alert('입고창고를 먼저 선택하세요.')
    const kinds=catalog.kinds.filter(o=>o.plant===r.inPlant&&o.warehouse===r.destination)
    setPick({name:'ComItemKind3',options:kinds.map(k=>({code:k.code2,name:k.name})),apply:v=>{
      const {first,second,third}=kinds.find(k=>k.code2===v)!
      if(row&&index!==undefined) edit(index,{spec:{...row.spec,first,second,third}})
      else setKind({first,second,third})
    }})
  }
  function selectQuality(index?:number) {
    setPick({name:'ComMatQuality',options:catalog.qualities,apply:v=>{
      if(index===undefined)setQuality(v)
      else edit(index,{spec:{...rows[index].spec,quality:v}})
    }})
  }
  function selectRoute(out:boolean) {
    setPick({name:'ComPlantWarehouse',plant:out?route.outPlant:route.inPlant,value:out?route.source:route.destination,
      options:catalog.sites,warehouses:catalog.warehouses,apply:(wh:string,p:string)=>setRoute(out?{...route,outPlant:p,source:wh}:{...route,inPlant:p,destination:wh})})
  }
  function editNumber(i:number,field:'width'|'length'|'thickness'|'quantity'){
    setPick({name:field==='quantity'?'ComNumericKeyPad':'ComNumericKeyPad2',apply:value=>{
      if(field==='quantity')edit(i,{quantity:Number(value)})
      else edit(i,{spec:{...rows[i].spec,[field]:Number(value)}})
    }})
  }
  const texts:Record<string,string>={lbOutputReqNoField:number,lbOutDateField:localDate(),lbPlantOutField:siteName(route.outPlant),
    lbPlantInField:siteName(route.inPlant),lbWarehouseOutField:whName(route.source),lbWarehouseInField:whName(route.destination),
    lbItemKind3Name:kindName(kind),lbMatQualityName:qualName(quality)}
  function onButton(id:string) {
    if(id==='lbOutputReqNoField') {
      read(next=>{const documents=next.forms?.records??[];setPick({name:'ComOutputReq',records:documents.filter(r=>r.day===localDate()),qualityName:qualName,apply:v=>{
        setNumber(v);setRows(documents.find(d=>d.number===v)?.lines??[])
      }})});return
    }
    if(id==='simpleButton5'||id==='lbOutputReqNoClear'){read(()=>reset());return}
    if(id.endsWith('Clear')){
      const out=id.includes('Out')
      const delta=id.includes('Plant')?(out?{outPlant:'',source:''}:{inPlant:'',destination:''}):(out?{source:''}:{destination:''})
      setRoute({...route,...delta});return
    }
    if(id==='lbItemKind3Name')return selectKind()
    if(id==='lbMatQualityName')return selectQuality()
    if(id.includes('Plant')||id.includes('Warehouse'))return selectRoute(id.includes('Out'))
    if(id==='simpleButton4'){
      if(issued)return alert('출고처리가 된 건은 추가하실 수 없습니다.\n신규 등록하세요!')
      if(!quality||!kind.third)return alert('품목유형과 재질을 모두 선택하세요.')
      const inPlant=route.inPlant||site
      setRows([...rows,{...route,inPlant,destination:route.destination||(inPlant==='000001'?'003':'013'),
        spec:{...kind,quality,thickness:0,width:0,length:1250},quantity:0,location:'000000'}]);return
    }
    if(id==='simpleButton1'||id==='simpleButton2'){
      if(!rows.length||issued)return alert('적용 대상이 없습니다.\n확인하십시오')
      const change=id==='simpleButton1'?{outPlant:route.outPlant,source:route.source}:{inPlant:route.inPlant,destination:route.destination}
      setRows(rows.map(row=>({...row,...change})));return
    }
    if(id==='btnMatTest'){
      read(next=>setRows(rows.map(row=>{
        const match=next.forms?.catalog.requestStocks.find(m=>m.outPlant===row.outPlant&&sameSpec(m.spec,row.spec))
        return {...row,source:match?.warehouse??row.source,stock:Number(next.stock.find(x=>x.item===match?.item&&x.warehouse===match?.warehouse)?.quantity??0)}
      })));return
    }
    if(id==='simpleButton3'){
      if(!number||!doc)return alert('삭제 대상이 없습니다.\n확인하십시오')
      if(issued)return alert('출고처리가 된 건은 삭제하실 수 없습니다.\n확인하십시오')
      ask({text:'해당 출고의뢰 건을 삭제하시겠습니까?',yes:()=>submit({request:doc.request,action:'CANCEL_REQUEST',commandId:crypto.randomUUID(),sourceDocument:doc.documents.REQUEST})});return
    }
    if(id==='btnRevWorkOrder'){
      if(!rows.length)return alert('품목을 선택 해주세요.')
      if(issued)return alert('출고처리가 된 건은 변경할 수 없습니다.')
      if(rows.some(r=>r.quantity<1))return alert('요청수량을 입력하세요!')
      submit(formCommand('REQUEST',rows.map(r=>({outPlant:r.outPlant,inPlant:r.inPlant,source:r.source,destination:r.destination,
        spec:r.spec,quantity:r.quantity,location:r.location}))));return
    }
  }
  function gridRows():GridRecord[]{
    return rows.map((r,i)=>{
      const cell=(field:string,v:ReactNode,click:()=>void)=><button type="button" disabled={locked||issued} aria-label={field+' '+(i+1)} onClick={click}>{v}</button>
      const remove=()=>{
        if(issued)return alert('출고된 데이터는 삭제하실 수 없습니다.\n확인하세요.')
        if(number) return alert('저장된 상세 행 삭제는 검증 전입니다.')
        ask({text:'선택한 항목을 삭제하시겠습니까?',yes:()=>setRows(list=>list.filter((_,n)=>n!==i))})
      }
      return {key:String(i),fields:{chk:<input type="checkbox" checked={!!r.checked} aria-label={'선택 '+(i+1)} onChange={()=>edit(i,{checked:!r.checked})}/>,
        item_kind3:cell('품목유형',kindName(r.spec),()=>selectKind(i)),matquality_name:cell('재질',qualName(r.spec.quality),()=>selectQuality(i)),
        thickness:cell('두께',r.spec.thickness,()=>editNumber(i,'thickness')),spec_x:cell('폭',r.spec.width,()=>editNumber(i,'width')),
        spec_y:cell('길이',r.spec.length,()=>editNumber(i,'length')),order_qty:cell('요청수량',r.quantity,()=>editNumber(i,'quantity')),
        plant_name_out:siteName(r.outPlant),warehouse_name_out:whName(r.source),STOCK_QTY:r.stock??0,
        plant_name_in:siteName(r.inPlant),warehouse_name_in:whName(r.destination),location_name_in:'000-N/A',
        out_date:doc?.documents.SHIP&&state.documentDates?.[doc.documents.SHIP.revision],output_charge_name:doc?.documents.SHIP&&state.headers?.[doc.documents.SHIP.revision]?.worker,
        '삭제':<button className="request-remove" disabled={locked} aria-label={'행 삭제 '+(i+1)} onClick={remove}/>}}
    })
  }
  return <div className="transfer-document-scroll"><div className="transfer-form entry-form" aria-label="공장이송의뢰">
    {layout.controls.map(c=>{
      const {id,kind,text}=c,style=position(c)
      if(kind==='GridControl')return <TransferGrid key={id} title="공장이송의뢰 품목" style={style} columns={layout.grids[0]} rows={gridRows()}/>
      if(kind==='Panel')return <div key={id} style={style}/>
      if(id==='lbOutDateField'||id.startsWith('labelControl'))return <span key={id} className="transfer-caption" style={style}>{texts[id]??text}</span>
      const label=id.endsWith('Clear')?(texts[id.replace('Clear','Field')]?'X':''):texts[id]??text
      return <button key={id} type="button" id={id} style={style} disabled={locked} onClick={()=>onButton(id)}>{label}</button>
    })}
    {pick&&<TransferFormDialog pick={pick} close={()=>setPick(null)} ask={ask}/>}
  </div></div>
}
function sameSpec(a:Spec,b:Spec) {
  return a.first===b.first&&a.second===b.second&&a.third===b.third&&a.quality===b.quality&&a.thickness===b.thickness&&a.width===b.width&&a.length===b.length
}
