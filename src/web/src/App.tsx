import { useEffect, useState } from 'react'

const areas = [
  ['공통', '로그인 · POP 단말 설정 · 공정별 메뉴'],
  ['생산', '작업지시 · 생산실적 · 도면가공 · 포장'],
  ['물류', '재고 · 공장이송 · 출하 · 더존 연동'],
  ['출력 · 현장 장비', '작업지시서 · 라벨 · QR · RFID'],
]

export default function App() {
  const [status, setStatus] = useState('확인 중')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function checkApi() {
      try {
        const response = await fetch('/api/health/live', { signal: controller.signal })
        if (!response.ok) throw new Error('API unavailable')
        const body: unknown = await response.json()
        if (!body || typeof body !== 'object' || !('status' in body) || body.status !== 'ok') {
          throw new Error('Unexpected API response')
        }
        setStatus('정상')
      } catch {
        if (!controller.signal.aborted) setStatus('연결할 수 없음')
      }
    }

    void checkApi()
    return () => controller.abort()
  }, [attempt])

  return (
    <main>
      <header>
        <h1>신진 생산관리</h1>
        <p>POP 전환 개발 환경</p>
      </header>
      <section aria-labelledby="api-title" className="connection">
        <div>
          <h2 id="api-title">API 연결</h2>
          <p aria-live="polite">{status}</p>
        </div>
        <button onClick={() => {
          setStatus('확인 중')
          setAttempt((value) => value + 1)
        }}>다시 확인</button>
      </section>
      <section aria-labelledby="areas-title">
        <h2 id="areas-title">전환 범위</h2>
        <ul>
          {areas.map(([name, description]) => (
            <li key={name}><strong>{name}</strong><span>{description}</span></li>
          ))}
        </ul>
      </section>
    </main>
  )
}
