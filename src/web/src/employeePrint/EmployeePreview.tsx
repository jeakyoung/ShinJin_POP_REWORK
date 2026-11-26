import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { assets } from './contract'
import type { Report, Request } from './contract'

type ToolProps = { name: string; left: number; width: number; top?: number; disabled?: boolean; onClick: () => void }
function Tool({ name, left, width, top = 52, disabled, onClick }: ToolProps) {
  const nav=left>=432 && left<=513 && !disabled && top===52
  return <button title={name} aria-label={name} disabled={disabled} onClick={onClick}><span aria-hidden="true" style={{
    width,height:top===1?30:26,backgroundImage:'url('+assets+(nav?'navigation.png':'preview-toolbar.png')+')',
    backgroundPosition:nav?(432-left)+'px 0':(-left)+'px '+(-top)+'px'
  }}/></button>
}

function InactiveStrip({left,width,name}:{left:number;width:number;name:string}) {
  return <span role="img" aria-label={name+' (연동 대기)'} title={name+' (연동 대기)'} className="employee-inactive"
    style={{width,backgroundImage:'url('+assets+'preview-toolbar.png)',backgroundPosition:(-left)+'px -52px'}} />
}
export default function EmployeePreview({ report, request, onClose }: { report: Report; request: Request; onClose: () => void }) {
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(100)
  const [loaded, setLoaded] = useState<{ page: number; url: string }>()
  const [status, setStatus] = useState('')
  const [sending, setSending] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [pageError, setPageError] = useState(false)
  const key = useRef(report.printKey)
  const printing = useRef(false)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let active = true
    let url: string | undefined
    request('/preview/' + report.id + '/' + page).then(async response => {
      if (response.headers.get('Content-Type')?.split(';')[0] !== 'image/svg+xml') throw new Error('image format')
      const blob = await response.blob()
      if (!active) return
      url = URL.createObjectURL(blob)
      const image = new Image()
      image.src = url
      await image.decode()
      if (active) setLoaded({ page, url })
    }).catch(() => { if (active) setPageError(true) })
    return () => { active = false; if (url) URL.revokeObjectURL(url) }
  }, [page, report.id, request, attempt])

  function goToPage(next: number) {
    if (next === page) return
    setPageError(false); setLoaded(undefined); setPage(next)
  }

  async function quickPrint() {
    if (printing.current || loaded?.page !== page) return
    printing.current = true; setSending(true); setStatus('')
    try {
      const receipt = await (await request('/preview/' + report.id + '/print', 'POST', { key: key.current })).json()
      if (!mounted.current) return
      key.current = receipt.nextKey
      setStatus('합성 출력 접수 · ' + receipt.printer + ' · ' + receipt.pages + '쪽')
    } catch (error) {
      if (mounted.current) setStatus((error as Error).message === '422'
        ? 'Printer1 설정을 적용한 후 미리보기를 다시 여십시오.' : '출력 접수를 확인하지 못했습니다.')
    }
    finally { printing.current = false; if (mounted.current) setSending(false) }
  }

  return <Modal label="Preview" className={'employee-preview' + (maximized ? ' expanded' : '')} onClose={() => { if (!sending) onClose() }}>
    <div className="employee-chrome"><div className="employee-preview-title"><span>Preview</span>
      <Tool name="Maximize" left={645} width={42} onClick={() => setMaximized(v => !v)} top={1} />
      <Tool name="Close Preview" left={691} width={44} onClick={onClose} disabled={sending} top={1} /></div>
      <div className="employee-preview-menu" aria-label="원본 미리보기 메뉴">File　 View　 Background</div>
      <div className="employee-preview-actions"><InactiveStrip left={0} width={150} name="문서 탐색·열기·저장·인쇄 설정"/>
      <Tool name="Quick Print" left={150} width={24} onClick={() => void quickPrint()} disabled={!report.diagnostic || sending || loaded?.page !== page} />
      <InactiveStrip left={174} width={124} name="페이지 설정·보기 도구"/>
      <Tool name="Zoom Out" left={298} width={29} onClick={() => setZoom(v => Math.max(10, v - (v >= 100 ? 10 : 5)))} disabled={zoom <= 10} />
      <input aria-label="Zoom" value={zoom + '%'} list="employee-zoom" onChange={e => {
        const value = Number.parseInt(e.target.value, 10)
        if (value >= 10 && value <= 500) setZoom(value)
      }} />
      <datalist id="employee-zoom">{[50,75,100,125,150,200].map(n => <option key={n} value={n + '%'} />)}</datalist>
      <Tool name="Zoom In" left={402} width={28} onClick={() => setZoom(v => Math.min(500, v + (v >= 100 ? 10 : 5)))} disabled={zoom >= 500} />
      <Tool name="First Page" left={432} width={27} onClick={() => goToPage(1)} disabled={page === 1} />
      <Tool name="Previous Page" left={459} width={27} onClick={() => goToPage(page - 1)} disabled={page === 1} />
      <Tool name="Next Page" left={486} width={27} onClick={() => goToPage(page + 1)} disabled={page === report.pages} />
      <Tool name="Last Page" left={513} width={26} onClick={() => goToPage(report.pages)} disabled={page === report.pages} />
      <InactiveStrip left={539} width={199} name="페이지 보기·내보내기·메일"/></div></div>
    <div className="employee-paper" aria-label="미리보기 페이지">
      {loaded?.page === page ? <img alt={'A4 ' + page + '쪽'} style={{ width: (210 * zoom / 100) + 'mm' }} src={loaded.url} />
        : pageError && <button onClick={() => { setPageError(false); setAttempt(a => a + 1) }}>다시 불러오기</button>}
    </div>
    <footer><span>Page {page} of {report.pages}</span><output aria-live="polite">{pageError ? '페이지를 열지 못했습니다.' : status}</output><span>{zoom}%</span></footer>
  </Modal>
}
