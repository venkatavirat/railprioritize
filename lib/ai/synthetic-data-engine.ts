// lib/ai/synthetic-data-engine.ts
//
// Generates realistic stand-in data for any source system that has no rows
// yet, so the optimiser and dashboard stay demonstrable before real TMS/SMMS/
// TDMS/COA extracts have been ingested.
//
// Output is deterministic for a given seed: the same seed always yields the
// same dataset, so a demo can be rehearsed and a bug reproduced.

import type { SourceTable } from '@/lib/source-tables'

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — small, fast, and stable across runs.
// ---------------------------------------------------------------------------
function createRandom(seed: number) {
  let state = seed >>> 0
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Rng = () => number

const pick = <T,>(rng: Rng, items: readonly T[]): T =>
  items[Math.floor(rng() * items.length)]

const range = (rng: Rng, min: number, max: number) => rng() * (max - min) + min

const intRange = (rng: Rng, min: number, max: number) =>
  Math.floor(range(rng, min, max + 1))

const round2 = (value: number) => Math.round(value * 100) / 100

/** Real South Central Railway section codes. */
export const SYNTHETIC_SECTIONS = [
  'SC-KZJ-UP',
  'SC-KZJ-DN',
  'BZA-GNT-UP',
  'SC-MED-UP',
  'GTL-DHNE-DN',
] as const

const TMS_ASSETS = ['TRK', 'BRG', 'PSP', 'CRS'] as const
const SMMS_ASSETS = ['PT', 'SIG', 'AXC', 'IPS'] as const
const TDMS_ASSETS = ['OHE', 'TSS', 'SP', 'NS'] as const

const TMS_DEFECTS = [
  'Deep screening required — fouled ballast, degraded drainage',
  'Rail profile grinding due — gauge corner checking',
  'Weld renewal — suspect AT welds flagged by USFD',
  'Track tamping and lifting, cross-level defects beyond limit',
  'Girder bearing inspection overdue on minor bridge',
  'Ballast cushion deficiency over curve approach',
] as const

const SMMS_DEFECTS = [
  'Point machine overhaul — obstruction test failure',
  'LED signal unit replacement — intermittent aspect failure',
  'Axle counter reset card replacement, repeated resets',
  'IPS battery bank replacement — backup below rated capacity',
  'Relay room earth fault investigation',
  'Cable insulation megger values below threshold',
] as const

const TDMS_DEFECTS = [
  'Insulator replacement — tracking marks on cantilever insulators',
  'Contact wire wear beyond permissible limit',
  'Traction substation breaker maintenance overdue',
  'Dropper renewal and tension adjustment',
  'Section insulator overhaul, arcing reported by loco pilots',
  'Auto-transformer oil filtration due',
] as const

const DENSITIES = ['Low', 'Low', 'Low', 'Medium', 'High'] as const

export type SyntheticDefect = {
  asset_id: string
  section_code: string
  defect_description: string
  risk_score: number
  duration_required_hrs: number
  asset_criticality_score: number
  is_overdue: boolean
}

export type SyntheticDemand = {
  demand_id: string
  department: string
  section_code: string
  requested_start: string
  requested_end: string
  duration_required_hrs: number
  purpose: string
  status: string
}

export type SyntheticSlot = {
  section_code: string
  slot_start: string
  slot_end: string
  freight_impact_score: number
  passenger_traffic_density: string
}

export type SyntheticRow = SyntheticDefect | SyntheticDemand | SyntheticSlot

export type SyntheticOptions = {
  /** Same seed ⇒ same data. */
  seed?: number
  /** How many rows to produce. Defaults are tuned per table. */
  count?: number
  /** Restrict generation to these sections. */
  sections?: readonly string[]
  /** Anchor for generated timestamps. Defaults to now. */
  now?: Date
}

function defectsFor(
  table: 'tms_defects' | 'smms_defects' | 'tdms_defects',
  rng: Rng,
  count: number,
  sections: readonly string[]
): SyntheticDefect[] {
  const config = {
    tms_defects: { prefixes: TMS_ASSETS, descriptions: TMS_DEFECTS },
    smms_defects: { prefixes: SMMS_ASSETS, descriptions: SMMS_DEFECTS },
    tdms_defects: { prefixes: TDMS_ASSETS, descriptions: TDMS_DEFECTS },
  }[table]

  const rows: SyntheticDefect[] = []
  const used = new Set<string>()

  for (let i = 0; i < count; i += 1) {
    // Spread round-robin across sections so every section gets work from every
    // system — that is what creates genuine multi-department co-use.
    const section = sections[i % sections.length]

    let assetId = ''
    do {
      assetId = `${pick(rng, config.prefixes)}-${intRange(rng, 100, 9999)}`
    } while (used.has(assetId))
    used.add(assetId)

    const criticality = intRange(rng, 3, 10)
    // Risk tracks criticality with noise, so the two stay plausibly correlated.
    const risk = Math.min(99, Math.max(20, criticality * 9 + range(rng, -12, 12)))

    rows.push({
      asset_id: assetId,
      section_code: section,
      defect_description: pick(rng, config.descriptions),
      risk_score: round2(risk),
      duration_required_hrs: round2(range(rng, 1, 4)),
      asset_criticality_score: criticality,
      // High-risk assets are likelier to have slipped.
      is_overdue: rng() < (risk > 75 ? 0.65 : 0.25),
    })
  }

  return rows
}

function demands(
  rng: Rng,
  count: number,
  sections: readonly string[],
  now: Date
): SyntheticDemand[] {
  const departments = ['Engineering', 'S&T', 'Traction_TRD']
  const rows: SyntheticDemand[] = []

  for (let i = 0; i < count; i += 1) {
    const dayOffset = intRange(rng, 1, 14)
    const start = new Date(now)
    start.setUTCDate(start.getUTCDate() + dayOffset)
    start.setUTCHours(intRange(rng, 0, 3), pick(rng, [0, 30]), 0, 0)

    const duration = round2(range(rng, 1.5, 4))
    const end = new Date(start.getTime() + duration * 3_600_000)

    rows.push({
      demand_id: `BD-${String(10_000 + i)}`,
      department: departments[i % departments.length],
      section_code: sections[i % sections.length],
      requested_start: start.toISOString(),
      requested_end: end.toISOString(),
      duration_required_hrs: duration,
      purpose: 'Scheduled maintenance block request',
      status: 'Pending',
    })
  }

  return rows
}

function slots(
  rng: Rng,
  count: number,
  sections: readonly string[],
  now: Date
): SyntheticSlot[] {
  const rows: SyntheticSlot[] = []
  const seen = new Set<string>()

  for (let i = 0; i < count; i += 1) {
    const section = sections[i % sections.length]
    const dayOffset = Math.floor(i / sections.length) + 1

    const start = new Date(now)
    start.setUTCDate(start.getUTCDate() + dayOffset)
    // Maintenance corridors sit in the small hours, when traffic is thinnest.
    start.setUTCHours(intRange(rng, 0, 2), pick(rng, [0, 30]), 0, 0)

    const key = `${section}|${start.toISOString()}`
    if (seen.has(key)) continue
    seen.add(key)

    const end = new Date(start.getTime() + range(rng, 3, 5) * 3_600_000)

    rows.push({
      section_code: section,
      slot_start: start.toISOString(),
      slot_end: end.toISOString(),
      freight_impact_score: intRange(rng, 1, 5),
      passenger_traffic_density: pick(rng, DENSITIES),
    })
  }

  return rows
}

const DEFAULT_COUNTS: Record<SourceTable, number> = {
  tms_defects: 6,
  smms_defects: 6,
  tdms_defects: 6,
  bdms_demands: 6,
  coa_slots: 10,
}

/**
 * Produces synthetic rows shaped for one source table.
 *
 * Used as the fallback when a table has no real records yet.
 */
export function generateSyntheticData(
  table: SourceTable,
  options: SyntheticOptions = {}
): SyntheticRow[] {
  const {
    seed = 20260904,
    sections = SYNTHETIC_SECTIONS,
    now = new Date(),
    count = DEFAULT_COUNTS[table],
  } = options

  if (sections.length === 0) return []

  // Derive a per-table seed so tables differ from each other but each stays
  // stable across runs.
  const tableSeed = seed + table.length * 7919 + table.charCodeAt(0) * 104729
  const rng = createRandom(tableSeed)

  switch (table) {
    case 'tms_defects':
    case 'smms_defects':
    case 'tdms_defects':
      return defectsFor(table, rng, count, sections)
    case 'bdms_demands':
      return demands(rng, count, sections, now)
    case 'coa_slots':
      return slots(rng, count, sections, now)
  }
}
