'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  RadioTower,
  RefreshCw,
  TrainFront,
  Zap,
  Clock,
} from 'lucide-react'
import CsvUploader from './csv-uploader'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table'
import { Badge } from './ui/badge'
import { SOURCE_TABLES, TABLE_SPECS, type SourceTable } from '@/lib/source-tables'
import type { TableSnapshot } from '@/lib/data-sources'

// ---------------------------------------------------------------------------
// Domain metadata — the human framing for each source system.
// ---------------------------------------------------------------------------

type Domain = {
  table: SourceTable
  tab: string
  title: string
  blurb: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  /** Columns shown in the preview, in order. */
  preview: { key: string; label: string }[]
}

const DOMAINS: Domain[] = [
  {
    table: 'tms_defects',
    tab: 'Civil Engineering',
    title: 'Civil Engineering — TMS',
    blurb: 'Track defects, USFD logs and geometry faults.',
    icon: TrainFront,
    preview: [
      { key: 'asset_id', label: 'Asset' },
      { key: 'section_code', label: 'Section' },
      { key: 'defect_description', label: 'Defect' },
      { key: 'risk_score', label: 'Risk' },
      { key: 'duration_required_hrs', label: 'Hrs' },
      { key: 'is_overdue', label: 'Overdue' },
    ],
  },
  {
    table: 'smms_defects',
    tab: 'Signalling & Telecom',
    title: 'Signalling & Telecom — SMMS',
    blurb: 'Point machines, track circuits and axle counters.',
    icon: RadioTower,
    preview: [
      { key: 'asset_id', label: 'Asset' },
      { key: 'section_code', label: 'Section' },
      { key: 'defect_description', label: 'Defect' },
      { key: 'risk_score', label: 'Risk' },
      { key: 'duration_required_hrs', label: 'Hrs' },
      { key: 'is_overdue', label: 'Overdue' },
    ],
  },
  {
    table: 'tdms_defects',
    tab: 'Electrical & Traction',
    title: 'Electrical & Traction — TDMS',
    blurb: 'OHE wires, section insulators and power blocks.',
    icon: Zap,
    preview: [
      { key: 'asset_id', label: 'Asset' },
      { key: 'section_code', label: 'Section' },
      { key: 'defect_description', label: 'Defect' },
      { key: 'risk_score', label: 'Risk' },
      { key: 'duration_required_hrs', label: 'Hrs' },
      { key: 'is_overdue', label: 'Overdue' },
    ],
  },
  {
    table: 'bdms_demands',
    tab: 'Block Demands',
    title: 'Block Demands — BDMS',
    blurb: 'Formal departmental time-window requests.',
    icon: Clock,
    preview: [
      { key: 'demand_id', label: 'Demand' },
      { key: 'department', label: 'Dept' },
      { key: 'section_code', label: 'Section' },
      { key: 'requested_start', label: 'From' },
      { key: 'duration_required_hrs', label: 'Hrs' },
      { key: 'status', label: 'Status' },
    ],
  },
  {
    table: 'coa_slots',
    tab: 'Traffic Control',
    title: 'Traffic Control — COA',
    blurb: 'Train schedules and available corridor margin windows.',
    icon: Database,
    preview: [
      { key: 'section_code', label: 'Section' },
      { key: 'slot_start', label: 'Window start' },
      { key: 'slot_end', label: 'Window end' },
      { key: 'freight_impact_score', label: 'Freight' },
      { key: 'passenger_traffic_density', label: 'Density' },
    ],
  },
]

