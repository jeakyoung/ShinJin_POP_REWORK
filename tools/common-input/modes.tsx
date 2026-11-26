import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CommonNumericPad, { type NumericPadMode } from './src/commonInput/CommonNumericPad'
import CommonScanDialog from './src/commonInput/CommonScanDialog'
import './src/index.css'
function Modes(){
  const [mode, open] = useState<NumericPadMode>()
  const [scan, setScan] = useState<'material'|'integrated'|'order'>()
  const [result, record] = useState('')
  return <><button onClick={()=>open('decimal')}>decimal</button><button onClick={()=>open('preset')}>preset</button>
    {(['material','order','integrated'] as const).map(m=><button key={m} onClick={()=>setScan(m)}>{m}</button>)}
    {scan && <CommonScanDialog mode={scan} position={{left:70, top:270}}
      onEnter={async raw=>{
        if (raw === ' ERROR ') throw new Error('fixture error')
        if (raw === 'MULTI') return {next:'close',result:'ok'}
        return {next:'continue',closeResult:'ok'}
      }} onError={async e=>record((e as Error).message)}
      onClose={v=>{record(scan+' '+v);setScan(undefined)}} />}
    <p>result={result}</p>{mode && <CommonNumericPad mode={mode} onCancel={()=>open(undefined)}
      onApply={value=>{record(value);open(undefined)}} />}</>
}
createRoot(document.getElementById('root')!).render(<Modes />)
