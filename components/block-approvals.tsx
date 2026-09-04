'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  RefreshCw,
  ShieldAlert,
  X,
  XCircle,
} from 'lucide-react'
import BlockOrderModal from './BlockOrderModal'
import {
  BLOCK_STATUS_STYLES,
  DEPARTMENT_STYLES,
  isBlockStatus,
  type BlockSchedule,
  type BlockStatus,
  type Department,
  type MaintenanceDefect,
} from '@/lib/types'

function fmt(value: string | null | undefined) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function hours(start: string, end: string) {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  return Number.isFinite(ms) && ms > 0 ? Math.round((ms / 3_600_000) * 10) / 10 : 0
}

/** `datetime-local` wants local wall-clock with no zone suffix. */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`
}

export default function BlockApprovals({
  defects,
  onChanged,
}: {
  defects: MaintenanceDefect[]
  onChanged?: () => void
}) {
  const [blocks, setBlocks] = useState<BlockSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'ALL' | BlockStatus>('ALL')

  const [adjusting, setAdjusting] = useState<BlockSchedule | null>(null)
  const [ordering, setOrdering] = useState<BlockSchedule | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/schedules')
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error ?? `Request failed (${res.status})`)
      setBlocks((payload.blocks ?? []) as BlockSchedule[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load block schedules.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** Posts a status transition and swaps the returned row in place. */
  const transition = useCallback(
    async (
      block: BlockSchedule,
      status: BlockStatus,
      extra?: { block_start?: string; block_end?: string; rejection_reason?: string }
    ) => {
      setBusyId(block.id)
      setError(null)
      try {
        const res = await fetch('/api/schedules/update-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: block.id, status, ...extra }),
        })
        const payload = await res.json()
        if (!res.ok) throw new Error(payload?.error ?? `Request failed (${res.status})`)

        setBlocks((prev) =>
          prev.map((b) => (b.id === block.id ? (payload.block as BlockSchedule) : b))
        )
        await onChanged?.()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Update failed.')
      } finally {
        setBusyId(null)
      }
    },
    [onChanged]
  )

  const visible =
    filter === 'ALL' ? blocks : blocks.filter((b) => b.status === filter)

  const counts = blocks.reduce<Record<string, number>>((acc, b) => {
    acc[b.status] = (acc[b.status] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Block Approvals
        </span>

        {(['ALL', 'PROPOSED', 'APPROVED', 'MODIFIED', 'REJECTED'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
              filter === s
                ? 'border-[#003C71] bg-[#003C71] text-white'
                : 'border-slate-300 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {s === 'ALL' ? `All (${blocks.length})` : `${s} (${counts[s] ?? 0})`}
          </button>
        ))}

        <button
          onClick={() => void load()}
          disabled={loading}
          className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-[#003C71] hover:underline disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="reoptimize-alert error">
          <AlertTriangle size={17} />
          <span>{error}</span>
        </div>
      )}

      {loading && blocks.length === 0 ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center">
          <CalendarDays size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm text-slate-500">
            {blocks.length === 0
              ? 'No block schedules yet. Run the AI Optimization Engine to generate proposals.'
              : `No blocks with status ${filter}.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((block) => {
            const style =
              BLOCK_STATUS_STYLES[
                (isBlockStatus(block.status) ? block.status : 'PROPOSED') as BlockStatus
              ]
            const tsr = Boolean(block.safety_flags?.requiresSpeedRestriction)
            const busy = busyId === block.id
            const canAct = block.status !== 'REJECTED'

            return (
              <motion.article
                key={block.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold text-slate-800">
                        {block.section_code}
                      </span>

                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${style.bg} ${style.border} ${style.text}`}
                      >
                        <i className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                        {style.label}
                      </span>

                      {tsr && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2.5 py-0.5 text-[11px] font-semibold text-red-800">
                          <ShieldAlert size={11} />
                          TSR required
                        </span>
                      )}

                      {block.permit_number && (
                        <span className="font-mono text-[11px] text-slate-500">
                          {block.permit_number}
                        </span>
                      )}
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                      <span className="flex items-center gap-1.5">
                        <Clock size={12} />
                        {fmt(block.block_start)} → {fmt(block.block_end)} (
                        {hours(block.block_start, block.block_end)} h)
                      </span>

                      {block.chainage_start_km !== null &&
                        block.chainage_start_km !== undefined && (
                          <span className="font-mono">
                            KM {Number(block.chainage_start_km).toFixed(3)}–
                            {Number(
                              block.chainage_end_km ?? block.chainage_start_km
                            ).toFixed(3)}
                          </span>
                        )}

                      <span>
                        saves {Number(block.total_downtime_saved_hrs).toFixed(1)} h
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(block.combined_departments ?? []).map((dept: Department) => {
                        const ds = DEPARTMENT_STYLES[dept]
                        if (!ds) return null
                        return (
                          <span
                            key={dept}
                            className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${ds.bg} ${ds.border} ${ds.text}`}
                          >
                            <i className={`h-1.5 w-1.5 rounded-full ${ds.dot}`} />
                            {ds.short}
                          </span>
                        )
                      })}
                    </div>

                    {/* Show what a controller actually changed. */}
                    {block.status === 'MODIFIED' && block.original_block_start && (
                      <p className="mt-2 text-[11px] text-amber-800">
                        Adjusted from {fmt(block.original_block_start)} →{' '}
                        {fmt(block.original_block_end)}
                      </p>
                    )}

                    {block.status === 'REJECTED' && block.rejection_reason && (
                      <p className="mt-2 text-[11px] text-red-800">
                        Rejected: {block.rejection_reason}
                      </p>
                    )}

                    {block.approved_by && block.status !== 'PROPOSED' && (
                      <p className="mt-1 text-[11px] text-slate-500">
                        {block.status === 'REJECTED' ? 'Actioned' : 'Approved'} by{' '}
                        {block.approved_by} · {fmt(block.approval_timestamp)}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {canAct && block.status !== 'APPROVED' && (
                      <button
                        onClick={() => void transition(block, 'APPROVED')}
                        disabled={busy}
                        className="flex items-center gap-1.5 rounded border border-green-600 bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        <CheckCircle2 size={13} />
                        Approve Block
                      </button>
                    )}

                    {canAct && (
                      <button
                        onClick={() => setAdjusting(block)}
                        disabled={busy}
                        className="flex items-center gap-1.5 rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <Clock size={13} />
                        Adjust Window
                      </button>
                    )}

                    {canAct && (
                      <button
                        onClick={() => {
                          const reason = window.prompt(
                            'Reason for rejecting this block?'
                          )
                          if (reason === null) return
                          void transition(block, 'REJECTED', {
                            rejection_reason: reason,
                          })
                        }}
                        disabled={busy}
                        className="flex items-center gap-1.5 rounded border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        <XCircle size={13} />
                        Reject
                      </button>
                    )}

                    {(block.status === 'APPROVED' || block.status === 'MODIFIED') && (
                      <button
                        onClick={() => setOrdering(block)}
                        className="flex items-center gap-1.5 rounded border border-[#003C71] bg-[#003C71] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#00294e]"
                      >
                        <FileText size={13} />
                        Generate Official Joint Block Order
                      </button>
                    )}
                  </div>
                </div>
              </motion.article>
            )
          })}
        </div>
      )}

      {/* ------------------------------------------------ adjust-window modal */}
      <AnimatePresence>
        {adjusting && (
          <AdjustWindowModal
            block={adjusting}
            busy={busyId === adjusting.id}
            onCancel={() => setAdjusting(null)}
            onSave={async (start, end) => {
              await transition(adjusting, 'MODIFIED', {
                block_start: start,
                block_end: end,
              })
              setAdjusting(null)
            }}
          />
        )}
      </AnimatePresence>

      {ordering && (
        <BlockOrderModal
          block={ordering}
          defects={defects}
          onClose={() => setOrdering(null)}
        />
      )}
    </div>
  )
}

