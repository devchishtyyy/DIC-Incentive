/**
 * Daily score trend — one employee, one period.
 *
 * A single series, so the form is a plain line: one hue, no legend (the title names it),
 * selective direct labels and a hover crosshair with a tooltip. Days with no entry break
 * the line rather than dropping to zero, because a missing day is not a zero. The entry
 * table beside the chart is the table view of the same data.
 */

import { useLayoutEffect, useRef, useState } from 'react'
import { formatDate, formatDayShort } from '../domain/dates'
import { formatScore } from '../domain/format'
import { useApp } from '../store/AppStore'

export interface TrendPoint {
  date: string
  score: number | null
  entryCount: number
}

const HEIGHT = 220
const PAD = { top: 14, right: 16, bottom: 30, left: 34 }

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(640)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(320, entry.contentRect.width)))
    observer.observe(element)
    setWidth(Math.max(320, element.clientWidth))
    return () => observer.disconnect()
  }, [])

  return [ref, width] as const
}

export function TrendChart({ points, title }: { points: TrendPoint[]; title: string }) {
  const { state } = useApp()
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)

  const cap = state.settings.scoreCap
  const plotWidth = Math.max(10, width - PAD.left - PAD.right)
  const plotHeight = HEIGHT - PAD.top - PAD.bottom

  if (points.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-sm text-ink-500">
        No scored days in this period, so there is nothing to plot.
      </div>
    )
  }

  const stepX = points.length > 1 ? plotWidth / (points.length - 1) : 0
  const x = (index: number) => PAD.left + (points.length > 1 ? index * stepX : plotWidth / 2)
  const y = (score: number) => PAD.top + plotHeight - (Math.min(score, cap) / cap) * plotHeight

  // Break the line wherever a day has no score.
  const segments: Array<Array<{ index: number; score: number }>> = []
  let current: Array<{ index: number; score: number }> = []
  points.forEach((point, index) => {
    if (point.score === null) {
      if (current.length > 0) segments.push(current)
      current = []
    } else {
      current.push({ index, score: point.score })
    }
  })
  if (current.length > 0) segments.push(current)

  const yTicks = [0, cap / 4, cap / 2, (cap * 3) / 4, cap]
  const labelEvery = Math.max(1, Math.ceil(points.length / 8))
  const hovered = hover !== null ? points[hover] : null

  const onMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const offset = event.clientX - rect.left - PAD.left
    const index = stepX > 0 ? Math.round(offset / stepX) : 0
    setHover(Math.min(points.length - 1, Math.max(0, index)))
  }

  return (
    <div ref={ref} className="relative">
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`${title}. ${points.filter((p) => p.score !== null).length} scored days out of ${points.length} working days.`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        className="block"
      >
        {/* Grid */}
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} stroke="var(--color-ink-200)" strokeWidth="1" />
            <text x={PAD.left - 6} y={y(tick) + 3.5} textAnchor="end" className="fill-ink-500" fontSize="10">
              {tick}
            </text>
          </g>
        ))}

        {/* Band thresholds — the same 12 / 17 the scorecard colours by */}
        {[state.settings.bandLow, state.settings.bandHigh].map((band) => (
          <line
            key={band}
            x1={PAD.left}
            x2={width - PAD.right}
            y1={y(band)}
            y2={y(band)}
            stroke="var(--color-ink-300)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        ))}

        {/* Series */}
        {segments.map((segment, index) => (
          <polyline
            key={index}
            fill="none"
            stroke="var(--color-brand-600)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={segment.map((p) => `${x(p.index)},${y(p.score)}`).join(' ')}
          />
        ))}

        {points.map((point, index) =>
          point.score === null ? null : (
            <circle
              key={point.date}
              cx={x(index)}
              cy={y(point.score)}
              r={hover === index ? 5 : 3}
              fill="var(--color-brand-600)"
              stroke="white"
              strokeWidth="2"
            />
          ),
        )}

        {/* Crosshair */}
        {hovered && (
          <line x1={x(hover!)} x2={x(hover!)} y1={PAD.top} y2={PAD.top + plotHeight} stroke="var(--color-ink-400)" strokeWidth="1" strokeDasharray="2 2" />
        )}

        {/* Axis */}
        <line x1={PAD.left} x2={width - PAD.right} y1={PAD.top + plotHeight} y2={PAD.top + plotHeight} stroke="var(--color-ink-300)" strokeWidth="1" />
        {points.map((point, index) =>
          index % labelEvery === 0 ? (
            <text key={point.date} x={x(index)} y={HEIGHT - 10} textAnchor="middle" className="fill-ink-500" fontSize="10">
              {formatDayShort(point.date)}
            </text>
          ) : null,
        )}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute z-10 w-max max-w-56 rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-xs shadow-lg"
          style={{
            left: Math.min(Math.max(x(hover!) - 60, 0), Math.max(0, width - 150)),
            top: hovered.score === null ? PAD.top : Math.max(0, y(hovered.score) - 62),
          }}
          role="status"
        >
          <div className="font-semibold text-ink-800">{formatDate(hovered.date)}</div>
          <div className="mt-0.5 text-ink-600">
            {hovered.score === null ? (
              'No entry — not counted as a zero'
            ) : (
              <>
                Score <span className="font-mono font-semibold text-ink-900">{formatScore(hovered.score)}</span> / {cap}
                {hovered.entryCount > 1 && <div className="text-ink-500">average of {hovered.entryCount} rows</div>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * A horizontal magnitude bar — used for average score by area. One hue, direct-labelled,
 * so no legend and no colour-only meaning.
 */
export function MeterBar({ value, max, label, caption }: { value: number | null; max: number; label: string; caption?: string }) {
  const pct = value === null ? 0 : Math.min(100, Math.max(0, (value / max) * 100))
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-ink-700">{label}</span>
        <span className="font-mono font-semibold tabular-nums text-ink-900">{formatScore(value)}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-sm bg-ink-200">
        <div className="h-full rounded-r-sm bg-brand-600" style={{ width: `${pct}%` }} />
      </div>
      {caption && <p className="mt-0.5 text-xs text-ink-500">{caption}</p>}
    </div>
  )
}
