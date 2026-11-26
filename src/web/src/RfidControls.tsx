import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
const imgUrl = (id: string) => '/api/pop/rfid/boxes/' + encodeURIComponent(id) + '/picture'
const asset = (name: string) => import.meta.env.BASE_URL + 'rfid/' + name + '.png'
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="rf-field"><span>{label}</span>{children}</label>
}
export function BoxPhoto({ id, direction }: { id: string; direction?: string }) {
  const [size,setSize] = useState({width:640,height:480})
  const style = {'--image-ratio':size.width/size.height,'--stamp-width':(150/size.width)*100+'%'} as CSSProperties
  return <div className="rf-image" style={style}><img src={imgUrl(id)} alt="파렛트 포장 사진"
    onLoad={e => setSize({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})}/>
    {direction && <img className="rf-stamp" src={asset(direction === 'IN' ? 'Pallet_In' : 'Pallet_Out')} alt={direction === 'IN' ? '입고' : '출고'}/>}</div>
}
