// lib/spatial-logic.ts
//
// Longitudinal safety separation between concurrent work sites.
//
// Two gangs working the same block section must be kept far enough apart that
// one cannot stray into the other's work zone. This runs BEFORE the model is
// asked to co-locate anything, so the AI is only ever offered groupings that
// are already physically safe -- rather than being asked to respect a safety
// rule it has no way to verify.

import type { Department, MaintenanceDefect } from '@/lib/types'

/** Minimum longitudinal separation between concurrent work sites, in metres. */
export const SAFETY_BUFFER_METRES = 500

const METRES_PER_KM = 1000

export type SafetyDisposition =
  /** Sites are far enough apart to work at the same time. */
  | 'CLEAR'
  /** Inside the buffer, but workable under a speed restriction. */
  | 'REQUIRES_TEMPORARY_TRAFFIC_SPEED_RESTRICTION'
  /** Inside the buffer and not mitigable together; must be sequenced. */
  | 'SPLIT_SEQUENTIAL'

/** A work site reduced to the span of track it occupies. */
export type WorkExtent = {
  defectId: string
  assetId: string
  department: Department
  sectionCode: string
  /** Kilometre post at the near end of the work site. */
  startKm: number
  /** Kilometre post at the far end. Equals startKm for a point site. */
  endKm: number
  /** True when the source gave only a point, so the extent is an assumption. */
  isPoint: boolean
  durationHrs: number
}

export type SpatialConflict = {
  sectionCode: string
  a: WorkExtent
  b: WorkExtent
  /** Gap between the two extents in metres. Negative means they overlap. */
  separationMetres: number
  disposition: Exclude<SafetyDisposition, 'CLEAR'>
  reason: string
}

/** One set of defects that may safely share a single block. */
export type SafeGroup = {
  sectionCode: string
  /** 1-based ordinal when a section had to be split into sequential blocks. */
  sequence: number
  defectIds: string[]
  departments: Department[]
  chainageStartKm: number | null
  chainageEndKm: number | null
  requiresSpeedRestriction: boolean
}

export type SpatialAnalysis = {
  groups: SafeGroup[]
  conflicts: SpatialConflict[]
  /** Defects carrying no chainage at all, so separation is unverifiable. */
  unlocatedDefectIds: string[]
  bufferMetres: number
}

