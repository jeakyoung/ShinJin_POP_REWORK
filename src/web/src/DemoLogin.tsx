import { useState } from 'react'
import type { FormEvent } from 'react'
import { signIn } from './workHistoryApi'
import type { Identity, PopContext } from './workHistoryApi'

export default function DemoLogin({ context, onLogin }: { context: PopContext; onLogin: (identity: Identity) => void }) {
  const [terminalId, setTerminalId] = useState(context.terminals[0]?.id ?? '')
  const [method, setMethod] = useState<'manual' | 'scan'>('manual')
  const [identifier, setIdentifier] = useState('')
  const [passcode, setPasscode] = useState('')
  const [status, setStatus] = useState('')
  const [pending, setPending] = useState(false)
  const terminal = context.terminals.find((item) => item.id === terminalId)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setStatus('')
    try {
      onLogin(await signIn({ terminalId, method, identifier, passcode }))
    } catch {
      setStatus('로그인하지 못했습니다. 단말과 샘플 입력을 확인해 주세요.')
    } finally {
      setPending(false)
    }
  }

  return (
    <section aria-labelledby="login-title">
      <h2 id="login-title">작업자 로그인</h2>
      <form onSubmit={submit}>
        <fieldset disabled={pending}>
          <label>POP 단말
            <select value={terminalId} onChange={(event) => {
              setTerminalId(event.target.value)
              setIdentifier('')
            }}>
              {context.terminals.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>입력 방식
            <select value={method} onChange={(event) => {
              setMethod(event.target.value === 'scan' ? 'scan' : 'manual')
              setIdentifier('')
              setPasscode('')
            }}>
              <option value="manual">수동 입력</option>
              <option value="scan">스캔 입력</option>
            </select>
          </label>
          <label>{method === 'scan' ? '샘플 스캔 코드' : '작업자 ID'}
            <input required maxLength={64} autoComplete="off" value={identifier}
              onChange={(event) => setIdentifier(event.target.value)} />
          </label>
          {method === 'manual' && (
            <label>샘플 암호
              <input required type="password" autoComplete="off" maxLength={64} value={passcode}
                onChange={(event) => setPasscode(event.target.value)} />
            </label>
          )}
          <button disabled={!terminal}>로그인</button>
        </fieldset>
      </form>
      {terminal && (
        <p className="context">
          샘플 입력 {terminal.workers.map((worker) => method === 'scan' ? `SCAN:${worker.id}` : worker.id).join(', ')}
          {method === 'manual' && ' · 샘플 암호 demo-only'}
        </p>
      )}
      {status && <p role="alert">{status}</p>}
    </section>
  )
}
