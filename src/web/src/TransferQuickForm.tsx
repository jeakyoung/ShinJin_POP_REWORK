import { useState } from 'react'
import type { EntryProps } from './TransferEntryForm'
import { defaults, formCommand, localDate } from './TransferEntryForm'
import TransferFormDialog, { Lookup } from './TransferFormDialog'
import type { Pick } from './TransferFormDialog'
import TransferGrid from './TransferEntryGrid'
import type { GridRecord } from './TransferGrid'
import type { Lot, Route } from './transferFormTypes'
import { position } from './transferFormTypes'
import layout from './transferForm8.json'

const key=(l:Lot)=>JSON.stringify([l.warehouse,l.location,l.lot,l.item])
type Applied={lot:Lot;qty:number}
export default function TransferQuickForm({state,forms,version,locked,ask,submit,read}:EntryProps) {
  const [route,setRoute]=useState(()=>defaults(state.master?.terminalPlant??'',true))
  const [quality,setQuality]=useState(''),[thickness,setThickness]=useState(0),[day,setDay]=useState(()=>localDate(true))
  const [query,setQuery]=useState<{source:string;quality:string;thickness:number}|null>(null)
  const [applied,setApplied]=useState<Applied[]>([]),[pick,setPick]=useState<Pick|null>(null)
  const [last,setLast]=useState(version)
  if(last!==version){setLast(version);setApplied([])}
  const {catalog,stock}=forms
  const options=(id:string)=>id==='gluMatQuality'?catalog.qualities.filter(q=>q.etc):id.endsWith('Plant')?
    catalog.sites.filter(s=>s.code==='000001'||s.code==='000002'):
    catalog.warehouses.filter(w=>w.etc&&w.plant===(id==='gluOutWarehouse'?route.outPlant:route.inPlant))
  const fields:Record<string,keyof Route>={gluOutPlant:'outPlant',gluInPlant:'inPlant',gluOutWarehouse:'source',gluInWarehouse:'destination'}
  const labels:Record<string,string>={gluOutPlant:'출고사업장',gluInPlant:'입고사업장',gluOutWarehouse:'출고창고',gluInWarehouse:'입고창고',gluMatQuality:'재질'}
  function change(id:string,code:string){
    if(id==='gluMatQuality'){setQuality(code);return}
    if(id.endsWith('Plant')){
      setRoute({...route,[fields[id]]:code,source:'',destination:''});setQuery(null);setApplied([])
    }else{
      setRoute({...route,[fields[id]]:code})
      if(id==='gluOutWarehouse'&&code!==route.source){setQuery(null);setApplied([])}
    }
  }
  function remaining(l:Lot){return stock.find(s=>key(s.lot)===key(l))?.remaining??0}
  function add(l:Lot){
    const current=applied.find(a=>key(a.lot)===key(l))
    if((current?.qty??0)>=remaining(l)){ask({text:'투입수량이 재고 수량보다 높을 순 없습니다.'});return}
    setApplied(current?applied.map(a=>a===current?{...a,qty:a.qty+1}:a):[...applied,{lot:l,qty:1}])
  }
  function search(){if(route.source&&route.destination&&quality)read(()=>setQuery({source:route.source,quality,thickness}))}
  function save(){
    if(route.source===route.destination){ask({text:'같은 창고로 재고 이동이 불가합니다.'});return}
    if(!route.source||!route.destination||!quality){ask({text:'검색 조건을 모두 선택 해주세요.'});return}
    if(!applied.length){ask({text:'품목을 선택 해주세요.'});return}
    if(!route.source||!route.destination)return
    submit(formCommand('QUICK_TRANSFER',applied.map(({lot,qty})=>({...route,spec:lot.spec,quantity:qty,
      source:lot.warehouse,outPlant:lot.plant,lot:lot.lot,location:lot.location,item:lot.item})),day))
  }
  const found=query?stock.filter(({lot,remaining})=>remaining>0&&lot.warehouse===query.source&&
    catalog.stockSearches.some(q=>q.plant===lot.plant&&q.warehouse===lot.warehouse&&q.lot===lot.lot&&q.location===lot.location&&q.item===lot.item&&
      q.quality===(['014','015'].includes(query.quality)?'014,015,019':query.quality)&&q.thickness===query.thickness)):[]
  function row(l:Lot, qty?:number):GridRecord{
    const id=key(l),s=l.spec
    const numeric=()=>setPick({name:'ComNumericKeyPad',apply:v=>setApplied(applied.map(a=>key(a.lot)===id?
      {...a,qty:Math.max(1,Math.min(remaining(l),Number(v)))}:a))})
    return {key:id,fields:{ITEM_KIND_NAME3:catalog.kinds.find(k=>k.third===s.third&&k.first===s.first&&k.second===s.second)?.name,
      ETC:catalog.warehouses.find(w=>w.plant===l.plant&&w.code===l.warehouse)?.etc,MATERIAL_ETC:catalog.qualities.find(q=>q.code===s.quality)?.etc,
      matquality_name:catalog.qualities.find(q=>q.code===s.quality)?.name,thickness:s.thickness,spec_x:s.width,spec_y:s.length,cur_qty:remaining(l),
      '추가':<button type="button" aria-label={l.lot+' 추가'} disabled={locked} onClick={()=>add(l)}/>,
      output_qty:<button type="button" aria-label={l.lot+' 투입수량'} disabled={locked} onClick={numeric}>{qty}</button>,
      DEL:<button type="button" aria-label={l.lot+' 삭제'} disabled={locked} onClick={()=>setApplied(applied.filter(a=>key(a.lot)!==id))}/>}}
  }
  return <div className="transfer-document-scroll"><div className="transfer-form entry-form quick-form" aria-label="간편이송">
    {layout.controls.map(c=>{
      const {id,kind,text}=c,style=position(c)
      if(kind==='Panel')return <div key={id} style={style}/>
      if(kind==='GridControl'){
        const left=id==='gc1'
        return <TransferGrid key={id} title={left?'자재 목록':'적용 목록'} columns={layout.grids[left?0:1]} style={style}
          headerActions={!left&&!locked?{DEL:()=>setApplied([])}:undefined}
          rows={left?found.map(s=>row(s.lot)):applied.map(a=>row(a.lot,a.qty))}/>
      }
      if(kind==='GridLookUpEdit')return <Lookup key={id} id={id} control={c} disabled={locked} label={labels[id]} options={options(id)}
        value={id==='gluMatQuality'?quality:route[fields[id]]} change={code=>change(id,code)}/>
      if(kind==='DateEdit')return <label key={id} className="transfer-date-box" style={style}><span aria-hidden>{day}</span><input type="date" aria-label="출고일" value={day} disabled={locked}
        onChange={e=>{if(e.target.value)setDay(e.target.value)}}/></label>
      if(id==='lblThickness'||kind==='SimpleButton')return <button key={id} id={id} style={style} disabled={locked}
        onClick={()=>id==='lblThickness'?setPick({name:'ComNumericKeyPad2',apply:v=>setThickness(Number(v))}):id==='searchBtn'?search():save()}>
        {id==='lblThickness'?thickness:text}</button>
      return <span key={id} className="transfer-caption" style={style}>{text}</span>
    })}
    {pick&&<TransferFormDialog pick={pick} close={()=>setPick(null)} ask={ask}/>}
  </div></div>
}
