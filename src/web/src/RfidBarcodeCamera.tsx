import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export default function RfidBarcodeCamera({ onRead, onClose }: { onRead: (value: string) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const callback = useRef(onRead)
  const [notice,setNotice] = useState('')
  useLayoutEffect(() => { callback.current = onRead }, [onRead])
  useEffect(() => {
    let active = true
    let current: MediaStream | undefined
    let timer: number | undefined
    dialog.current?.showModal()
    async function read() {
      const [zxing, devices] = await Promise.all([import('@zxing/library'), navigator.mediaDevices.enumerateDevices()])
      if (!active) return
      const cameras = devices.filter(d => d.kind === 'videoinput')
      if (!cameras.length) throw Error()
      const id = cameras[cameras.length === 1 ? 0 : 1].deviceId
      current = await navigator.mediaDevices.getUserMedia({video:id ? {deviceId:{exact:id}} : true,audio:false})
      if (!active || !video.current) {current.getTracks().forEach(t => t.stop());return}
      const source = video.current
      source.srcObject = current
      await source.play()
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d',{willReadFrequently:true})
      const reader = new zxing.MultiFormatReader()
      function frame() {
        if (!active || !ctx) return
        if (source.videoWidth && source.videoHeight) {
          canvas.width = source.videoWidth
          canvas.height = source.videoHeight
          ctx.drawImage(source,0,0)
          const pixels = ctx.getImageData(0,0,canvas.width,canvas.height).data
          const luminance = new Uint8ClampedArray(canvas.width * canvas.height)
          for (let i=0; i<luminance.length; i++) {
            const j=i*4
            luminance[i]=(pixels[j]+pixels[j+1]*2+pixels[j+2]) >> 2
          }
          const bitmap = new zxing.BinaryBitmap(new zxing.HybridBinarizer(new zxing.RGBLuminanceSource(luminance,canvas.width,canvas.height)))
          try {
            const found = reader.decode(bitmap).getText()
            if (found) {callback.current(found);return}
          } catch (error) {
            if (!(error instanceof zxing.ReaderException)) {setNotice('카메라 영상을 읽지 못했습니다.');return}
          } finally {reader.reset()}
        }
        timer=window.setTimeout(frame,180)
      }
      frame()
    }
    read().catch(()=>{if (active) setNotice('웹캠을 찾을 수 없습니다. 카메라 연결과 사용 권한을 확인해 주세요.')})
    return () => {active=false;clearTimeout(timer);current?.getTracks().forEach(t=>t.stop())}
  }, [])
  return <dialog ref={dialog} className="rf-dialog rf-dialog-photo rf-camera-dialog" aria-label="작업지시 바코드 촬영" onClose={onClose}>
    <video ref={video} autoPlay muted playsInline aria-label="작업지시 바코드 영상"/>
    {notice && <p role="status">{notice}</p>}<button onClick={onClose}>닫기</button>
  </dialog>
}