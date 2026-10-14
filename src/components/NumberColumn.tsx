/**
 * A column of numbers typed the way Daily Entry's Output Batch column is typed.
 *
 * Enter drops to the next row, Shift+Enter goes back up, arrows do the same, and a column
 * pasted from Excel fills it in one go. Attendance and submitted totals are both "one
 * number per employee for the period", so they share this rather than growing two grids
 * that drift apart — the fifth invariant, that every new grid is as fast as Phase 1's.
 *
 * Values are held as text while typing so a half-typed "1." is not rounded to 1, and
 * committed by the parent on Save.
 */

import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { hasRow, nextRow } from '../domain/gridNav'
import { parseEmpIds } from '../domain/pasteEmpIds'
import { Icon, Tooltip } from './ui'

export interface NumberColumnRow {
  key: number
  label: ReactNode
  /** Shown under the label — grade, department, whatever identifies the row. */
  sub?: ReactNode
}

export function useNumberColumn(initial: Record<number, string>) {
  const [draft, setDraft] = useState<Record<number, string>>(initial)
  const [baseline, setBaseline] = useState<Record<number, string>>(initial)

  /** Reset when the period or the roster changes under us. */
  const reset = (next: Record<number, string>) => {
    setDraft(next)
    setBaseline(next)
  }

  const changed = Object.keys(draft).filter((key) => draft[Number(key)] !== baseline[Number(key)]).map(Number)

  return { draft, setDraft, baseline, reset, changed }
}

export function NumberColumn({
  rows,
  draft,
  onChange,
  heading,
  unit,
  disabled,
  disabledReason,
  max,
  invalid,
}: {
  rows: NumberColumnRow[]
  draft: Record<number, string>
  onChange: (key: number, value: string) => void
  heading: string
  unit?: string
  disabled?: boolean
  disabledReason?: string
  max?: number
  /** Returns a reason the typed value is wrong, or null. */
  invalid?: (value: string) => string | null
}) {
  const refs = useRef<Map<number, HTMLInputElement>>(new Map())
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteResult, setPasteResult] = useState<string | null>(null)

  const order = rows.map((row) => row.key)

  const step = (from: number, delta: number) => {
    const next = nextRow(order, from, delta)
    const element = next === null ? undefined : refs.current.get(next)
    if (element) {
      element.focus()
      element.select()
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, key: number) => {
    switch (event.key) {
      case 'Enter':
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault()
        step(key, event.key === 'ArrowUp' || (event.key === 'Enter' && event.shiftKey) ? -1 : 1)
        break
      case 'Tab': {
        const delta = event.shiftKey ? -1 : 1
        if (hasRow(order, key, delta)) {
          event.preventDefault()
          step(key, delta)
        }
        break
      }
      default:
        break
    }
  }

  /**
   * Two columns pasted from Excel — Emp ID then the number. Matching on Emp ID rather than
   * on row position means a sheet sorted differently still lands on the right people, which
   * is the mistake that would otherwise be invisible.
   */
  const applyPaste = (text: string) => {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    const known = new Set(order)
    let matched = 0
    let unknown = 0
    const next: Record<number, string> = {}

    for (const line of lines) {
      const parts = line.split(/[\t,;]+/).map((part) => part.trim()).filter(Boolean)
      if (parts.length < 2) continue
      const { ids } = parseEmpIds(parts[0])
      const empId = ids[0]
      const value = parts[1].replace(/[^0-9.-]/g, '')
      if (empId === undefined || value === '') continue
      if (!known.has(empId)) {
        unknown += 1
        continue
      }
      next[empId] = value
      matched += 1
    }

    if (matched === 0) {
      setPasteResult('No rows matched. Paste two columns: Emp ID, then the number.')
      return
    }
    for (const [key, value] of Object.entries(next)) onChange(Number(key), value)
    setPasteResult(`${matched} filled in${unknown > 0 ? `, ${unknown} Emp ID${unknown === 1 ? '' : 's'} not on the list` : ''}.`)
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-ink-900">{heading}</h3>
        {!disabled && (
          <button type="button" className="btn btn-default btn-sm" onClick={() => setPasteOpen((open) => !open)} aria-expanded={pasteOpen}>
            <Icon name="clipboard" className="h-3.5 w-3.5" /> Paste from Excel
          </button>
        )}
      </div>

      {pasteOpen && !disabled && (
        <div className="border-b border-ink-200 bg-ink-50 p-3">
          <p className="mb-1.5 text-xs text-ink-600">
            Two columns — Emp ID, then the number. Matched on Emp ID, so the order does not matter.
          </p>
          <textarea
            className="input min-h-20 font-mono text-xs"
            value={pasteText}
            placeholder={`1295\t2\n2901\t0`}
            onChange={(event) => setPasteText(event.target.value)}
            spellCheck={false}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => applyPaste(pasteText)}>
              Fill in
            </button>
            {pasteResult && <span className="text-xs text-ink-600">{pasteResult}</span>}
          </div>
        </div>
      )}

      <div className="max-h-[32rem] overflow-auto scroll-slim">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th scope="col" className="th sticky top-0 bg-ink-50 w-20">Emp ID</th>
              <th scope="col" className="th sticky top-0 bg-ink-50">Employee</th>
              <th scope="col" className="th sticky top-0 bg-ink-50 w-40 text-right">{unit ?? 'Value'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const value = draft[row.key] ?? ''
              const problem = invalid?.(value) ?? null
              return (
                <tr key={row.key}>
                  <td className="td num text-ink-700">{row.key}</td>
                  <td className="td">
                    <div className="font-medium text-ink-900">{row.label}</div>
                    {row.sub && <div className="text-xs text-ink-500">{row.sub}</div>}
                  </td>
                  <td className="td">
                    {disabled ? (
                      <Tooltip label={disabledReason ?? ''}>
                        <span className="block text-right font-mono tabular-nums text-ink-600">{value || '—'}</span>
                      </Tooltip>
                    ) : (
                      <Tooltip label={problem ?? ''}>
                        <input
                          ref={(element) => {
                            if (element) refs.current.set(row.key, element)
                            else refs.current.delete(row.key)
                          }}
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          min="0"
                          max={max}
                          className={`input py-1 text-right font-mono tabular-nums ${problem ? 'input-error' : ''}`}
                          value={value}
                          aria-label={`${heading} for ${row.key}`}
                          onKeyDown={(event) => onKeyDown(event, row.key)}
                          onFocus={(event) => event.target.select()}
                          onWheel={(event) => event.currentTarget.blur()}
                          onChange={(event) => onChange(row.key, event.target.value)}
                        />
                      </Tooltip>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
