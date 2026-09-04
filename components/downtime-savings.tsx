'use client'

import { motion } from 'framer-motion'
import { AlertTriangle, ArrowRight, Info, TrainFront } from 'lucide-react'
import type { DowntimeMetrics } from '@/lib/types'

/**
 * Before-vs-after track occupation.
 *
 * The two bars share one scale so the saving is read as area, not inferred
 * from two separately-scaled charts.
 */
export default function DowntimeSavings({ metrics }: { metrics: DowntimeMetrics }) {
  const before = Number(metrics.total_uncoordinated_hours) || 0
  const after = Number(metrics.joint_block_hours) || 0
  const saved = Math.max(0, before - after)
  const reduction = Number(metrics.downtime_reduction_percent) || 0

  const scale = Math.max(before, after, 1)
  const pct = (value: number) => `${Math.max(0, (value / scale) * 100)}%`

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-800">
          Track Downtime — Before vs After Co-Use
        </h3>
        <span className="text-xs text-slate-500">
          {metrics.tasks_planned} tasks across {metrics.blocks_planned} joint blocks
        </span>
      </div>

      <div className="space-y-3">
        {/* Uncoordinated */}
        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-600">
              Uncoordinated — each department blocks separately
            </span>
            <span className="font-mono font-semibold text-slate-700">
              {before.toFixed(1)} h
            </span>
          </div>
          <div className="h-7 overflow-hidden rounded bg-slate-100">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: pct(before) }}
              transition={{ duration: 0.5 }}
              className="h-full rounded bg-red-400/80"
            />
          </div>
        </div>

        {/* Joint */}
        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-600">
              Joint blocks — unified corridor closures
            </span>
            <span className="font-mono font-semibold text-slate-700">
              {after.toFixed(1)} h
            </span>
          </div>
          <div className="h-7 overflow-hidden rounded bg-slate-100">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: pct(after) }}
              transition={{ duration: 0.5, delay: 0.15 }}
              className="h-full rounded bg-green-500/80"
            />
          </div>
        </div>
      </div>

      {/* Headline figures */}
      <div className="mt-5 grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-green-50 p-2 text-green-700">
            <ArrowRight size={18} />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Downtime avoided
            </div>
            <div className="text-xl font-bold text-slate-800">
              {saved.toFixed(1)} h
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-blue-50 p-2 text-blue-700">
            <Info size={18} />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Reduction
            </div>
            <div className="text-xl font-bold text-slate-800">
              {reduction.toFixed(1)}%
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-amber-50 p-2 text-amber-700">
            <TrainFront size={18} />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Passenger delay saved
            </div>
            <div className="text-xl font-bold text-slate-800">
              {Number(metrics.passenger_delay_minutes_saved).toLocaleString()} min
            </div>
          </div>
        </div>
      </div>

      {/* An infeasible plan produces a flattering but meaningless reduction,
          so say so loudly rather than letting the headline stand. */}
      {metrics.blocks_not_executable > 0 && (
        <div className="mt-4 flex items-start gap-2.5 rounded border-l-4 border-red-500 bg-red-50 p-3 text-xs text-red-900">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            <strong>
              {metrics.blocks_not_executable} of {metrics.blocks_planned} blocks
              are shorter than the work they contain
            </strong>{' '}
            and cannot be executed as scheduled. The reduction figure above is
            unreliable until those blocks are re-planned into longer corridor
            windows — the apparent saving partly reflects work compressed into
            time that does not exist.
          </span>
        </div>
      )}

      {/* The delay figure rests on stated coefficients, not measurements --
          say so rather than letting it read as observed fact. */}
      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        Passenger delay is a planning estimate: hours of possession avoided
        multiplied by the affected trains per hour for the corridor&rsquo;s traffic
        density band, at 8 minutes per train. It is an order-of-magnitude aid,
        not a measured figure.
      </p>
    </section>
  )
}
