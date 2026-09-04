// lib/agent.ts
//
// Autonomous joint-block planning agent.
//
// Runs the daily planning cycle as a tool-calling loop: pull the backlog,
// clear it through the spatial safety rules, propose co-use blocks, score
// them, and persist the survivors as PROPOSED for a controller to action.
//
// Division of labour is deliberate. The model decides *which* work to group;
// it never decides whether a grouping is safe or how much time it saves.
// Those are enforced in code inside the tools, so a hallucinated grouping
// cannot reach the database and a flattering number cannot reach a Sr. DEN.

import { generateText, stepCountIs, tool } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { z } from 'zod'

import { loadUnifiedDataset } from '@/lib/data-sources'
import { createSupabaseWriteClient } from '@/lib/supabase/server'
import { computeDowntimeMetrics, minimumFeasibleHours } from '@/lib/downtime-metrics'
import {
  analyseSpatialSafety,
  SAFETY_BUFFER_METRES,
  type SpatialAnalysis,
} from '@/lib/spatial-logic'
import {
  normalizeDepartment,
  type CorridorWindow,
  type Department,
  type DowntimeMetrics,
  type MaintenanceDefect,
  type OptimizedBlock,
} from '@/lib/types'

/**
 * Section the daily cycle plans for by default.
 *
 * NOTE: this is the value named in the brief. The ingested workbooks use
 * corridor names such as "Danapur-Ara", so a run against real data must pass
 * an explicit section — the agent reports "no backlog" rather than inventing
 * work when the code matches nothing.
 */
export const DEFAULT_SECTION_CODE = 'SEC-SC-KZJ'

/** gemini-2.5-flash is not served to newly-issued keys; see the route. */
const MODEL_ID = process.env.GEMINI_MODEL || 'gemini-3.6-flash'

/** Ceiling on tool-calling rounds, so a confused run cannot loop forever. */
const MAX_STEPS = 12

export type AgentRunResult = {
  sectionCode: string
  summary: string
  blocks: OptimizedBlock[]
  metrics: DowntimeMetrics | null
  spatial: {
    buffer_metres: number
    groups: number
    conflicts: number
    unlocated_defects: number
  } | null
  persisted: { saved: number; error: string | null }
  /** Ordered log of what the agent did, for the audit trail. */
  steps: string[]
  rejected: string[]
}

/** Mutable state shared across tool calls within one run. */
type RunContext = {
  sectionCode: string
  ownerId: string | null
  defects: MaintenanceDefect[]
  windows: CorridorWindow[]
  spatial: SpatialAnalysis | null
  blocks: OptimizedBlock[]
  metrics: DowntimeMetrics | null
  persisted: { saved: number; error: string | null }
  steps: string[]
  rejected: string[]
}

const blockShape = z.object({
  section_code: z.string(),
  block_window_start: z.string().describe('ISO-8601 UTC, ending in Z'),
  block_window_end: z.string().describe('ISO-8601 UTC, ending in Z'),
  combined_departments: z.array(z.string()),
  combined_tasks: z.array(
    z.object({
      dept: z.string(),
      asset: z.string(),
      task: z.string(),
    })
  ),
  downtime_saved_hours: z.number(),
  traffic_impact: z.string(),
})

