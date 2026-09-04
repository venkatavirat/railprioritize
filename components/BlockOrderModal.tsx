'use client'

import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { Printer, X, ShieldAlert } from 'lucide-react'
import {
  DEPARTMENT_STYLES,
  type BlockSchedule,
  type Department,
  type MaintenanceDefect,
} from '@/lib/types'

function formatStamp(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function durationHours(start: string, end: string) {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.round((ms / 3_600_000) * 100) / 100
}

/**
 * Printable joint block permit.
 *
 * Rendered as ordinary HTML rather than a generated PDF: the browser's own
 * print-to-PDF keeps the document selectable and avoids shipping a PDF
 * library for one screen. `print:` utilities strip the chrome on paper.
 */
export default function BlockOrderModal({
  block,
  defects,
  onClose,
}: {
  block: BlockSchedule
  /** Full backlog, used to resolve the block's assigned defect ids. */
  defects: MaintenanceDefect[]
  onClose: () => void
}) {
  // Escape to dismiss, matching the drawer behaviour elsewhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const assigned = new Set(block.assigned_defect_ids ?? [])
  const works = defects.filter((d) => assigned.has(d.id))

  const byDepartment = new Map<Department, MaintenanceDefect[]>()
  for (const work of works) {
    const list = byDepartment.get(work.department) ?? []
    list.push(work)
    byDepartment.set(work.department, list)
  }

  const requiresTsr = Boolean(block.safety_flags?.requiresSpeedRestriction)
  const involvesTraction = (block.combined_departments ?? []).includes('Traction_TRD')
  const hours = durationHours(block.block_start, block.block_end)

  const chainage =
    block.chainage_start_km !== null && block.chainage_start_km !== undefined
      ? `KM ${Number(block.chainage_start_km).toFixed(3)} – KM ${Number(
          block.chainage_end_km ?? block.chainage_start_km
        ).toFixed(3)}`
      : 'Not recorded in source data'

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4 print:static print:bg-white print:p-0">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto max-w-3xl rounded-lg bg-white shadow-2xl print:max-w-none print:rounded-none print:shadow-none"
      >
        {/* Screen-only controls */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-3 print:hidden">
          <h2 className="text-sm font-bold text-slate-800">
            Joint Block Maintenance Order
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded bg-[#003C71] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#00294e]"
            >
              <Printer size={14} />
              Print / Save as PDF
            </button>
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ------------------------------------------------ printable body */}
        <article className="px-8 py-6 text-[13px] leading-relaxed text-slate-900">
          <header className="border-b-2 border-slate-800 pb-4 text-center">
            <h1 className="text-lg font-bold tracking-wide">SOUTH CENTRAL RAILWAY</h1>
            <p className="mt-0.5 text-xs uppercase tracking-widest text-slate-600">
              Office of the Sr. Divisional Engineer
            </p>
            <h2 className="mt-3 text-base font-bold uppercase">
              Joint Block Maintenance Order
            </h2>
          </header>

          <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2">
            <div className="flex justify-between border-b border-dotted border-slate-300 pb-1">
              <dt className="font-semibold">Permit No.</dt>
              <dd className="font-mono">{block.permit_number ?? 'PENDING APPROVAL'}</dd>
            </div>
            <div className="flex justify-between border-b border-dotted border-slate-300 pb-1">
              <dt className="font-semibold">Status</dt>
              <dd className="font-semibold">{block.status}</dd>
            </div>
            <div className="flex justify-between border-b border-dotted border-slate-300 pb-1">
              <dt className="font-semibold">Block Section</dt>
              <dd className="font-mono">{block.section_code}</dd>
            </div>
            <div className="flex justify-between border-b border-dotted border-slate-300 pb-1">
              <dt className="font-semibold">Chainage</dt>
              <dd className="font-mono">{chainage}</dd>
            </div>
            <div className="flex justify-between border-b border-dotted border-slate-300 pb-1">
              <dt className="font-semibold">Block From</dt>
              <dd className="font-mono">{formatStamp(block.block_start)}</dd>
            </div>
            <div className="flex justify-between border-b border-dotted border-slate-300 pb-1">
              <dt className="font-semibold">Block To</dt>
              <dd className="font-mono">{formatStamp(block.block_end)}</dd>
            </div>
            <div className="flex justify-between border-b border-dotted border-slate-300 pb-1">
              <dt className="font-semibold">Total Duration</dt>
              <dd className="font-mono">{hours} h</dd>
            </div>
            <div className="flex justify-between border-b border-dotted border-slate-300 pb-1">
              <dt className="font-semibold">COA Traffic Slot</dt>
              <dd className="text-right text-[12px]">{block.coa_window_ref ?? '—'}</dd>
            </div>
          </dl>

          {/* --------------------------------------------- departmental work */}
          <section className="mt-5">
            <h3 className="mb-2 border-b border-slate-400 pb-1 text-sm font-bold uppercase">
              1. Departmental Work Included
            </h3>

            {works.length === 0 ? (
              <p className="text-slate-600">
                No individual work items are linked to this block. (Blocks planned
                from synthetic data carry no database defect references.)
              </p>
            ) : (
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="border border-slate-300 px-2 py-1 text-left">Dept</th>
                    <th className="border border-slate-300 px-2 py-1 text-left">Asset</th>
                    <th className="border border-slate-300 px-2 py-1 text-left">Work</th>
                    <th className="border border-slate-300 px-2 py-1 text-right">Hrs</th>
                    <th className="border border-slate-300 px-2 py-1 text-right">KM</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(byDepartment.entries()).flatMap(([dept, items]) =>
                    items.map((item) => (
                      <tr key={item.id}>
                        <td className="border border-slate-300 px-2 py-1 font-semibold">
                          {DEPARTMENT_STYLES[dept]?.short ?? dept}
                        </td>
                        <td className="border border-slate-300 px-2 py-1 font-mono">
                          {item.asset_id}
                        </td>
                        <td className="border border-slate-300 px-2 py-1">
                          {item.defect_description || '—'}
                        </td>
                        <td className="border border-slate-300 px-2 py-1 text-right font-mono">
                          {item.duration_required_hrs}
                        </td>
                        <td className="border border-slate-300 px-2 py-1 text-right font-mono">
                          {item.chainage_km ?? '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </section>

          {/* ------------------------------------------------ safety section */}
          <section className="mt-5">
            <h3 className="mb-2 border-b border-slate-400 pb-1 text-sm font-bold uppercase">
              2. Safety Precautions
            </h3>

            <ol className="list-decimal space-y-1.5 pl-5">
              <li>
                Traffic block to be obtained from the Section Controller before any
                staff or machinery enters the block section.
              </li>
              {involvesTraction && (
                <li className="font-semibold">
                  OHE POWER BLOCK AND EARTHING REQUIRED. Traction work must not
                  commence until the permit-to-work (ETR-3) has been issued and the
                  section is confirmed isolated and earthed by the TRD supervisor.
                </li>
              )}
              {requiresTsr ? (
                <li className="font-semibold text-red-800">
                  TEMPORARY SPEED RESTRICTION REQUIRED. Concurrent work sites in
                  this block fall within the 500 m longitudinal safety buffer. A TSR
                  must be imposed and engineering signals provided before work
                  begins.
                </li>
              ) : (
                <li>
                  Work sites in this block are separated by at least 500 m
                  longitudinally; no speed restriction is required on that account.
                </li>
              )}
              <li>
                Each department&rsquo;s supervisor shall confirm men and material are
                clear of the track before the block is surrendered.
              </li>
              <li>
                Protection to be provided as per General Rules Chapter 17 and the
                Divisional Engineering Manual.
              </li>
            </ol>

            {requiresTsr && (
              <p className="mt-3 flex items-start gap-2 border-l-4 border-red-600 bg-red-50 p-2.5 text-[12px] text-red-900 print:bg-white">
                <ShieldAlert size={15} className="mt-0.5 shrink-0" />
                <span>
                  {block.safety_flags?.notes?.join(' ') ??
                    'Speed restriction required for concurrent work inside the safety buffer.'}
                </span>
              </p>
            )}
          </section>

          {/* --------------------------------------------------- signatures */}
          <section className="mt-6">
            <h3 className="mb-3 border-b border-slate-400 pb-1 text-sm font-bold uppercase">
              3. Authorisation
            </h3>
            <p className="text-[12px]">
              Approved by:{' '}
              <span className="font-semibold">{block.approved_by ?? '—'}</span>
              {block.approval_timestamp && (
                <> on {formatStamp(block.approval_timestamp)}</>
              )}
            </p>

            <div className="mt-10 grid grid-cols-3 gap-6 text-center text-[11px]">
              {['Sr. Divisional Engineer', 'Section Controller', 'TRD Supervisor'].map(
                (role) => (
                  <div key={role}>
                    <div className="border-t border-slate-800 pt-1">{role}</div>
                  </div>
                )
              )}
            </div>
          </section>

          <footer className="mt-6 border-t border-slate-300 pt-2 text-center text-[10px] text-slate-500">
            Generated by RailPrioritize · Automated Multi-Departmental Joint Block
            Maintenance Planning · This order is valid only for the section, chainage
            and window stated above.
          </footer>
        </article>
      </motion.div>
    </div>
  )
}
