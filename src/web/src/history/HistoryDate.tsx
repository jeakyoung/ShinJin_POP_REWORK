import { useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { createPortal } from 'react-dom'

import { localDate } from './localDate'

type Level = 'day' | 'month' | 'year' | 'decade'

// Set the full year explicitly because the multi-argument Date constructor treats 0–99 as 1900–1999.
function calendarDate(year: number, month: number, day: number) {
  const result = new Date(2000, 0, 1)
  result.setFullYear(year, month, day)
  return result
}

function Calendar({
  value,
  anchor,
  label,
  choose,
  close,
}: {
  value: string
  anchor: RefObject<HTMLButtonElement | null>
  label: string
  choose: (day: string) => void
  close: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [year0, month0] = value.split('-').map(Number)
  const [page, setPage] = useState(calendarDate(year0, month0 - 1, 1))
  const [level, setLevel] = useState<Level>('day')
  useLayoutEffect(() => {
    const dialog = ref.current
    if (!dialog || !anchor.current) return
    dialog.showModal()
    const place = () => {
      const box = anchor.current!.getBoundingClientRect()
      dialog.style.left = Math.max(0, Math.min(box.left, innerWidth - dialog.offsetWidth)) + 'px'
      dialog.style.top = Math.max(0, Math.min(box.bottom, innerHeight - dialog.offsetHeight)) + 'px'
    }
    place()
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('resize', place)
      dialog.close()
    }
  }, [anchor])
  const y = page.getFullYear(),
    m = page.getMonth()
  const startYear = level === 'decade' ? Math.floor(y / 100) * 100 - 10 : Math.floor(y / 10) * 10 - 1
  function move(direction: number) {
    const months = { day: 1, month: 12, year: 120, decade: 1200 }
    const next = calendarDate(y, m + direction * months[level], 1)
    if (next.getFullYear() >= 1 && next.getFullYear() <= 9999) setPage(next)
  }
  return (
    <dialog
      className="history-calendar"
      ref={ref}
      aria-label={label + ' 달력'}
      onCancel={close}
      onClick={(e) => {
        if (e.target === ref.current) {
          const r = e.currentTarget.getBoundingClientRect()
          if (e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom)
            close()
        }
      }}
    >
      <div className="history-month">
        <button
          type="button"
          onClick={() =>
            setLevel(({ day: 'month', month: 'year', year: 'decade', decade: 'decade' } as const)[level])
          }
        >
          {m + 1}월 {y}
        </button>
        <button aria-label="이전" type="button" onClick={() => move(-1)}>
          ⌃
        </button>
        <button aria-label="다음" type="button" onClick={() => move(1)}>
          ⌄
        </button>
      </div>
      {level === 'day' && (
        <div className="history-week" aria-hidden="true">
          {[...'일월화수목금토'].map((n) => (
            <span key={n}>{n}</span>
          ))}
        </div>
      )}
      <div className={'history-days ' + (level === 'day' ? '' : 'history-periods')}>
        {level === 'day'
          ? Array.from({ length: 42 }, (_, i) => {
              const date = calendarDate(y, m, 1 - page.getDay() + i),
                key = localDate(date)
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={key}
                  disabled={date.getFullYear() < 1 || date.getFullYear() > 9999}
                  aria-pressed={key === value}
                  data-muted={date.getMonth() !== m}
                  onClick={() => choose(key)}
                >
                  {date.getDate()}
                </button>
              )
            })
          : Array.from({ length: 12 }, (_, i) => {
              const start = level === 'month' ? i + 1 : startYear + i * (level === 'decade' ? 10 : 1)
              const text = level === 'decade' ? start + '-' + (start + 9) : String(start)
              const current = level === 'month' ? m + 1 : level === 'year' ? y : Math.floor(y / 10) * 10
              return (
                <button
                  key={start}
                  type="button"
                  disabled={level !== 'month' && (start + (level === 'decade' ? 9 : 0) < 1 || start > 9999)}
                  aria-pressed={start === current}
                  data-muted={level !== 'month' && (i === 0 || i === 11)}
                  onClick={() => {
                    if (level === 'month') {
                      setPage(calendarDate(y, i, 1))
                      setLevel('day')
                    } else {
                      setPage(calendarDate(Math.max(1, start), m, 1))
                      setLevel(level === 'year' ? 'month' : 'year')
                    }
                  }}
                >
                  {text}
                </button>
              )
            })}
      </div>
      <button className="history-today" type="button" onClick={() => choose(localDate(new Date()))}>
        Today
      </button>
    </dialog>
  )
}

export default function HistoryDate({
  value, onChange, label = '수주일', id, disabled = false, className = 'history-date',
}: {
  value: string
  onChange: (value: string) => void
  label?: string
  id?: string
  disabled?: boolean
  className?: string
}) {
  const [opened, setOpened] = useState<{host:Element;day:string} | null>(null)
  const anchor = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        type="button"
        id={id}
        className={className}
        ref={anchor}
        disabled={disabled}
        aria-label={label + ' ' + value}
        aria-haspopup="dialog"
        aria-expanded={!!opened}
        onClick={event => setOpened({host:event.currentTarget.closest('main.pop-shell') ?? document.body,day:value || localDate(new Date())})}
      >
        {value}
        <span aria-hidden="true">▾</span>
      </button>
      {opened && createPortal(
        <Calendar
          value={opened.day}
          anchor={anchor}
          label={label}
          close={() => setOpened(null)}
          choose={(day) => {
            onChange(day)
            setOpened(null)
          }}
        />,
        opened.host
      )}
    </>
  )
}