type ChainageSource = {
  chainage_km?: number | string | null
  chainage_start_km?: number | string | null
  chainage_end_km?: number | string | null
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Reduces a defect to the span of track it occupies.
 *
 * Returns null when the row carries no usable chainage — separation cannot be
 * asserted for such a site, and quietly assuming zero would be unsafe.
 */
export function toWorkExtent(
  defect: MaintenanceDefect & ChainageSource
): WorkExtent | null {
  const explicitStart = toNumber(defect.chainage_start_km)
  const explicitEnd = toNumber(defect.chainage_end_km)
  const point = toNumber(defect.chainage_km)

  let startKm: number
  let endKm: number
  let isPoint: boolean

  if (explicitStart !== null && explicitEnd !== null) {
    startKm = Math.min(explicitStart, explicitEnd)
    endKm = Math.max(explicitStart, explicitEnd)
    isPoint = false
  } else if (point !== null) {
    // The source workbooks publish a single kilometre post per work site.
    startKm = point
    endKm = point
    isPoint = true
  } else {
    return null
  }

  return {
    defectId: defect.id,
    assetId: defect.asset_id,
    department: defect.department,
    sectionCode: defect.section_code,
    startKm,
    endKm,
    isPoint,
    durationHrs: Number(defect.duration_required_hrs) || 0,
  }
}

/**
 * Gap between two extents in metres.
 *
 * Zero means they touch; negative means they overlap.
 */
export function separationMetres(a: WorkExtent, b: WorkExtent): number {
  const gapKm = a.startKm > b.endKm ? a.startKm - b.endKm : b.startKm - a.endKm
  return gapKm * METRES_PER_KM
}

/**
 * Decides whether two sites may be worked concurrently.
 *
 * Work from different departments inside the buffer can often proceed under a
 * temporary speed restriction. Overlapping extents cannot: the gangs would be
 * occupying the same track, so those are sequenced instead.
 */
export function classifyPair(
  a: WorkExtent,
  b: WorkExtent,
  bufferMetres = SAFETY_BUFFER_METRES
): { disposition: SafetyDisposition; separationMetres: number; reason: string } {
  const gap = separationMetres(a, b)

  if (gap >= bufferMetres) {
    return {
      disposition: 'CLEAR',
      separationMetres: gap,
      reason: `${Math.round(gap)} m apart, at or beyond the ${bufferMetres} m buffer.`,
    }
  }

  if (gap < 0) {
    return {
      disposition: 'SPLIT_SEQUENTIAL',
      separationMetres: gap,
      reason: `Work extents overlap by ${Math.round(Math.abs(gap))} m; the gangs would share track, so the work must be sequenced.`,
    }
  }

  return {
    disposition: 'REQUIRES_TEMPORARY_TRAFFIC_SPEED_RESTRICTION',
    separationMetres: gap,
    reason: `Only ${Math.round(gap)} m apart, inside the ${bufferMetres} m buffer; concurrent work needs a temporary speed restriction.`,
  }
}

/**
 * Groups a section's defects into sets that may share one block.
 *
 * Sites are ordered by chainage and packed greedily: a defect joins the
 * current group while it stays clear of, or merely speed-restricted against,
 * everything already in it. An overlap forces a new sequential group.
 *
 * Greedy packing is deliberate — it keeps the grouping explainable to a
 * controller reading the block order, which matters more here than squeezing
 * out a theoretically optimal partition.
 */
function groupSection(
  sectionCode: string,
  extents: WorkExtent[],
  bufferMetres: number,
  conflicts: SpatialConflict[]
): SafeGroup[] {
  const ordered = [...extents].sort((a, b) => a.startKm - b.startKm)
  const groups: SafeGroup[] = []

  let current: WorkExtent[] = []
  let currentNeedsTsr = false

  const flush = () => {
    if (current.length === 0) return
    groups.push({
      sectionCode,
      sequence: groups.length + 1,
      defectIds: current.map((e) => e.defectId),
      departments: Array.from(new Set(current.map((e) => e.department))),
      chainageStartKm: Math.min(...current.map((e) => e.startKm)),
      chainageEndKm: Math.max(...current.map((e) => e.endKm)),
      requiresSpeedRestriction: currentNeedsTsr,
    })
    current = []
    currentNeedsTsr = false
  }

  for (const extent of ordered) {
    let mustSplit = false
    let needsTsr = false

    for (const member of current) {
      const verdict = classifyPair(member, extent, bufferMetres)
      if (verdict.disposition === 'CLEAR') continue

      conflicts.push({
        sectionCode,
        a: member,
        b: extent,
        separationMetres: verdict.separationMetres,
        disposition: verdict.disposition,
        reason: verdict.reason,
      })

      if (verdict.disposition === 'SPLIT_SEQUENTIAL') mustSplit = true
      else needsTsr = true
    }

    if (mustSplit) {
      flush()
      current = [extent]
      continue
    }

    current.push(extent)
    if (needsTsr) currentNeedsTsr = true
  }

  flush()
  return groups
}

/**
 * Runs the spatial pre-pass over the whole backlog.
 */
export function analyseSpatialSafety(
  defects: (MaintenanceDefect & ChainageSource)[],
  bufferMetres: number = SAFETY_BUFFER_METRES
): SpatialAnalysis {
  const bySection = new Map<string, WorkExtent[]>()
  const unlocatedDefectIds: string[] = []

  for (const defect of defects) {
    const extent = toWorkExtent(defect)
    if (!extent) {
      unlocatedDefectIds.push(defect.id)
      continue
    }
    const list = bySection.get(extent.sectionCode) ?? []
    list.push(extent)
    bySection.set(extent.sectionCode, list)
  }

  const conflicts: SpatialConflict[] = []
  const groups: SafeGroup[] = []

  for (const [sectionCode, extents] of bySection) {
    groups.push(...groupSection(sectionCode, extents, bufferMetres, conflicts))
  }

  return { groups, conflicts, unlocatedDefectIds, bufferMetres }
}