/** Inline time picker for re-timing a block before approval. */
function AdjustWindowModal({
  block,
  busy,
  onCancel,
  onSave,
}: {
  block: BlockSchedule
  busy: boolean
  onCancel: () => void
  onSave: (startIso: string, endIso: string) => void | Promise<void>
}) {
  const [start, setStart] = useState(toLocalInput(block.block_start))
  const [end, setEnd] = useState(toLocalInput(block.block_end))
  const [problem, setProblem] = useState<string | null>(null)

  const startMs = Date.parse(start)
  const endMs = Date.parse(end)
  const duration =
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
      ? Math.round(((endMs - startMs) / 3_600_000) * 10) / 10
      : null

  function submit() {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      setProblem('Both a start and an end are required.')
      return
    }
    if (endMs <= startMs) {
      setProblem('The block must end after it starts.')
      return
    }
    setProblem(null)
    void onSave(new Date(startMs).toISOString(), new Date(endMs).toISOString())
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.97, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="text-sm font-bold text-slate-800">Adjust Block Window</h3>
          <button
            onClick={onCancel}
            aria-label="Cancel"
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-xs text-slate-500">
            <span className="font-mono font-semibold text-slate-700">
              {block.section_code}
            </span>{' '}
            · originally {fmt(block.original_block_start ?? block.block_start)} →{' '}
            {fmt(block.original_block_end ?? block.block_end)}
          </p>

          <div>
            <label
              htmlFor="adjust-start"
              className="mb-1 block text-xs font-semibold text-slate-600"
            >
              Scheduled start
            </label>
            <input
              id="adjust-start"
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label
              htmlFor="adjust-end"
              className="mb-1 block text-xs font-semibold text-slate-600"
            >
              Scheduled end
            </label>
            <input
              id="adjust-end"
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          {duration !== null && (
            <p className="text-xs text-slate-600">
              New duration: <strong>{duration} h</strong>
            </p>
          )}

          {problem && <p className="error-text">{problem}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onCancel}
              className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="flex items-center gap-1.5 rounded bg-[#003C71] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#00294e] disabled:opacity-50"
            >
              {busy && <RefreshCw size={13} className="animate-spin" />}
              Save &amp; mark Modified
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
