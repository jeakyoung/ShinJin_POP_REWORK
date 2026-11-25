import { useEffect, useRef, useState } from 'react'
import { getSessionData, SessionExpired } from '../workHistoryApi'
import './outputPreview.css'

type Example = { id: string; step: number; label: string }
type Text = { x: number; y: number; size: number; color: string; text: string }
type Block = { x: number; y: number; width: number; height: number; color: string }
type PreviewPage = { width: number; height: number; texts: Text[]; blocks: Block[] }
type Contract = {
  status: string; documentRef: string | null; device: string | null; pages: number; preview: PreviewPage[]
}

const apiPath = '/api/demo/output'
const messages: Record<string, string> = {
  EMPTY_SELECTION: '출력할 행을 선택하세요.',
  UNKNOWN_FORM: '지원하지 않는 출력 양식입니다.',
  INVALID_INPUT: '필수 출력 정보가 누락됐거나 올바르지 않습니다.',
  RENDER_FAILED: '미리보기와 PDF를 생성하지 못했습니다.',
  FONT_NOT_CONFIGURED: '한글 출력 글꼴이 설정되지 않았습니다. 로컬 글꼴 설정을 확인하세요.',
  FONT_UNAVAILABLE: '설정된 한글 출력 글꼴 파일을 열 수 없습니다. 로컬 경로를 확인하세요.',
}
const key = ({ id, step }: Example) => id + '/' + step

export default function OutputPreview({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [examples, setExamples] = useState<Example[]>()
  const [choice, setChoice] = useState('')
  const [selected, setSelected] = useState<string>()
  const [request, setRequest] = useState(0)
  const [output, setOutput] = useState<Contract>()
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const activeDownload = useRef<AbortController | null>(null)

  useEffect(() => () => activeDownload.current?.abort(), [])

  useEffect(() => {
    const controller = new AbortController()
    getSessionData<Example[]>(apiPath, controller.signal).then((data) => {
      if (controller.signal.aborted) return
      setExamples(data)
      setChoice(data.length ? key(data[0]) : '')
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return
      if (failure instanceof SessionExpired) onSessionExpired()
      else setError('합성 출력 예제를 조회하지 못했습니다.')
    })
    return () => controller.abort()
  }, [onSessionExpired])

  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    getSessionData<Contract>(apiPath + '/' + selected, controller.signal).then((data) => {
      if (!controller.signal.aborted) setOutput(data)
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return
      if (failure instanceof SessionExpired) onSessionExpired()
      else setError('미리보기를 조회하지 못했습니다.')
    })
    return () => controller.abort()
  }, [onSessionExpired, request, selected])

  async function download() {
    if (!selected || activeDownload.current) return
    const controller = new AbortController()
    activeDownload.current = controller
    setDownloading(true)
    setError('')
    try {
      const response = await fetch(apiPath + '/' + selected + '/pdf', { signal: controller.signal, cache: 'no-store' })
      if (response.status === 401) {
        onSessionExpired()
        return
      }
      if (response.status === 422) {
        const result: Contract = await response.json()
        if (!controller.signal.aborted) setOutput(result)
        return
      }
      if (!response.ok || response.headers.get('Content-Type') !== 'application/pdf') throw new Error('PDF unavailable')
      const file = await response.blob()
      if (controller.signal.aborted) return
      const url = URL.createObjectURL(file)
      const link = document.createElement('a')
      link.href = url
      link.download = selected.split('/')[0] + '.pdf'
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      if (!controller.signal.aborted) setError('PDF를 다운로드하지 못했습니다.')
    } finally {
      if (activeDownload.current === controller) {
        activeDownload.current = null
        if (!controller.signal.aborted) setDownloading(false)
      }
    }
  }

  return (
    <section className="synthetic-output" aria-label="합성 출력 미리보기">
      <h2>합성 출력 미리보기</h2>
      {examples && (
        <form onSubmit={(event) => {
          event.preventDefault()
          activeDownload.current?.abort()
          activeDownload.current = null
          setDownloading(false)
          setOutput(undefined)
          setError('')
          setSelected(choice)
          setRequest((value) => value + 1)
        }}>
          <label>출력 예제
            <select value={choice} onChange={(event) => setChoice(event.target.value)}>
              {examples.map((example) => <option key={key(example)} value={key(example)}>{example.label}</option>)}
            </select>
          </label>
          <button type="submit" disabled={!choice}>미리보기</button>
        </form>
      )}
      {error && <p role="status">{error}</p>}
      {!error && selected && !output && <p role="status">미리보기를 생성하고 있습니다.</p>}
      {output && output.status !== 'PDF_READY' && (
        <p role="status">{messages[output.status] ?? '출력 결과를 확인하세요.'}</p>
      )}
      {output?.status === 'PDF_READY' && (
        <>
          <div className="synthetic-output__meta">
            <span>{output.documentRef} · {output.device} · {output.pages}페이지</span>
            <button type="button" disabled={downloading} onClick={() => void download()}>PDF 다운로드</button>
          </div>
          <div className="synthetic-output__pages">
            {output.preview.map((page, index) => (
              <svg key={index} role="img" aria-label={`페이지 ${index + 1}`}
                width={page.width} height={page.height} viewBox={`0 0 ${page.width} ${page.height}`}>
                {page.blocks.map((mark, i) => <rect key={i} x={mark.x} y={mark.y} width={mark.width}
                  height={mark.height} fill={mark.color} shapeRendering={mark.color === '#000000' ? 'crispEdges' : undefined} />)}
                {page.texts.map((mark, i) => <text key={i} x={mark.x} y={mark.y} fontSize={mark.size} fill={mark.color}>{mark.text}</text>)}
              </svg>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
