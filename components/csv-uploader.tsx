'use client'

import { useRef, useState } from 'react'
import Papa from 'papaparse'
import { motion, AnimatePresence } from 'framer-motion'
import { UploadCloud, CheckCircle2, AlertTriangle, Loader2, X } from 'lucide-react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import {
  normalizeDepartment,
  defaultSystemSource,
  type Department,
} from '@/lib/types'

/** Rows are pushed to Supabase in chunks to stay under request size limits. */
const BATCH_SIZE = 200

type UploadKind = 'defects' | 'windows'

type UploadReport = {
  kind: UploadKind
  inserted: number
  skipped: number
  problems: string[]
}

type CsvRow = Record<string, unknown>

function cell(row: CsvRow, ...names: string[]): string {
  for (const name of names) {
    const value = row[name]
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim()
    }
  }
  return ''
}

function toNumber(value: string, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toBoolean(value: string): boolean {
  const raw = value.toLowerCase()
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'y'
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/**
 * Decides whether a CSV holds maintenance defects or COA corridor windows by
 * looking at which headers are present.
 */
function detectKind(headers: string[]): UploadKind {
  const normalized = headers.map((h) => h.trim().toLowerCase())
  const windowish = ['window_start', 'window_end', 'passenger_traffic_density']
  return windowish.some((h) => normalized.includes(h)) ? 'windows' : 'defects'
}

function buildDefectRow(row: CsvRow, index: number) {
  const problems: string[] = []
  const line = index + 2 // +1 for header, +1 for 1-based numbering

  const departmentRaw = cell(row, 'department', 'dept', 'Department')
  const department = normalizeDepartment(departmentRaw)
  const assetId = cell(row, 'asset_id', 'asset', 'Asset ID')
  const sectionCode = cell(row, 'section_code', 'section', 'Section')
  const description = cell(row, 'defect_description', 'description', 'defect')
  const durationRaw = cell(row, 'duration_required_hrs', 'duration_hrs', 'duration')

  if (!department) {
    problems.push(
      `Row ${line}: unrecognised department "${departmentRaw || '(blank)'}".`
    )
  }
  if (!assetId) problems.push(`Row ${line}: missing asset_id.`)
  if (!sectionCode) problems.push(`Row ${line}: missing section_code.`)

  if (problems.length > 0 || !department) return { problems, value: null }

  const criticality = clamp(
    Math.round(toNumber(cell(row, 'asset_criticality_score', 'criticality'), 5)),
    1,
    10
  )

  // risk_score is NOT NULL in the schema but is often absent from source
  // exports, so fall back to a criticality-derived estimate.
  const riskScore = clamp(
    toNumber(cell(row, 'risk_score', 'risk'), criticality * 10),
    0,
    100
  )

  const systemSource =
    cell(row, 'system_source', 'source', 'system').toUpperCase() ||
    defaultSystemSource(department as Department)

  return {
    problems,
    value: {
      department,
      system_source: systemSource.slice(0, 10),
      asset_id: assetId,
      asset_criticality_score: criticality,
      section_code: sectionCode,
      defect_description: description || `${assetId} — maintenance required`,
      risk_score: riskScore,
      duration_required_hrs: clamp(toNumber(durationRaw, 2), 0.25, 99),
      is_overdue: toBoolean(cell(row, 'is_overdue', 'overdue')),
    },
  }
}

function buildWindowRow(row: CsvRow, index: number) {
  const problems: string[] = []
  const line = index + 2

  const sectionCode = cell(row, 'section_code', 'section')
  const start = cell(row, 'window_start', 'start', 'block_start')
  const end = cell(row, 'window_end', 'end', 'block_end')

  if (!sectionCode) problems.push(`Row ${line}: missing section_code.`)
  if (!start || Number.isNaN(Date.parse(start))) {
    problems.push(`Row ${line}: unreadable window_start "${start || '(blank)'}".`)
  }
  if (!end || Number.isNaN(Date.parse(end))) {
    problems.push(`Row ${line}: unreadable window_end "${end || '(blank)'}".`)
  }

  if (problems.length > 0) return { problems, value: null }

  const density = cell(row, 'passenger_traffic_density', 'traffic_density') || 'Medium'

  return {
    problems,
    value: {
      section_code: sectionCode,
      window_start: new Date(start).toISOString(),
      window_end: new Date(end).toISOString(),
      freight_impact_score: clamp(
        Math.round(toNumber(cell(row, 'freight_impact_score', 'freight_impact'), 3)),
        1,
        5
      ),
      passenger_traffic_density: density,
    },
  }
}

export default function CsvUploader({
  onUploaded,
}: {
  /** Called after a successful upload so the dashboard can refetch. */
  onUploaded?: () => void | Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<UploadReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setBusy(true)
    setError(null)
    setReport(null)

    try {
      const parsed = await new Promise<Papa.ParseResult<CsvRow>>((resolve, reject) => {
        Papa.parse<CsvRow>(file, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (header) => header.trim(),
          complete: resolve,
          error: reject,
        })
      })

      const headers = parsed.meta.fields ?? []
      if (headers.length === 0) {
        throw new Error('That file has no header row.')
      }

      const kind = detectKind(headers)
      const problems: string[] = []
      const rows: Record<string, unknown>[] = []

      parsed.data.forEach((row, index) => {
        const built =
          kind === 'defects' ? buildDefectRow(row, index) : buildWindowRow(row, index)
        problems.push(...built.problems)
        if (built.value) rows.push(built.value)
      })

      if (rows.length === 0) {
        throw new Error(
          `No valid rows found. ${problems[0] ?? 'Check the column headers.'}`
        )
      }

      const supabase = getSupabaseBrowserClient()
      const table = kind === 'defects' ? 'maintenance_defects' : 'corridor_windows'
      const conflictKey = kind === 'defects' ? 'asset_id' : 'section_code,window_start'

      let inserted = 0
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE)
        const { error: upsertError } = await supabase
          .from(table)
          .upsert(batch, { onConflict: conflictKey })

        if (upsertError) {
          throw new Error(`${upsertError.message} (while writing to ${table})`)
        }
        inserted += batch.length
      }

      setReport({
        kind,
        inserted,
        skipped: parsed.data.length - rows.length,
        problems: problems.slice(0, 5),
      })

      await onUploaded?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setBusy(false)
      // Allow re-selecting the same file.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <section className="panel">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h3 className="font-semibold">Telemetry Ingestion</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            Upload a defect export from TMS, SMMS or TDMS — or a COA corridor
            window file. The format is detected from the header row.
          </p>
        </div>
      </div>

      <label
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition ${
          busy
            ? 'border-slate-200 bg-slate-50 cursor-wait'
            : 'border-slate-300 hover:border-blue-500 hover:bg-blue-50/50 cursor-pointer'
        }`}
      >
        {busy ? (
          <Loader2 className="animate-spin text-blue-600" size={26} />
        ) : (
          <UploadCloud className="text-slate-400" size={26} />
        )}
        <span className="text-sm font-medium text-slate-700">
          {busy ? 'Parsing and upserting…' : 'Choose a CSV file'}
        </span>
        <span className="text-xs text-slate-500 text-center">
          Defects: department, system_source, asset_id, section_code,
          defect_description, duration_required_hrs, is_overdue
        </span>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          disabled={busy}
          className="hidden"
        />
      </label>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss">
              <X size={15} />
            </button>
          </motion.div>
        )}

        {report && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-3 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900"
          >
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 size={16} />
              Upserted {report.inserted}{' '}
              {report.kind === 'defects' ? 'defect' : 'corridor window'}
              {report.inserted === 1 ? '' : 's'}.
            </div>
            {report.skipped > 0 && (
              <p className="mt-1 text-xs text-green-800">
                {report.skipped} row{report.skipped === 1 ? '' : 's'} skipped.
              </p>
            )}
            {report.problems.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-xs text-green-800">
                {report.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
