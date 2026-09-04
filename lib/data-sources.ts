// lib/data-sources.ts
//
// Reads the five source-system tables and normalises them into the single
// shape the optimiser and dashboard both consume.
//
// Any table that returns zero rows falls back to the synthetic engine, so the
// system stays demonstrable before real extracts land. Each source reports
// its own origin so the UI can be honest about which data is real.

import { createSupabaseServiceClient } from '@/lib/supabase/server'
import {
  generateSyntheticData,
  type SyntheticDefect,
  type SyntheticSlot,
} from '@/lib/ai/synthetic-data-engine'
import {
  SOURCE_TABLES,
  TABLE_DEPARTMENT,
  TABLE_SYSTEM,
  type SourceTable,
} from '@/lib/source-tables'
import type { CorridorWindow, Department, MaintenanceDefect } from '@/lib/types'

export type SourceOrigin = 'database' | 'synthetic' | 'unavailable'

export type SourceReport = {
  table: SourceTable
  origin: SourceOrigin
  rows: number
  error?: string
}

export type UnifiedDataset = {
  defects: MaintenanceDefect[]
  windows: CorridorWindow[]
  sources: SourceReport[]
  /** True when any part of the dataset came from the synthetic engine. */
  usedSynthetic: boolean
}

const DEFECT_TABLES = ['tms_defects', 'smms_defects', 'tdms_defects'] as const
type DefectTable = (typeof DEFECT_TABLES)[number]

type RawRow = Record<string, unknown>

/** Per-table view used by the Data Control Center. */
export type TableSnapshot = {
  table: SourceTable
  origin: SourceOrigin
  /** True row count in the table (0 when falling back). */
  count: number
  /** Newest created_at in the table, or null when there is no real data. */
  lastUpload: string | null
  /** Most recent rows, for the preview table. */
  rows: RawRow[]
  error?: string
}

/** Default number of preview rows returned per table. */
export const PREVIEW_LIMIT = 10

/**
 * Loads one source table's status and a preview of its newest rows.
 *
 * Falls back to synthetic rows when the table is empty or unreachable, so the
 * UI always has something to show — flagged via `origin` so it is never
 * mistaken for real data.
 */
export async function loadTableSnapshot(
  table: SourceTable,
  limit: number = PREVIEW_LIMIT
): Promise<TableSnapshot> {
  const synthesise = (error?: string): TableSnapshot => {
    const rows = generateSyntheticData(table) as unknown as RawRow[]
    return {
      table,
      origin: error ? 'unavailable' : 'synthetic',
      count: 0,
      lastUpload: null,
      rows: rows.slice(0, limit),
      ...(error ? { error } : {}),
    }
  }

  let client: ReturnType<typeof createSupabaseServiceClient>
  try {
    client = createSupabaseServiceClient()
  } catch (error) {
    return synthesise(
      error instanceof Error ? error.message : 'Supabase not configured'
    )
  }

  try {
    const { data, error, count } = await client
      .from(table)
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) return synthesise(error.message)

    const rows = (data ?? []) as RawRow[]
    if (rows.length === 0) return synthesise()

    return {
      table,
      origin: 'database',
      count: count ?? rows.length,
      // Rows are ordered newest-first, so the head carries the latest upload.
      lastUpload: (rows[0]?.created_at as string | undefined) ?? null,
      rows,
    }
  } catch (error) {
    return synthesise(error instanceof Error ? error.message : 'query failed')
  }
}

/** Loads snapshots for every source table, in registry order. */
export async function loadAllSnapshots(
  limit: number = PREVIEW_LIMIT
): Promise<TableSnapshot[]> {
  return Promise.all(SOURCE_TABLES.map((table) => loadTableSnapshot(table, limit)))
}

function toDefect(
  row: RawRow,
  table: DefectTable,
  index: number
): MaintenanceDefect {
  return {
    id: String(row.id ?? `${table}-${index}`),
    department: TABLE_DEPARTMENT[table] as Department,
    system_source: TABLE_SYSTEM[table],
    asset_id: String(row.asset_id ?? ''),
    asset_criticality_score: Number(row.asset_criticality_score ?? 5),
    section_code: String(row.section_code ?? ''),
    defect_description: String(row.defect_description ?? ''),
    risk_score: Number(row.risk_score ?? 50),
    duration_required_hrs: Number(row.duration_required_hrs ?? 2),
    is_overdue: Boolean(row.is_overdue),
    created_at: String(row.created_at ?? new Date().toISOString()),
    chainage_km: row.chainage_km === null || row.chainage_km === undefined
      ? null
      : Number(row.chainage_km),
    chainage_start_km:
      row.chainage_start_km === null || row.chainage_start_km === undefined
        ? null
        : Number(row.chainage_start_km),
    chainage_end_km:
      row.chainage_end_km === null || row.chainage_end_km === undefined
        ? null
        : Number(row.chainage_end_km),
  }
}