function buildTools(ctx: RunContext) {
  return {
    // ---------------------------------------------------------------- fetch
    fetchDepartmentData: tool({
      description:
        'Pull the uncoordinated maintenance backlog (TMS, SMMS, TDMS, BDMS) and corridor availability (COA) for a section. Call this first.',
      inputSchema: z.object({
        section_code: z
          .string()
          .optional()
          .describe(`Section to plan. Defaults to ${DEFAULT_SECTION_CODE}.`),
      }),
      execute: async ({ section_code }) => {
        const section = section_code?.trim() || ctx.sectionCode
        ctx.sectionCode = section

        const dataset = await loadUnifiedDataset({ ownerId: ctx.ownerId })

        ctx.defects = dataset.defects.filter((d) => d.section_code === section)
        ctx.windows = dataset.windows.filter((w) => w.section_code === section)

        ctx.steps.push(
          `fetchDepartmentData(${section}) -> ${ctx.defects.length} defects, ${ctx.windows.length} corridor windows`
        )

        if (ctx.defects.length === 0) {
          // Give the model the real vocabulary rather than letting it guess a
          // section name that does not exist in the data.
          const available = Array.from(
            new Set(dataset.defects.map((d) => d.section_code))
          ).slice(0, 25)

          return {
            section_code: section,
            defects: [],
            corridor_windows: [],
            note: `No backlog found for "${section}". Sections present in the data include: ${available.join(', ')}. Do not invent work; report that this section has nothing pending.`,
          }
        }

        return {
          section_code: section,
          defects: ctx.defects.map((d) => ({
            asset_id: d.asset_id,
            department: d.department,
            system_source: d.system_source,
            defect_description: d.defect_description,
            risk_score: d.risk_score,
            duration_required_hrs: d.duration_required_hrs,
            is_overdue: d.is_overdue,
            chainage_km: d.chainage_km ?? null,
          })),
          corridor_windows: ctx.windows.map((w) => ({
            window_start: w.window_start,
            window_end: w.window_end,
            length_hours:
              Math.round(
                ((Date.parse(w.window_end) - Date.parse(w.window_start)) / 3_600_000) *
                  100
              ) / 100,
            freight_impact_score: w.freight_impact_score,
            passenger_traffic_density: w.passenger_traffic_density,
          })),
        }
      },
    }),

    // ----------------------------------------------------------- safety
    checkSpatialSafety: tool({
      description: `Run the ${SAFETY_BUFFER_METRES} m longitudinal buffer check over the fetched backlog. Returns the co-use groups you are allowed to build blocks from. Never combine assets from two different groups.`,
      inputSchema: z.object({}),
      execute: async () => {
        if (ctx.defects.length === 0) {
          return { error: 'Call fetchDepartmentData first; no backlog is loaded.' }
        }

        ctx.spatial = analyseSpatialSafety(ctx.defects)
        const assetById = new Map(ctx.defects.map((d) => [d.id, d.asset_id]))

        ctx.steps.push(
          `checkSpatialSafety -> ${ctx.spatial.groups.length} safe groups, ${ctx.spatial.conflicts.length} conflicts, ${ctx.spatial.unlocatedDefectIds.length} without chainage`
        )

        return {
          buffer_metres: ctx.spatial.bufferMetres,
          groups: ctx.spatial.groups.map((g) => ({
            group_id: `${g.sectionCode}#${g.sequence}`,
            assets: g.defectIds
              .map((id) => assetById.get(id))
              .filter((a): a is string => Boolean(a)),
            departments: g.departments,
            chainage_start_km: g.chainageStartKm,
            chainage_end_km: g.chainageEndKm,
            requires_speed_restriction: g.requiresSpeedRestriction,
          })),
          conflicts: ctx.spatial.conflicts.map((c) => ({
            assets: [c.a.assetId, c.b.assetId],
            separation_metres: Math.round(c.separationMetres),
            disposition: c.disposition,
            reason: c.reason,
          })),
          unlocated_assets: ctx.spatial.unlocatedDefectIds
            .map((id) => assetById.get(id))
            .filter((a): a is string => Boolean(a)),
          note:
            ctx.spatial.unlocatedDefectIds.length > 0
              ? 'Assets without chainage cannot have their separation verified. They may still be scheduled, but only alone in a block.'
              : undefined,
        }
      },
    }),

    // -------------------------------------------------------------- scoring
    calculateDowntime: tool({
      description:
        'Score a set of candidate blocks: uncoordinated vs joint hours, reduction percent, and passenger delay avoided. Arithmetic is done in code, not by you.',
      inputSchema: z.object({ blocks: z.array(blockShape) }),
      execute: async ({ blocks }) => {
        const candidates = blocks as unknown as OptimizedBlock[]
        const metrics = computeDowntimeMetrics(candidates, ctx.defects, ctx.windows)
        ctx.metrics = metrics

        ctx.steps.push(
          `calculateDowntime -> ${metrics.downtime_reduction_percent}% reduction, ${metrics.blocks_not_executable} infeasible`
        )

        return {
          ...metrics,
          warning:
            metrics.blocks_not_executable > 0
              ? `${metrics.blocks_not_executable} block(s) are shorter than their longest task and cannot be executed. Re-plan them into longer windows or drop those tasks.`
              : undefined,
        }
      },
    }),

    // ------------------------------------------------------------- persist
    generateJointBlockPlan: tool({
      description:
        'Persist the final joint block proposals to Supabase with status PROPOSED. Blocks that are unsafe, unfeasible, or reference unknown assets are rejected here.',
      inputSchema: z.object({
        blocks: z.array(blockShape),
        summary: z.string().describe('One-paragraph executive summary.'),
      }),
      execute: async ({ blocks, summary }) => {
        const candidates = blocks as unknown as OptimizedBlock[]
        const known = new Map(ctx.defects.map((d) => [d.asset_id, d]))

        // Validate in code. The model proposes; these rules dispose.
        const accepted: OptimizedBlock[] = []
        for (const block of candidates) {
          const tasks = block.combined_tasks ?? []

          const unknownAssets = tasks
            .map((t) => t.asset)
            .filter((a) => !known.has(a))
          if (unknownAssets.length > 0) {
            ctx.rejected.push(
              `${block.section_code}: references assets not in the backlog (${unknownAssets.join(', ')}).`
            )
            continue
          }

          const start = Date.parse(block.block_window_start)
          const end = Date.parse(block.block_window_end)
          if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
            ctx.rejected.push(`${block.section_code}: invalid or inverted window.`)
            continue
          }

          const hours = (end - start) / 3_600_000
          const floor = minimumFeasibleHours(block, ctx.defects)
          if (hours + 1e-9 < floor) {
            ctx.rejected.push(
              `${block.section_code}: ${hours.toFixed(2)} h window is shorter than its longest task (${floor} h).`
            )
            continue
          }

          // Every task must sit inside one safety group.
          if (ctx.spatial) {
            const groupOf = new Map<string, string>()
            for (const g of ctx.spatial.groups) {
              for (const defectId of g.defectIds) {
                const asset = ctx.defects.find((d) => d.id === defectId)?.asset_id
                if (asset) groupOf.set(asset, `${g.sectionCode}#${g.sequence}`)
              }
            }
            const groups = new Set(
              tasks.map((t) => groupOf.get(t.asset)).filter(Boolean)
            )
            if (groups.size > 1) {
              ctx.rejected.push(
                `${block.section_code}: combines assets from ${groups.size} different safety groups, breaching the ${SAFETY_BUFFER_METRES} m buffer.`
              )
              continue
            }
          }

          accepted.push(block)
        }

        ctx.blocks = accepted
        ctx.metrics = computeDowntimeMetrics(accepted, ctx.defects, ctx.windows)

        ctx.steps.push(
          `generateJointBlockPlan -> ${accepted.length} accepted, ${ctx.rejected.length} rejected`
        )

        if (accepted.length === 0) {
          ctx.persisted = { saved: 0, error: null }
          return {
            saved: 0,
            rejected: ctx.rejected,
            note: 'Nothing was persisted. Every candidate failed validation.',
          }
        }

        ctx.persisted = await persistProposals(accepted, ctx)

        return {
          saved: ctx.persisted.saved,
          error: ctx.persisted.error,
          rejected: ctx.rejected,
          metrics: ctx.metrics,
          summary,
        }
      },
    }),
  }
}

