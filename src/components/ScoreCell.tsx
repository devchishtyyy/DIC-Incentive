/**
 * The score colour scale, in one place so the Daily Entry, the Scorecard and the
 * Employee Detail always agree: red below 12, amber 12 to 17, green above 17, grey for
 * no entry. Colour is never the only signal — the number is always shown.
 */

import type { AppSettings } from '../config/policy'
import { formatScore } from '../domain/format'
import { useApp } from '../store/AppStore'

export type ScoreBand = 'none' | 'low' | 'mid' | 'high'

export function scoreBand(score: number | null | undefined, settings: AppSettings): ScoreBand {
  if (score === null || score === undefined || !Number.isFinite(score)) return 'none'
  if (score < settings.bandLow) return 'low'
  if (score <= settings.bandHigh) return 'mid'
  return 'high'
}

const TEXT_CLASS: Record<ScoreBand, string> = {
  none: 'text-ink-400',
  low: 'text-bad-700',
  mid: 'text-warn-700',
  high: 'text-good-700',
}

const CELL_CLASS: Record<ScoreBand, string> = {
  none: 'bg-ink-50 text-ink-400',
  low: 'bg-bad-50 text-bad-700',
  mid: 'bg-warn-50 text-warn-700',
  high: 'bg-good-50 text-good-700',
}

const BAND_LABEL: Record<ScoreBand, string> = {
  none: 'no entry',
  low: 'below 12',
  mid: '12 to 17',
  high: 'above 17',
}

/** Inline score, used in row tables. */
export function ScoreCell({ score, overridden = false }: { score: number | null; overridden?: boolean }) {
  const { state } = useApp()
  const band = scoreBand(score, state.settings)
  return (
    <span className={`font-mono font-semibold tabular-nums ${TEXT_CLASS[band]}`} title={`Score ${formatScore(score)} of ${state.settings.scoreCap} — ${BAND_LABEL[band]}`}>
      {formatScore(score)}
      {overridden && <span className="ml-1 text-[10px] font-normal text-brand-600 uppercase">ovr</span>}
    </span>
  )
}

/** Filled cell, used in the Monthly Scorecard grid. */
export function ScorecardCell({
  score,
  entryCount,
  onClick,
  label,
}: {
  score: number | null | undefined
  entryCount: number
  onClick?: () => void
  label: string
}) {
  const { state } = useApp()
  const band = scoreBand(score, state.settings)
  const text = score === null || score === undefined ? '·' : formatScore(score)

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick || entryCount === 0}
      aria-label={`${label}. ${score === null || score === undefined ? 'No entry' : `Score ${text} of ${state.settings.scoreCap}`}${entryCount > 1 ? `, ${entryCount} rows` : ''}`}
      className={`relative block w-full px-1.5 py-1 text-right font-mono text-xs tabular-nums ${CELL_CLASS[band]} ${
        onClick && entryCount > 0 ? 'cursor-pointer hover:ring-2 hover:ring-brand-400 hover:ring-inset' : 'cursor-default'
      }`}
      title={`${label} — ${score === null || score === undefined ? 'no entry' : `${text} / ${state.settings.scoreCap}`}${entryCount > 1 ? ` · ${entryCount} rows` : ''}`}
    >
      {text}
      {entryCount > 1 && <span className="absolute top-0 left-0.5 text-[9px] leading-tight text-ink-500">{entryCount}</span>}
    </button>
  )
}

/** The legend shown above the grid, so the colours are explained rather than guessed. */
export function ScoreLegend() {
  const { state } = useApp()
  const items: Array<[ScoreBand, string]> = [
    ['low', `Below ${state.settings.bandLow}`],
    ['mid', `${state.settings.bandLow} to ${state.settings.bandHigh}`],
    ['high', `Above ${state.settings.bandHigh}`],
    ['none', 'No entry'],
  ]
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
      <span>Score /{state.settings.scoreCap}:</span>
      {items.map(([band, label]) => (
        <span key={band} className={`rounded border border-ink-200 px-1.5 py-0.5 ${CELL_CLASS[band]}`}>
          {label}
        </span>
      ))}
    </div>
  )
}
