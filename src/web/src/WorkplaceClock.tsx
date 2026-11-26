import { useEffect, useState } from 'react'

export default function WorkplaceClock() {
  const [date1, setDate1] = useState('-')

  useEffect(() => {
    const controller = new AbortController()
    let loading = false
    async function refresh() {
      if (loading) return
      loading = true
      try {
        const response = await fetch('/api/pop/workplace/time', { signal: controller.signal, cache: 'no-store' })
        if (response.ok) {
          const clock = await response.json() as { date1: string }
          if (!controller.signal.aborted) setDate1(clock.date1)
        }
      } catch {
        // frmMain leaves the last displayed server value in place when a read fails.
      } finally {
        loading = false
      }
    }
    void refresh()
    const timer = window.setInterval(refresh, 1000)
    return () => {
      window.clearInterval(timer)
      controller.abort()
    }
  }, [])

  return <time className="workplace-clock" aria-label="현재 시각">{date1}</time>
}