/** Writes accepted blocks as PROPOSED rows. */
async function persistProposals(
  blocks: OptimizedBlock[],
  ctx: RunContext
): Promise<{ saved: number; error: string | null }> {
  const idByAsset = new Map(ctx.defects.map((d) => [d.asset_id, d.id]))
  const isUuid = (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

  const groupByAsset = new Map<string, { start: number | null; end: number | null; tsr: boolean }>()
  for (const g of ctx.spatial?.groups ?? []) {
    for (const defectId of g.defectIds) {
      const asset = ctx.defects.find((d) => d.id === defectId)?.asset_id
      if (asset) {
        groupByAsset.set(asset, {
          start: g.chainageStartKm,
          end: g.chainageEndKm,
          tsr: g.requiresSpeedRestriction,
        })
      }
    }
  }

  const rows = blocks.map((block) => {
    const tasks = block.combined_tasks ?? []
    const meta = tasks.map((t) => groupByAsset.get(t.asset)).filter(Boolean)
    const starts = meta.map((m) => m!.start).filter((v): v is number => v !== null)
    const ends = meta.map((m) => m!.end).filter((v): v is number => v !== null)
    const tsr = meta.some((m) => m!.tsr)

    const departments = (block.combined_departments ?? [])
      .map((d) => normalizeDepartment(d))
      .filter((d): d is Department => d !== null)

    return {
      section_code: block.section_code,
      block_start: new Date(block.block_window_start).toISOString(),
      block_end: new Date(block.block_window_end).toISOString(),
      original_block_start: new Date(block.block_window_start).toISOString(),
      original_block_end: new Date(block.block_window_end).toISOString(),
      combined_departments: departments,
      assigned_defect_ids: tasks
        .map((t) => idByAsset.get(t.asset))
        .filter((id): id is string => Boolean(id) && isUuid(id as string)),
      total_downtime_saved_hrs: Number(block.downtime_saved_hours) || 0,
      status: 'PROPOSED',
      uploaded_by: ctx.ownerId,
      chainage_start_km: starts.length > 0 ? Math.min(...starts) : null,
      chainage_end_km: ends.length > 0 ? Math.max(...ends) : null,
      safety_flags: {
        requiresSpeedRestriction: tsr,
        notes: tsr
          ? [
              `Concurrent work inside the ${SAFETY_BUFFER_METRES} m longitudinal buffer; a temporary speed restriction is required.`,
            ]
          : [],
      },
      coa_window_ref: block.traffic_impact ?? null,
    }
  })

  try {
    const supabase = await createSupabaseWriteClient()
    const { error } = await supabase.from('block_schedules').insert(rows)
    if (error) return { saved: 0, error: error.message }
    return { saved: rows.length, error: null }
  } catch (error) {
    return {
      saved: 0,
      error: error instanceof Error ? error.message : 'unknown error',
    }
  }
}

const SYSTEM_PROMPT = `You are the autonomous block planning agent for Indian Railways (SCR Division), responsible for the daily joint block plan.

Work in this order, using your tools:
1. fetchDepartmentData - load the backlog and corridor availability.
2. checkSpatialSafety - obtain the co-use groups you are permitted to build from.
3. calculateDowntime - score your candidate blocks before committing to them.
4. generateJointBlockPlan - persist the final proposals.

HARD RULES:
- Only combine tasks that appear together in the SAME safety group. Those separations are a physical safety constraint.
- A block must fit inside one supplied corridor window. Never invent a window.
- A block must be LONG ENOUGH for its work: because departments work in parallel, its duration must be at least the longest single task it contains. If no window on the section is long enough for a task, leave that task unscheduled. An unexecutable block is worse than an unscheduled one.
- Reference only asset IDs returned by fetchDepartmentData.
- Timestamps must be ISO-8601 UTC ending in Z.
- If the section has no backlog, say so plainly and stop. Do not fabricate work.

Finish with a short plain-language summary of what you scheduled and what you deliberately left out.`

/**
 * Runs one planning cycle.
 *
 * Safe to invoke from a cron trigger or an operator button — it is read-only
 * until `generateJointBlockPlan` succeeds, and everything it writes lands as
 * PROPOSED for a controller to approve.
 */
export async function runPlanningAgent(options?: {
  sectionCode?: string
  apiKey?: string
  /** Account the run belongs to; scopes both the data read and rows written. */
  ownerId?: string | null
}): Promise<AgentRunResult> {
  const apiKey = options?.apiKey ?? process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured.')
  }

  const ctx: RunContext = {
    sectionCode: options?.sectionCode?.trim() || DEFAULT_SECTION_CODE,
    ownerId: options?.ownerId ?? null,
    defects: [],
    windows: [],
    spatial: null,
    blocks: [],
    metrics: null,
    persisted: { saved: 0, error: null },
    steps: [],
    rejected: [],
  }

  const google = createGoogleGenerativeAI({ apiKey })

  const { text } = await generateText({
    model: google(MODEL_ID),
    system: SYSTEM_PROMPT,
    prompt: `Produce today's joint block plan for section ${ctx.sectionCode}.`,
    tools: buildTools(ctx),
    stopWhen: stepCountIs(MAX_STEPS),
  })

  return {
    sectionCode: ctx.sectionCode,
    summary: text?.trim() || 'The agent produced no closing summary.',
    blocks: ctx.blocks,
    metrics: ctx.metrics,
    spatial: ctx.spatial
      ? {
          buffer_metres: ctx.spatial.bufferMetres,
          groups: ctx.spatial.groups.length,
          conflicts: ctx.spatial.conflicts.length,
          unlocated_defects: ctx.spatial.unlocatedDefectIds.length,
        }
      : null,
    persisted: ctx.persisted,
    steps: ctx.steps,
    rejected: ctx.rejected,
  }
}
