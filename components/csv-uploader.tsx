'use client'

import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  X,
  FileText,
} from 'lucide-react'
import { SOURCE_TABLES, TABLE_SPECS, type SourceTable } from '@/lib/source-tables'

type Toast = {
  kind: 'success' | 'error'
  title: string
  detail?: string
  problems?: string[]
}

type UploadResponse = {
  success?: boolean
  rowsInserted?: number
  rowsSkipped?: number
  table?: string
  error?: string
  problems?: string[]
  expectedColumns?: string[]
}

export default function CsvUploader({
  onUploaded,
  table: fixedTable,
  compact = false,
}: {
  /**
   * Called after a successful upload so the caller can refetch.
   * Receives the table that was written to.
   */
  onUploaded?: (table: SourceTable) => void | Promise<void>
  /** Locks the uploader to one table and hides the picker. */
  table?: SourceTable
  /** Drops the panel chrome, for embedding inside an existing card. */
  compact?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [selectedTable, setSelectedTable] = useState<SourceTable>('tms_defects')
  const table = fixedTable ?? selectedTable
  const setTable = setSelectedTable
  const [fileName, setFileName] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)

  function reset() {
    setBusy(false)
    setProgress(0)
    if (inputRef.current) inputRef.current.value = ''
  }

  /**
   * Uses XMLHttpRequest rather than fetch because it reports upload progress;
   * fetch has no equivalent for request bodies in browsers today.
   */
  function upload(file: File) {
    setBusy(true)
    setToast(null)
    setProgress(0)
    setFileName(file.name)

    const body = new FormData()
    body.append('file', file)
    body.append('table_name', table)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/admin/upload-dataset')

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setProgress(Math.round((event.loaded / event.total) * 100))
      }
    }

    xhr.onload = async () => {
      let payload: UploadResponse = {}
      try {
        payload = JSON.parse(xhr.responseText)
      } catch {
        payload = { error: 'The server returned an unreadable response.' }
      }

      if (xhr.status >= 200 && xhr.status < 300 && payload.success) {
        const inserted = payload.rowsInserted ?? 0
        setToast({
          kind: 'success',
          title: `Imported ${inserted} row${inserted === 1 ? '' : 's'}`,
          detail: `into ${TABLE_SPECS[table].label}${
            payload.rowsSkipped ? ` · ${payload.rowsSkipped} skipped` : ''
          }`,
          problems: payload.problems,
        })
        await onUploaded?.(table)
      } else {
        setToast({
          kind: 'error',
          title: payload.error ?? `Upload failed (${xhr.status})`,
          detail: payload.expectedColumns
            ? `Expected columns: ${payload.expectedColumns.join(', ')}`
            : undefined,
          problems: payload.problems,
        })
      }

      reset()
    }

    xhr.onerror = () => {
      setToast({
        kind: 'error',
        title: 'Network error',
        detail: 'Could not reach the ingestion endpoint.',
      })
      reset()
    }

    xhr.send(body)
  }

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) upload(file)
  }

  const spec = TABLE_SPECS[table]

  const body = (
    <>
      <div className="space-y-4">
        {/* Hidden when the uploader is pinned to one table by its parent. */}
        {!fixedTable && (
          <div>
            <label
              htmlFor="target-table"
              className="mb-1.5 block text-xs font-semibold text-slate-600"
            >
              Target system
            </label>
            <select
              id="target-table"
              value={table}
              onChange={(e) => setTable(e.target.value as SourceTable)}
              disabled={busy}
              className="filter-select w-full"
            >
              {SOURCE_TABLES.map((name) => (
                <option key={name} value={name}>
                  {TABLE_SPECS[name].label}
                </option>
              ))}
            </select>
          </div>
        )}

        <label
          className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition ${
            busy
              ? 'cursor-wait border-slate-200 bg-slate-50'
              : 'cursor-pointer border-slate-300 hover:border-[#e27625] hover:bg-orange-50/40'
          }`}
        >
          {busy ? (
            <Loader2 className="animate-spin text-[#e27625]" size={26} />
          ) : (
            <UploadCloud className="text-slate-400" size={26} />
          )}

          <span className="text-sm font-medium text-slate-700">
            {busy ? `Uploading ${fileName}…` : 'Choose a CSV file'}
          </span>

          <span className="text-center text-xs text-slate-500">
            Columns are matched by name — {spec.fields.map((f) => f.column).join(', ')}
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

        {/* Progress */}
        <AnimatePresence>
          {busy && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <FileText size={13} />
                  {fileName}
                </span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                <motion.div
                  className="h-full rounded-full bg-[#e27625]"
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.2 }}
                />
              </div>
              {progress === 100 && (
                <p className="mt-1.5 text-xs text-slate-500">
                  Parsing and upserting on the server…
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Toast — fixed-position, so it renders the same in both layouts. */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ type: 'spring', damping: 22 }}
            role="status"
            aria-live="polite"
            className={`fixed bottom-24 right-6 z-50 w-full max-w-sm rounded-lg border p-4 shadow-lg ${
              toast.kind === 'success'
                ? 'border-green-200 bg-green-50'
                : 'border-red-200 bg-red-50'
            }`}
          >
            <div className="flex items-start gap-2.5">
              {toast.kind === 'success' ? (
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green-700" />
              ) : (
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-700" />
              )}

              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-semibold ${
                    toast.kind === 'success' ? 'text-green-900' : 'text-red-900'
                  }`}
                >
                  {toast.title}
                </p>

                {toast.detail && (
                  <p
                    className={`mt-0.5 text-xs ${
                      toast.kind === 'success' ? 'text-green-800' : 'text-red-800'
                    }`}
                  >
                    {toast.detail}
                  </p>
                )}

                {toast.problems && toast.problems.length > 0 && (
                  <ul
                    className={`mt-1.5 list-disc space-y-0.5 pl-4 text-xs ${
                      toast.kind === 'success' ? 'text-green-800' : 'text-red-800'
                    }`}
                  >
                    {toast.problems.slice(0, 4).map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                )}
              </div>

              <button
                onClick={() => setToast(null)}
                aria-label="Dismiss notification"
                className="shrink-0 text-slate-400 hover:text-slate-600"
              >
                <X size={15} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )

  // Embedded inside a domain card, the surrounding panel would double up.
  if (compact) return <div className="space-y-4">{body}</div>

  return (
    <section className="panel">
      <div className="panel-heading">
        <h3>Dataset Ingestion</h3>
        <span className="status-pill">{SOURCE_TABLES.length} source systems</span>
      </div>
      <div className="p-5">{body}</div>
    </section>
  )
}
