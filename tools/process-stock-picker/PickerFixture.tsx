import '../../src/web/src/index.css'
import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import ProcessLotRows, {useProcessLotRows} from '../../src/web/src/processLot/ProcessLotRows'
import {canOpenProcessLot} from '../../src/web/src/processLot/processLotAccess'
import {loadSession} from '../../src/web/src/workHistoryApi'

function Harness({slot}:{slot:number}) {
  const [open,setOpen]=useState<'manual'|'scan'>()
  const [rows,setRows]=useProcessLotRows()
  return <><button onClick={()=>setOpen('manual')}>수동 선택</button><button onClick={()=>setOpen('scan')}>LOT 스캔</button>
    <table aria-label="합성 부모"><tbody><ProcessLotRows mode={open} open={!!open} slot={slot} date="2026-11-25"
      sequence={101} rows={rows.test??[]} onRows={values=>setRows({test:values})} onClose={()=>setOpen(undefined)}
      onSessionExpired={()=>location.reload()}/></tbody></table></>
}
const slot=Number(new URLSearchParams(location.search).get('slot'))
const identity=await loadSession(new AbortController().signal)
if(identity && canOpenProcessLot(identity,slot))createRoot(document.getElementById('root')!).render(<Harness slot={slot}/>)
