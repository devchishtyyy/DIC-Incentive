/**
 * Shared UI primitives.
 *
 * `GuardedButton` is the important one: it takes a `Decision` from `can(...)` and either
 * hides the control or disables it with the decision's reason as the tooltip. No screen
 * writes its own role check.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { Decision } from '../domain/permissions'
import type { EntryStatus, PeriodStatus } from '../domain/types'
import { useApp } from '../store/AppStore'

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const PATHS = {
  check: 'M4 10.5l4 4 8-9',
  alert: 'M10 3.5l7 12.5H3zM10 8.5v3.5M10 14.2v.3',
  lock: 'M6 9V6.5a4 4 0 118 0V9M4.5 9h11v7.5h-11z',
  info: 'M10 9v5M10 6.2v.3M10 17.5a7.5 7.5 0 100-15 7.5 7.5 0 000 15z',
  search: 'M9 15a6 6 0 100-12 6 6 0 000 12zM13.5 13.5L17.5 17.5',
  download: 'M10 3v10M6 9.5l4 4 4-4M3.5 16.5h13',
  plus: 'M10 4.5v11M4.5 10h11',
  trash: 'M4.5 6h11M8 6V4.5h4V6M6 6l.7 10h6.6L14 6',
  close: 'M5 5l10 10M15 5L5 15',
  chevron: 'M7.5 4.5l6 5.5-6 5.5',
  clock: 'M10 5.5V10l3 2M10 17.5a7.5 7.5 0 100-15 7.5 7.5 0 000 15z',
  undo: 'M4 9h8.5a3.5 3.5 0 110 7H8M4 9l3.5-3.5M4 9l3.5 3.5',
  clipboard: 'M7.5 4.5h5M7 3.5h6v2H7zM5.5 5.5h-1v11h11v-11h-1M7 9.5h6M7 12.5h4',
  pencil: 'M13.5 3.5l3 3-9 9H4.5v-3z',
  // --- navigation ---
  grid: 'M3.5 3.5h5v5h-5zM11.5 3.5h5v5h-5zM3.5 11.5h5v5h-5zM11.5 11.5h5v5h-5z',
  chart: 'M3.5 16.5v-6M8 16.5V5M12.5 16.5v-9M17 16.5v-4',
  signoff: 'M3.5 10.5l3.5 3.5 9-9M3.5 16.5h13',
  target: 'M10 17.5a7.5 7.5 0 100-15 7.5 7.5 0 000 15zM10 13.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM10 10.8v.3',
  people: 'M7.5 9.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM2.5 16.5c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5M13.5 6.2a2.3 2.3 0 010 4.6M14.5 12.3c1.8.4 3 1.9 3 3.7',
  history: 'M10 6v4.5l3 1.8M3.5 10a6.5 6.5 0 106.5-6.5c-2.3 0-4.3 1.2-5.5 3M4.5 3.5v3h3',
  gear: 'M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM16 10a6 6 0 00-.1-1l1.4-1.1-1.5-2.6-1.7.6a6 6 0 00-1.7-1l-.3-1.8H9l-.3 1.8a6 6 0 00-1.7 1l-1.7-.6-1.5 2.6L5.2 9a6 6 0 000 2l-1.4 1.1 1.5 2.6 1.7-.6a6 6 0 001.7 1l.3 1.8h3.1l.3-1.8a6 6 0 001.7-1l1.7.6 1.5-2.6L15.9 11c.1-.3.1-.7.1-1z',
  book: 'M4 4.5h5a2 2 0 012 2v9a1.5 1.5 0 00-1.5-1.5H4zM16 4.5h-5a2 2 0 00-2 2v9a1.5 1.5 0 011.5-1.5H16z',
} as const

export function Icon({ name, className = 'h-4 w-4' }: { name: keyof typeof PATHS; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

type Tone = 'neutral' | 'brand' | 'good' | 'warn' | 'bad'

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-ink-100 text-ink-700 border-ink-200',
  brand: 'bg-brand-50 text-brand-700 border-brand-200',
  good: 'bg-good-50 text-good-700 border-good-100',
  warn: 'bg-warn-50 text-warn-700 border-warn-100',
  bad: 'bg-bad-50 text-bad-700 border-bad-100',
}

export function Badge({ tone = 'neutral', children, className = '' }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONE_CLASS[tone]} ${className}`}>
      {children}
    </span>
  )
}

/** Status badges carry the word as well as the colour. */
export function PeriodBadge({ status }: { status: PeriodStatus }) {
  const tone: Tone = status === 'Locked' ? 'brand' : status === 'HOD Signed' ? 'good' : status === 'Submitted' ? 'warn' : 'neutral'
  return (
    <Badge tone={tone}>
      {status === 'Locked' && <Icon name="lock" className="h-3 w-3" />}
      {status}
    </Badge>
  )
}