function toWindow(row: RawRow, index: number): CorridorWindow {
  return {
    id: String(row.id ?? `coa-${index}`),
    section_code: String(row.section_code ?? ''),
    window_start: String(row.slot_start ?? ''),
    window_end: String(row.slot_end ?? ''),
    freight_impact_score: Number(row.freight_impact_score ?? 3),
    passenger_traffic_density: String(row.passenger_traffic_density ?? 'Medium'),
  }
}

/**
 * Loads every source table, substituting synthetic rows for any that are empty.
 *
 * A table that errors (e.g. not created yet) is treated the same as empty —
 * the point of the fallback is that the product still demonstrates.
 */
export async function loadUnifiedDataset(options?: {
  seed?: number
}): Promise<UnifiedDataset> {
  const sources: SourceReport[] = []
  let client: ReturnType<typeof createSupabaseServiceClient> | null = null

  try {
    client = createSupabaseServiceClient()
  } catch (error) {
    // Supabase not configured at all — everything falls back.
    client = null
    for (const table of SOURCE_TABLES) {
      sources.push({
        table,
        origin: 'unavailable',
        rows: 0,
        error: error instanceof Error ? error.message : 'Supabase not configured',
      })
    }
  }

  async function fetchTable(table: SourceTable): Promise<RawRow[] | null> {
    if (!client) return null
    try {
      const { data, error } = await client.from(table).select('*')
      if (error) {
        sources.push({ table, origin: 'unavailable', rows: 0, error: error.message })
        return null
      }
      return (data ?? []) as RawRow[]
    } catch (error) {
      sources.push({
        table,
        origin: 'unavailable',
        rows: 0,
        error: error instanceof Error ? error.message : 'query failed',
      })
      return null
    }
  }

  // Fetch every table in one parallel batch. Awaiting them in sequence cost
  // five serial round trips to Supabase, which dominated the response time.
  const [tmsRows, smmsRows, tdmsRows, slotRows, demandRows] = await Promise.all([
    fetchTable('tms_defects'),
    fetchTable('smms_defects'),
    fetchTable('tdms_defects'),
    fetchTable('coa_slots'),
    fetchTable('bdms_demands'),
  ])

  const defectRowsByTable: Record<DefectTable, RawRow[] | null> = {
    tms_defects: tmsRows,
    smms_defects: smmsRows,
    tdms_defects: tdmsRows,
  }

  // ----- Defect tables ----------------------------------------------------
  const defects: MaintenanceDefect[] = []

  for (const table of DEFECT_TABLES) {
    const rows = defectRowsByTable[table]

    if (rows && rows.length > 0) {
      sources.push({ table, origin: 'database', rows: rows.length })
      rows.forEach((row, i) => defects.push(toDefect(row, table, i)))
      continue
    }

    // Empty (or unavailable) → synthesise.
    const synthetic = generateSyntheticData(table, {
      seed: options?.seed,
    }) as SyntheticDefect[]

    if (rows) {
      sources.push({ table, origin: 'synthetic', rows: synthetic.length })
    } else {
      // An 'unavailable' report was already pushed by fetchTable; record that
      // we still produced usable rows for it.
      const report = sources.find((s) => s.table === table)
      if (report) report.rows = synthetic.length
    }

    synthetic.forEach((row, i) =>
      defects.push(toDefect(row as unknown as RawRow, table, i))
    )
  }

  // ----- Corridor slots ---------------------------------------------------
  let windows: CorridorWindow[] = []

  if (slotRows && slotRows.length > 0) {
    sources.push({ table: 'coa_slots', origin: 'database', rows: slotRows.length })
    windows = slotRows.map(toWindow)
  } else {
    const synthetic = generateSyntheticData('coa_slots', {
      seed: options?.seed,
    }) as SyntheticSlot[]

    if (slotRows) {
      sources.push({ table: 'coa_slots', origin: 'synthetic', rows: synthetic.length })
    } else {
      const report = sources.find((s) => s.table === 'coa_slots')
      if (report) report.rows = synthetic.length
    }

    windows = synthetic.map((row, i) => toWindow(row as unknown as RawRow, i))
  }

  // ----- BDMS demands -----------------------------------------------------
  // Reported for visibility. The optimiser derives its work from defects; the
  // demands table records what departments asked for under the old process.
  if (demandRows) {
    if (demandRows.length > 0) {
      sources.push({
        table: 'bdms_demands',
        origin: 'database',
        rows: demandRows.length,
      })
    } else {
      const synthetic = generateSyntheticData('bdms_demands', { seed: options?.seed })
      sources.push({
        table: 'bdms_demands',
        origin: 'synthetic',
        rows: synthetic.length,
      })
    }
  }

  defects.sort((a, b) => Number(b.risk_score) - Number(a.risk_score))
  windows.sort(
    (a, b) =>
      new Date(a.window_start).getTime() - new Date(b.window_start).getTime()
  )

  return {
    defects,
    windows,
    sources,
    usedSynthetic: sources.some((s) => s.origin !== 'database'),
  }
}