const SHORT_LABEL: Record<SourceTable, string> = {
  tms_defects: 'TMS',
  smms_defects: 'SMMS',
  tdms_defects: 'TDMS',
  bdms_demands: 'BDMS',
  coa_slots: 'COA',
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatCell(value: unknown, key: string) {
  if (value === null || value === undefined || value === '') return '—'

  if (typeof value === 'boolean') return value ? 'Yes' : 'No'

  // Timestamp-ish columns render as a readable local datetime.
  if (/(_start|_end|_at)$/.test(key)) {
    const parsed = Date.parse(String(value))
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toLocaleString(undefined, {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    }
  }

  if (typeof value === 'number') return String(Math.round(value * 100) / 100)

  const text = String(value)
  return text.length > 60 ? `${text.slice(0, 58)}…` : text
}

function formatTimestamp(value: string | null) {
  if (!value) return 'never'
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return 'unknown'
  return new Date(parsed).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function StatusBadge({ snapshot }: { snapshot: TableSnapshot | undefined }) {
  if (!snapshot) {
    return <Badge variant="outline">Loading…</Badge>
  }

  if (snapshot.origin === 'database') {
    return (
      <Badge variant="live">
        <CheckCircle2 />
        REAL DATA
      </Badge>
    )
  }

  if (snapshot.origin === 'unavailable') {
    return (
      <Badge variant="error" title={snapshot.error}>
        <AlertTriangle />
        TABLE MISSING
      </Badge>
    )
  }

  return (
    <Badge variant="synthetic">
      <AlertTriangle />
      SYNTHETIC FALLBACK
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// Data Control Center
// ---------------------------------------------------------------------------

export default function DataControlCenter({
  onDataChanged,
}: {
  /** Lets the parent dashboard refresh its own metrics after an upload. */
  onDataChanged?: () => void | Promise<void>
}) {
  const [snapshots, setSnapshots] = useState<Record<string, TableSnapshot>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState<SourceTable | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<string>(DOMAINS[0].table)

  /** Loads every table's snapshot. */
  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/dataset')
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error ?? `Request failed (${response.status})`)
      }

      const next: Record<string, TableSnapshot> = {}
      for (const snapshot of (payload.snapshots ?? []) as TableSnapshot[]) {
        next[snapshot.table] = snapshot
      }
      setSnapshots(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load dataset status.')
    } finally {
      setLoading(false)
    }
  }, [])

  /**
   * Refreshes a single table in place after an upload — no full page reload
   * and no refetch of the other four.
   */
  const refreshTable = useCallback(
    async (table: SourceTable) => {
      setRefreshing(table)
      try {
        const response = await fetch(`/api/dataset?table=${table}`)
        const payload = await response.json()
        if (!response.ok) {
          throw new Error(payload?.error ?? `Request failed (${response.status})`)
        }

        if (payload.snapshot) {
          setSnapshots((prev) => ({ ...prev, [table]: payload.snapshot }))
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not refresh the table.')
      } finally {
        setRefreshing(null)
      }

      // The unified backlog changed too, so let the dashboard catch up.
      await onDataChanged?.()
    },
    [onDataChanged]
  )

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const liveCount = SOURCE_TABLES.filter(
    (t) => snapshots[t]?.origin === 'database'
  ).length

  return (
    <div className="space-y-5">
      {/* ---------------------------------------------- global summary bar */}
      <div className="sticky top-0 z-20 -mx-2 rounded-lg border border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
        <div className="mb-2.5 flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-bold text-slate-800">Dataset Status</h3>
          <span className="text-xs text-slate-500">
            {liveCount} of {SOURCE_TABLES.length} systems on live data
          </span>
          <button
            onClick={() => void loadAll()}
            disabled={loading}
            className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-[#003C71] hover:underline disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh all
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {SOURCE_TABLES.map((table) => {
            const snapshot = snapshots[table]
            const isLive = snapshot?.origin === 'database'
            const isMissing = snapshot?.origin === 'unavailable'

            return (
              <button
                key={table}
                onClick={() => setActiveTab(table)}
                title={
                  snapshot
                    ? isLive
                      ? `${snapshot.count} rows in the database`
                      : 'Synthetic fallback active'
                    : 'Loading'
                }
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
                  !snapshot
                    ? 'border-slate-200 bg-slate-50 text-slate-400'
                    : isLive
                      ? 'border-green-300 bg-green-50 text-green-800 hover:bg-green-100'
                      : isMissing
                        ? 'border-red-300 bg-red-50 text-red-800 hover:bg-red-100'
                        : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                }`}
              >
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    !snapshot
                      ? 'bg-slate-300'
                      : isLive
                        ? 'bg-green-600'
                        : isMissing
                          ? 'bg-red-600'
                          : 'bg-amber-500'
                  }`}
                />
                {SHORT_LABEL[table]}
                <span className="font-mono font-normal opacity-75">
                  {snapshot ? (isLive ? snapshot.count : 'fallback') : '…'}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {error && (
        <div className="reoptimize-alert error">
          <AlertTriangle size={17} />
          <span>{error}</span>
          <button
            onClick={() => void loadAll()}
            className="ml-auto font-semibold underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------ tabs */}
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(String(value))}>
        <TabsList>
          {DOMAINS.map((domain) => {
            const snapshot = snapshots[domain.table]
            return (
              <TabsTrigger key={domain.table} value={domain.table}>
                <domain.icon size={14} />
                <span className="hidden sm:inline">{domain.tab}</span>
                <span className="sm:hidden">{SHORT_LABEL[domain.table]}</span>
                <span
                  className={`ml-1 inline-block h-1.5 w-1.5 rounded-full ${
                    !snapshot
                      ? 'bg-slate-300'
                      : snapshot.origin === 'database'
                        ? 'bg-green-600'
                        : snapshot.origin === 'unavailable'
                          ? 'bg-red-600'
                          : 'bg-amber-500'
                  }`}
                />
              </TabsTrigger>
            )
          })}
        </TabsList>

        {DOMAINS.map((domain) => (
          <TabsContent key={domain.table} value={domain.table}>
            <DomainPanel
              domain={domain}
              snapshot={snapshots[domain.table]}
              loading={loading}
              refreshing={refreshing === domain.table}
              onUploaded={refreshTable}
              onRefresh={() => void refreshTable(domain.table)}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

// ---------------------------------------------------------------------------
// One domain tab
// ---------------------------------------------------------------------------

function DomainPanel({
  domain,
  snapshot,
  loading,
  refreshing,
  onUploaded,
  onRefresh,
}: {
  domain: Domain
  snapshot: TableSnapshot | undefined
  loading: boolean
  refreshing: boolean
  onUploaded: (table: SourceTable) => void | Promise<void>
  onRefresh: () => void
}) {
  const spec = TABLE_SPECS[domain.table]
  const rows = snapshot?.rows ?? []
  const isFallback = snapshot ? snapshot.origin !== 'database' : false

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="space-y-4"
    >
      {/* -------------------------------------------- domain status header */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="rounded-lg bg-slate-100 p-2.5 text-slate-600">
            <domain.icon size={20} />
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-slate-800">{domain.title}</h3>
            <p className="mt-0.5 text-sm text-slate-500">{domain.blurb}</p>
          </div>

          <StatusBadge snapshot={snapshot} />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-3">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Rows loaded
            </dt>
            <dd className="mt-0.5 text-xl font-bold text-slate-800">
              {loading && !snapshot ? '…' : snapshot?.origin === 'database' ? snapshot.count : 0}
            </dd>
          </div>

          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Last upload
            </dt>
            <dd className="mt-0.5 text-sm text-slate-700">
              {loading && !snapshot ? '…' : formatTimestamp(snapshot?.lastUpload ?? null)}
            </dd>
          </div>

          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Table
            </dt>
            <dd className="mt-0.5 font-mono text-sm text-slate-700">
              {domain.table}
            </dd>
          </div>
        </dl>

        {snapshot?.error && (
          <p className="mt-3 rounded border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
            {snapshot.error}
          </p>
        )}
      </section>

      {/* -------------------------------------------------------- uploader */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h4 className="mb-3 text-sm font-bold text-slate-800">
          Upload {spec.label}
        </h4>
        <CsvUploader table={domain.table} compact onUploaded={onUploaded} />
      </section>

      {/* --------------------------------------------------------- preview */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
          <h4 className="text-sm font-bold text-slate-800">Dataset Preview</h4>

          <span className="text-xs text-slate-500">
            {rows.length === 0
              ? 'no records'
              : `showing ${rows.length} most recent`}
          </span>

          {isFallback && rows.length > 0 && (
            <Badge variant="synthetic">Sample data — not from the database</Badge>
          )}

          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-[#003C71] hover:underline disabled:opacity-50"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {loading && !snapshot ? (
          <div className="space-y-2 p-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-slate-100" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <Database size={32} className="mx-auto mb-2 text-slate-300" />
            <p className="text-sm text-slate-500">
              No records yet. Upload a CSV above to populate{' '}
              <code className="font-mono text-xs">{domain.table}</code>.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {domain.preview.map((column) => (
                  <TableHead key={column.key}>{column.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => (
                <TableRow key={String(row.id ?? index)}>
                  {domain.preview.map((column) => (
                    <TableCell
                      key={column.key}
                      className={
                        column.key.endsWith('_id') || column.key === 'section_code'
                          ? 'font-mono font-semibold'
                          : undefined
                      }
                    >
                      {formatCell(row[column.key], column.key)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </motion.div>
  )
}
