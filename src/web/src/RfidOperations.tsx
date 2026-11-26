import { useEffect, useRef, useState } from 'react'
import { Field, BoxPhoto } from './RfidControls'
import RfidBarcodeCamera from './RfidBarcodeCamera'
import type { Forms, Pallet } from './RfidForms'

type Box = { id: string; date: string; tag: string; pallet: string; customer: string; picture: string; latestDirection: string }
type Data = Forms & { boxes: Box[] }
type Payload = { requestId: string; pallet: string; tag: string; date: string; customer: string; pictures: string[] }
  | { requestId: string; box: string; date: string; customer: string; direction: 'IN' | 'OUT' }
const asset = (name: string) => import.meta.env.BASE_URL + 'rfid/' + name + '.png'
const now = () => new Date().toLocaleTimeString('sv-SE',{timeZone:'Asia/Seoul'})
async function pendingStore(key: string, op: 'get'|'put'|'drop', value?: Payload): Promise<Payload | undefined> {
  const db = await new Promise<IDBDatabase>((resolve,reject) => {
    const request = indexedDB.open('pop-rfid-operations',1)
    request.onupgradeneeded = () => request.result.createObjectStore('pending')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    return await new Promise<Payload | undefined>((resolve,reject) => {
      const tx = db.transaction('pending', op === 'get' ? 'readonly' : 'readwrite')
      const store = tx.objectStore('pending')
      const request = op === 'get' ? store.get(key) : op === 'put' ? store.put(value,key) : store.delete(key)
      tx.oncomplete = () => resolve(op === 'get' ? request.result : undefined)
      tx.onabort = () => reject(tx.error)
    })
  } finally { db.close() }
}
export default function RfidOperations({ packing, actor, onSessionExpired }: { packing: boolean; actor: string; onSessionExpired: () => void }) {
  const [data,setData] = useState<Data>()
  const [number,setNumber] = useState('')
  const [date,setDate] = useState('')
  const [customer,setCustomer] = useState('')
  const [scanned,setScanned] = useState('')
  const [clock,setClock] = useState(now)
  const [modal,setModal] = useState<'number'|'scan'|'customer'|'IN'|'OUT'>()
  const [notice,setNotice] = useState('')
  const [photos,setPhotos] = useState<string[]>([])
  const [receipt,setReceipt] = useState('')
  const [camera,setCamera] = useState(false)
  const [barcodeCamera,setBarcodeCamera] = useState(false)
  const [device,setDevice] = useState('')
  const [progress,setProgress] = useState<number>()
  const [pending,setPending] = useState<Payload>()
  const [busy,setBusy] = useState(false)
  const request = useRef<XMLHttpRequest | null>(null)
  const active = useRef<AbortController | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const cameraRequest = useRef(0)
  const lock = useRef(false)
  const preview = useRef<HTMLVideoElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const key = actor + (packing ? ':pack' : ':move')
  const current = data?.pallets.find(p=>p.number === number)
  const boxes = data?.boxes.filter(b=>b.pallet === number && b.tag === current?.tag) ?? []
  const box = [...boxes].sort((a,b)=>b.date.localeCompare(a.date) || boxes.indexOf(b)-boxes.indexOf(a))[0]
  const displayedBox = packing ? boxes.filter(b=>b.date === date).at(-1) : box
  useEffect(()=>{
    const c = new AbortController(); active.current=c
    fetch('/api/pop/rfid/forms',{signal:c.signal}).then(async r=>{
      if(r.status === 401) return onSessionExpired()
      if(!r.ok) throw Error()
      const d = await r.json() as Data
      if(!c.signal.aborted) {setData(d);setDate(d.today)}
    }).catch(()=>{if(!c.signal.aborted)setNotice('RFID 자료를 조회하지 못했습니다.')})
    pendingStore(key,'get').then(p=>{if(!c.signal.aborted)setPending(p)}).catch(()=>{if(!c.signal.aborted)setNotice('이전 저장 요청을 읽지 못했습니다.')})
    const timer=setInterval(()=>setClock(now()),1000)
    return ()=>{c.abort(); request.current?.abort(); stream.current?.getTracks().forEach(t=>t.stop()); clearInterval(timer)}
  },[key,onSessionExpired])
  useEffect(()=>{if(modal)dialog.current?.showModal()},[modal])
  function open(kind: typeof modal) {setScanned('');setModal(kind);setNotice('')}
  function close() {setBarcodeCamera(false);dialog.current?.close();setModal(undefined)}
  function stop() {
    ++cameraRequest.current
    stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;setCamera(false)
  }
  function customerLookup(value: string) {
    const found = data?.customers.find(c => c.plan === value.trim())
    close()
    if (found) {setCustomer(found.code);setNotice('')}
    else setNotice('조회 된 출고처가 없습니다.')
  }
  function lookup() {
    if(!data) return
    if(modal==='customer'){customerLookup(scanned);return}
    const row=data.pallets.find(p=>modal === 'number' ? p.number === scanned.trim() : p.tag === scanned.trim())
    if(!row || !row.tag) {setNotice('등록된 파렛트를 찾지 못했습니다.');return}
    const latest=data.boxes.filter(b=>b.pallet===row.number && b.tag===row.tag).at(-1)
    if(!packing && !latest) {setNotice('등록 된 파렛트 포장 내역이 없습니다.');return}
    select(row)
    if (!packing && latest) {
      setCustomer(data.customers.find(c => c.name === latest.customer)?.code ?? (latest.customer === data.factory ? data.factory : ''))
    }
    if (row.master?.status === '폐기' || row.master?.status === '판매') {
      setNotice(row.master.status + ' 된 파렛트 입니다. 확인 후 입출고 처리바랍니다.')
    }
    close()
  }
  function select(row:Pallet) {
    stop();setPhotos([]);setReceipt('');setNumber(row.number);setCustomer('');setNotice('')
  }
  async function capture(change:boolean) {
    if(!current?.tag){setNotice('RFID 태그ID를 먼저 조회 해주세요.');return}
    stop();const token=++cameraRequest.current
    try {
      let id=device
      if(change) {
        const list=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput')
        if(list.length<2) {setNotice('전환할 카메라가 없습니다.');return}
        id=list[(list.findIndex(d=>d.deviceId===device)+1)%list.length].deviceId
      }
      const media=await navigator.mediaDevices.getUserMedia({video:id?{deviceId:{exact:id}}:true,audio:false})
      if(active.current?.signal.aborted || token!==cameraRequest.current) {media.getTracks().forEach(t=>t.stop());return}
      stream.current=media;setCamera(true);setDevice(media.getVideoTracks()[0].getSettings().deviceId??'')
      if(preview.current){preview.current.srcObject=media;await preview.current.play()}
      setNotice('')
    } catch {if(!active.current?.signal.aborted && token===cameraRequest.current)setNotice('연결된 카메라와 카메라 사용 권한을 확인해 주세요.')}
  }
  function confirmPhoto() {
    const v=preview.current
    if(!camera || !v?.videoWidth){setNotice('사진촬영 버튼을 먼저 눌러주세요.');return}
    const canvas=document.createElement('canvas');canvas.width=v.videoWidth;canvas.height=v.videoHeight
    const ctx=canvas.getContext('2d')
    if(!ctx)return
    ctx.drawImage(v,0,0);setPhotos([...photos,canvas.toDataURL('image/jpeg')]);stop();setNotice('')
  }
  async function submit(payload:Payload) {
    if(lock.current)return
    lock.current=true;setBusy(true);setProgress(0)
    const signal=active.current?.signal
    try {
      await pendingStore(key,'put',payload);if(signal?.aborted)return
      setPending(payload)
      const result=await new Promise<{status:number;code:string}>((resolve,reject)=>{
        const xhr=new XMLHttpRequest();request.current=xhr
        xhr.open('POST','/api/pop/rfid/'+('pictures' in payload?'boxes':'movements'))
        xhr.setRequestHeader('Content-Type','application/json')
        xhr.upload.onprogress=e=>{if(e.lengthComputable)setProgress(Math.round(e.loaded*100/e.total))}
        xhr.onload=()=>{try{resolve({status:xhr.status,code:JSON.parse(xhr.responseText).code})}catch{reject(Error())}}
        xhr.onerror=xhr.onabort=()=>reject(Error())
        xhr.send(JSON.stringify(payload))
      })
      if(signal?.aborted)return
      if(result.status===401){onSessionExpired();return}
      if(result.status>=500 || result.status===408 || result.status===429)throw Error()
      await pendingStore(key,'drop');if(signal?.aborted)return
      setPending(undefined)
      if(result.status<200 || result.status>=300){
        setNotice(({INVALID_SEQUENCE:'이미 같은 방향으로 처리되었습니다.',STALE_MATCH:'파렛트 매칭을 다시 확인해 주세요.',
          INVALID_CUSTOMER:'입출처를 선택해 주세요.',INVALID_PHOTO:'확정한 사진을 확인해 주세요.'} as Record<string,string>)[result.code]??'처리할 수 없습니다.');return
      }
      stop();setPhotos([]);setNumber('');setCustomer('');setReceipt('pictures' in payload?'save':payload.direction==='IN'?'in_complete':'out_complete')
      setNotice('pictures' in payload?'저장되었습니다.':payload.direction==='IN'?'입고처리 되었습니다.':'출고처리 되었습니다.')
      const r=await fetch('/api/pop/rfid/forms',{signal})
      if(r.status===401){onSessionExpired();return}
      if(r.ok){const d=await r.json() as Data;if(!signal?.aborted)setData(d)}
    } catch {if(!signal?.aborted)setNotice('저장 결과를 확인하지 못했습니다. 동일 요청을 재시도해 주세요.')}
    finally {lock.current=false;request.current=null;if(!signal?.aborted){setBusy(false);setProgress(undefined)}}
  }
  function save() {
    if(!current || !photos.length || !date) {setNotice('파렛트와 포장일을 확인하고 사진을 확정해 주세요.');return}
    void submit({requestId:crypto.randomUUID(),pallet:current.number,tag:current.tag,date,customer,pictures:photos})
  }
  function move(direction:'IN'|'OUT') {
    close()
    if(!box || !customer || !date) {setNotice('입출처와 RFID태그 ID를 입력해주세요.');return}
    void submit({requestId:crypto.randomUUID(),box:box.id,date,customer,direction})
  }
  const disabled=busy || !!pending
  return <section className="rf-form rf-op" aria-label={packing?'파렛트 적재':'입출고 수동등록'}>
    <div className="rf-op-head"><div className="rf-criteria">
      <Field label="파렛트 번호"><button aria-label="파렛트 번호" disabled={disabled} onClick={()=>open('number')}>{number || '조회 시 클릭!'}</button></Field>
      <Field label={packing?'포장일':'입출일'}><input type="date" value={date} disabled={disabled} onChange={e=>{stop();setPhotos([]);setDate(e.target.value)}}/></Field>
      <Field label="RFID 태그번호"><output>{current?.tagCode}</output></Field>
      <Field label={packing?'파렛트 유형':'입출시간'}><output>{packing?current?.master?.type:clock}</output></Field>
      <Field label="RFID 태그ID"><button aria-label="RFID 태그ID" disabled={disabled} onClick={()=>open('scan')}>{current?.tag || '파렛트를 조회 하려면 클릭해주세요!'}</button></Field>
      <Field label={packing?'출고처':'입출처'}><button aria-label={packing?'출고처':'입출처'} disabled={disabled} onClick={()=>open('customer')}>
        {data?.customers.find(c=>c.code===customer)?.name || customer || '조회하려면 클릭해주세요!'}</button></Field>
    </div><div className="rf-op-actions">{packing?<>
      <button className="rf-shoot" disabled={disabled} onClick={()=>void capture(false)}>사진 촬영</button>
      <button className="rf-packed" disabled={disabled} onClick={save}>저장</button>
      <button className="rf-query" disabled={disabled} onClick={confirmPhoto}>사진 확정</button>
      <button aria-label="카메라 전환" disabled={disabled} onClick={()=>void capture(true)}><img src={import.meta.env.BASE_URL + 'rfid/camera-turn.svg'} alt=""/></button></>:
      <>{(['IN','OUT'] as const).map(dir=><button key={dir} className={dir==='IN'?'rf-query':'rf-packed'}
        disabled={disabled || box?.latestDirection===dir} onClick={()=>open(dir)}>{dir==='IN'?'입고':'출고'}</button>)}</>}</div></div>
    <video ref={preview} hidden={!camera} playsInline muted/>
    {!camera && (photos.length>0?<img className="rf-proof" alt="확정한 사진" src={photos.at(-1)}/>:
      receipt?<img className="rf-proof" alt="처리 완료" src={asset(receipt)}/>:displayedBox?
      <BoxPhoto id={displayedBox.id} direction={packing?'':displayedBox.latestDirection}/>:null)}
    {progress!==undefined && <div className="rf-progress" role="dialog" aria-label="사진 전송 진행"><span>Please Wait</span>
      <small role="progressbar" aria-label="전송 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>진행률: {progress}%</small></div>}
    {pending && !busy && <button onClick={()=>void submit(pending)}>동일 명령 재시도</button>}
    {!modal && <p role="status">{notice}</p>}
    {modal && <dialog ref={dialog} className={"rf-dialog rf-dialog-" + modal} onClose={()=>setModal(undefined)} aria-label={modal==='customer'?'출고처 조회':modal==='number'?'파렛트 번호 입력':modal==='scan'?'RFID 스캔':'입출고 확인'}>
      {modal==='IN' || modal==='OUT'?<><p>{modal==='IN'?'입고':'출고'}처리 하시겠습니까?</p><button onClick={()=>move(modal)}>예</button></>:<>
        {modal==='customer' && <button className="rf-barcode-camera" aria-label="작업지시 바코드 카메라" onClick={()=>setBarcodeCamera(true)}>▣</button>}
        <label>{modal==='number'?'파렛트 번호':modal==='customer'?'작업지시 번호':'RFID 태그 ID'}<input placeholder={modal==='customer'?'작업지시 번호를 스캔해주세요.':undefined} autoFocus value={scanned} inputMode={modal==='number'?'numeric':'text'}
          maxLength={modal==='number'?8:undefined} onChange={e=>setScanned(modal==='number'?e.target.value.replace(/\D/g,''):e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter'&&!e.repeat&&!e.nativeEvent.isComposing){e.preventDefault();lookup()}}}/></label>
        {modal==='number' && <div className="rf-keys">{'1234567890'.split('').map(n=><button key={n} onClick={()=>setScanned((scanned+n).slice(0,8))}>{n}</button>)}
          <button className="rf-back" onClick={()=>setScanned(scanned.slice(0,-1))}>←</button><button className="rf-clear" onClick={()=>setScanned('')}>C</button></div>}
        <button hidden={modal !== 'number' && !scanned.trim()} className={modal === 'number' ? 'rf-apply' : 'rf-enter'} onClick={lookup}>적용</button></>}
      <button onClick={close}>{modal==='IN'||modal==='OUT'?'아니오':modal==='number'?'취소':'닫기'}</button><p role="status">{notice}</p></dialog>}
    {barcodeCamera && <RfidBarcodeCamera onRead={customerLookup} onClose={()=>setBarcodeCamera(false)}/>}
  </section>
}