export function EntryBadge({ status }: { status: EntryStatus }) {
  const tone: Tone = status === 'Locked' ? 'brand' : status === 'Submitted' ? 'good' : 'neutral'
  return <Badge tone={tone}>{status}</Badge>
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

/** Wraps any control. Works on a disabled button because the listener sits on the wrapper. */
export function Tooltip({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  const id = useId()
  if (!label) return <>{children}</>
  return (
    <span className={`group relative inline-flex ${className}`}>
      <span aria-describedby={id} className="inline-flex">
        {children}
      </span>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-max max-w-xs -translate-x-1/2 rounded-md
          bg-ink-900 px-2.5 py-1.5 text-xs leading-snug text-white opacity-0 shadow-lg transition-opacity
          group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type Variant = 'primary' | 'default' | 'good' | 'bad' | 'ghost'

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'btn-primary',
  default: 'btn-default',
  good: 'btn-good',
  bad: 'btn-bad',
  ghost: 'btn-ghost',
}

export interface GuardedButtonProps {
  decision: Decision
  onClick?: () => void
  children: ReactNode
  variant?: Variant
  size?: 'sm' | 'md'
  /** Hide rather than disable — used where showing the control would only confuse. */
  hideWhenDenied?: boolean
  /** An extra reason to disable that is not about permissions (for example a failed checklist). */
  blockedReason?: string
  type?: 'button' | 'submit'
  className?: string
  title?: string
}

export function GuardedButton({
  decision,
  onClick,
  children,
  variant = 'default',
  size = 'md',
  hideWhenDenied = false,
  blockedReason,
  type = 'button',
  className = '',
  title,
}: GuardedButtonProps) {
  if (!decision.allowed && hideWhenDenied) return null

  const reason = !decision.allowed ? decision.reason : (blockedReason ?? '')
  const disabled = Boolean(reason)

  return (
    <Tooltip label={reason || title || ''}>
      <button
        type={type}
        onClick={onClick}
        disabled={disabled}
        aria-disabled={disabled}
        className={`btn ${VARIANT_CLASS[variant]} ${size === 'sm' ? 'btn-sm' : ''} ${className}`}
      >
        {children}
      </button>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// Modal and confirmation
// ---------------------------------------------------------------------------

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: string
}) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    panel.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-900/40 p-4 sm:items-center">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`card w-full ${width} my-8 shadow-xl`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-3">
          <h2 className="text-base font-semibold text-ink-900">{title}</h2>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm" aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-ink-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export interface ConfirmConfig {
  title: string
  body: ReactNode
  confirmLabel: string
  variant?: Variant
  /** When true the comment box must be filled in before Confirm enables. */
  commentRequired?: boolean
  commentLabel?: string
  commentOptions?: readonly string[]
  onConfirm: (comment: string) => void
}

export function ConfirmDialog({ config, onClose }: { config: ConfirmConfig | null; onClose: () => void }) {
  const [comment, setComment] = useState('')

  useEffect(() => {
    setComment('')
  }, [config])

  if (!config) return null
  const needsComment = Boolean(config.commentRequired)
  const ready = !needsComment || comment.trim().length > 2

  return (
    <Modal
      open
      title={config.title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-default" onClick={onClose}>
            Cancel
          </button>
          <Tooltip label={ready ? '' : 'A comment is required before this can be confirmed.'}>
            <button
              type="button"
              className={`btn ${VARIANT_CLASS[config.variant ?? 'primary']}`}
              disabled={!ready}
              onClick={() => {
                config.onConfirm(comment.trim())
                onClose()
              }}
            >
              {config.confirmLabel}
            </button>
          </Tooltip>
        </>
      }
    >
      <div className="space-y-3 text-sm text-ink-700">
        <div>{config.body}</div>
        {(config.commentLabel || needsComment) && (
          <div className="space-y-1.5">
            <label className="label" htmlFor="confirm-comment">
              {config.commentLabel ?? 'Comment'} {needsComment ? '(required)' : '(optional)'}
            </label>
            {config.commentOptions && (
              <div className="flex flex-wrap gap-1.5">
                {config.commentOptions.map((option) => (
                  <button key={option} type="button" className="btn btn-default btn-sm" onClick={() => setComment(option)}>
                    {option}
                  </button>
                ))}
              </div>
            )}
            <textarea
              id="confirm-comment"
              className="input min-h-20"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder={needsComment ? 'Explain the reason — it is written to the audit log.' : 'Optional note for the step history'}
            />
          </div>
        )}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="rounded-full bg-ink-100 p-2.5 text-ink-500">
        <Icon name="info" className="h-5 w-5" />
      </div>
      <p className="text-sm font-semibold text-ink-800">{title}</p>
      <p className="max-w-md text-sm text-ink-500">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-2">
          {Array.from({ length: cols }).map((_, colIndex) => (
            <div key={colIndex} className="skeleton h-5 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-bad-100 bg-bad-50 px-3 py-2 text-sm text-bad-700" role="alert">
      <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  )
}

export function WarnNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-warn-100 bg-warn-50 px-3 py-2 text-sm text-warn-700">
      <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  )
}

export function InfoNote({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  const skin =
    tone === 'warn' ? 'border-warn-100 bg-warn-50 text-warn-700' : 'border-brand-200 bg-brand-50 text-brand-800'
  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${skin}`}>
      <Icon name={tone === 'warn' ? 'alert' : 'info'} className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

export function Toaster() {
  const { toasts, dismissToast } = useApp()
  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-lg ${
            toast.kind === 'error' ? 'border-bad-100 bg-bad-50 text-bad-700' : toast.kind === 'info' ? 'border-brand-200 bg-brand-50 text-brand-800' : 'border-good-100 bg-good-50 text-good-700'
          }`}
        >
          <Icon name={toast.kind === 'error' ? 'alert' : 'check'} className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{toast.message}</span>
          <button type="button" onClick={() => dismissToast(toast.id)} className="text-current opacity-60 hover:opacity-100" aria-label="Dismiss">
            <Icon name="close" className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-ink-900">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-ink-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Stat({ label, value, hint, tone = 'neutral' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  const accent =
    tone === 'good' ? 'text-good-600' : tone === 'warn' ? 'text-warn-600' : tone === 'bad' ? 'text-bad-600' : 'text-ink-900'
  return (
    <div className="card card-pad">
      <div className="label">{label}</div>
      <div className={`mt-1 font-mono text-2xl tabular-nums ${accent}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-500">{hint}</div>}
    </div>
  )
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="label">{label}</span>
      {children}
      {hint && !error && <p className="text-xs text-ink-500">{hint}</p>}
      {error && <p className="text-xs text-bad-600">{error}</p>}
    </div>
  )
}
