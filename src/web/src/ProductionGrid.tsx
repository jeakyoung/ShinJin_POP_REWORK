const stages=['발주','소재입고','폭 절단','평탄','평면A','평면B','측면','4면가공','길이절단','도면가공','포장']
export function ProductionStages({values={},kind}:{values?:Record<string,string>;kind?:string}) {
  return <div className="prod-stages"><span>선택건<br/>공정진행현황</span><table aria-label="공정진행현황"><thead><tr>{stages.map(s=><th key={s}>{s}</th>)}</tr></thead>
    <tbody><tr>{stages.map(s=><td key={s}>{values[s]??''}</td>)}</tr></tbody></table>{kind!==undefined && <span>품목유형　<b>{kind||'-'}</b></span>}</div>
}
export function Tool({code,label,onClick,disabled=false,color='blue'}:{code:string;label:string;onClick?:()=>void;disabled?:boolean;color?:string}) {
  return <button className={'prod-command '+color} type="button" disabled={disabled} aria-label={label} onClick={onClick}><b aria-hidden="true">{code}</b>{label}</button>
}
export function Scanner({onClick,label='작업지시 스캔',disabled=false}:{onClick:()=>void;label?:string;disabled?:boolean}){
  return <button className="prod-scanner" type="button" aria-label={label} disabled={disabled} onClick={onClick}><img src={new URL('./drawing-scan.png',import.meta.url).href} alt=""/></button>
}
