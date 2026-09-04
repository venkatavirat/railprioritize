import { GoogleGenAI, Type } from '@google/genai'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import type {
  CorridorWindow,
  MaintenanceDefect,
  OptimizationResult,
} from '@/lib/types'

// Talks to Gemini and Supabase on every call — never prerender or cache.
export const dynamic = 'force-dynamic'

// The original spec named gemini-2.5-flash, but Google now rejects it for
// newly-issued API keys ("no longer available to new users") and points at
// gemini-3.6-flash. Override with GEMINI_MODEL if your key differs.
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash'

/** Caps how much backlog we hand the model in one request. */
const MAX_DEFECTS = 120
const MAX_WINDOWS = 60

const SYSTEM_INSTRUCTION = `You are the Chief AI Block Optimization Engine for Indian Railways (SCR Division). Reconcile competing maintenance requests from Engineering (TMS), Signalling (SMMS), and Traction (TDMS) against operational corridor availability (COA).

OBJECTIVES:
1. Maximize Multi-Department Block Co-use (combine compatible Engineering, S&T, and TRD tasks into single corridor closures).
2. Minimize total network infrastructure downtime.
3. Prioritize safety-critical defects and overdue high-risk assets.
4. Minimize disruption to passenger and freight train operations.

RULES:
- Only combine tasks that share the same section_code.
- A block must fit inside one supplied corridor window; never invent a window.
- Prefer windows with Low passenger traffic density and a low freight impact score.
- downtime_saved_hours for a block = (sum of the individual task durations) - (the block's actual wall-clock duration). It is 0 when a block holds only one task.
- Timestamps must be ISO-8601 UTC strings ending in Z.
- Reference only asset IDs supplied in the input.`

/** Strict output contract enforced by the model's structured-output mode. */
const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    kpi_metrics: {
      type: Type.OBJECT,
      properties: {
        network_safety_index: {
          type: Type.NUMBER,
          description: '0-100 index of post-plan network safety.',
        },
        total_downtime_saved_hrs: { type: Type.NUMBER },
        multi_dept_co_use_rate_pct: {
          type: Type.NUMBER,
          description: 'Percentage of blocks combining two or more departments.',
        },
        overdue_backlog_reduced_pct: { type: Type.NUMBER },
      },
      required: [
        'network_safety_index',
        'total_downtime_saved_hrs',
        'multi_dept_co_use_rate_pct',
        'overdue_backlog_reduced_pct',
      ],
    },
    optimized_blocks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          section_code: { type: Type.STRING },
          block_window_start: { type: Type.STRING },
          block_window_end: { type: Type.STRING },
          combined_departments: {
            type: Type.ARRAY,
            items: {
              type: Type.STRING,
              enum: ['Engineering', 'S&T', 'Traction_TRD'],
            },
          },
          combined_tasks: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                dept: {
                  type: Type.STRING,
                  enum: ['Engineering', 'S&T', 'Traction_TRD'],
                },
                asset: { type: Type.STRING },
                task: { type: Type.STRING },
              },
              required: ['dept', 'asset', 'task'],
            },
          },
          downtime_saved_hours: { type: Type.NUMBER },
          traffic_impact: { type: Type.STRING },
        },
        required: [
          'section_code',
          'block_window_start',
          'block_window_end',
          'combined_departments',
          'combined_tasks',
          'downtime_saved_hours',
          'traffic_impact',
        ],
      },
    },
    executive_summary: { type: Type.STRING },
  },
  required: ['kpi_metrics', 'optimized_blocks', 'executive_summary'],
}

const EMPTY_RESULT: OptimizationResult = {
  kpi_metrics: {
    network_safety_index: 0,
    total_downtime_saved_hrs: 0,
    multi_dept_co_use_rate_pct: 0,
    overdue_backlog_reduced_pct: 0,
  },
  optimized_blocks: [],
  executive_summary:
    'No optimisation performed — there is no pending maintenance backlog for the selected horizon.',
}

export async function POST(request: NextRequest) {
  // Horizon is optional; the dashboard toggle sends it.
  let horizon: 'weekly' | 'monthly' = 'weekly'
  try {
    const body = await request.json()
    if (body?.horizon === 'monthly') horizon = 'monthly'
  } catch {
    // No body is fine — fall back to the weekly plan.
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey || apiKey.startsWith('REPLACE_ME')) {
    return NextResponse.json(
      {
        error:
          'GEMINI_API_KEY is not configured. Add it to .env.local and restart the dev server.',
      },
      { status: 503 }
    )
  }

  // ----- 1. Retrieve the backlog and corridor availability -----------------
  let defects: MaintenanceDefect[] = []
  let windows: CorridorWindow[] = []

  try {
    const supabase = createSupabaseServiceClient()
    const horizonDays = horizon === 'monthly' ? 30 : 7
    const horizonEnd = new Date(
      Date.now() + horizonDays * 24 * 60 * 60 * 1000
    ).toISOString()

    const [defectResult, windowResult] = await Promise.all([
      supabase
        .from('maintenance_defects')
        .select('*')
        .order('risk_score', { ascending: false })
        .limit(MAX_DEFECTS),
      supabase
        .from('corridor_windows')
        .select('*')
        .lte('window_start', horizonEnd)
        .order('window_start', { ascending: true })
        .limit(MAX_WINDOWS),
    ])

    if (defectResult.error) throw new Error(defectResult.error.message)
    if (windowResult.error) throw new Error(windowResult.error.message)

    defects = (defectResult.data ?? []) as MaintenanceDefect[]
    windows = (windowResult.data ?? []) as CorridorWindow[]
  } catch (error) {
    return NextResponse.json(
      {
        error: `Could not read maintenance data from Supabase: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      },
      { status: 502 }
    )
  }

  if (defects.length === 0) {
    return NextResponse.json(EMPTY_RESULT)
  }

  // ----- 2. Ask Gemini to reconcile them ----------------------------------
  const promptPayload = {
    planning_horizon:
      horizon === 'monthly'
        ? 'Monthly Advance Reservation (next 30 days)'
        : 'Weekly Execution Plan (next 7 days)',
    generated_at: new Date().toISOString(),
    pending_defects: defects.map((d) => ({
      department: d.department,
      system_source: d.system_source,
      asset_id: d.asset_id,
      asset_criticality_score: d.asset_criticality_score,
      section_code: d.section_code,
      defect_description: d.defect_description,
      risk_score: d.risk_score,
      duration_required_hrs: d.duration_required_hrs,
      is_overdue: d.is_overdue,
    })),
    corridor_windows: windows.map((w) => ({
      section_code: w.section_code,
      window_start: w.window_start,
      window_end: w.window_end,
      freight_impact_score: w.freight_impact_score,
      passenger_traffic_density: w.passenger_traffic_density,
    })),
  }

  let result: OptimizationResult
  try {
    const ai = new GoogleGenAI({ apiKey })

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Produce an optimised maintenance block plan for the ${promptPayload.planning_horizon}.\n\nINPUT DATA:\n${JSON.stringify(
                promptPayload,
                null,
                2
              )}`,
            },
          ],
        },
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.2,
      },
    })

    const text = response.text
    if (!text) {
      throw new Error('the model returned an empty response')
    }

    result = JSON.parse(text) as OptimizationResult
  } catch (error) {
    return NextResponse.json(
      {
        error: `AI optimisation failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      },
      { status: 502 }
    )
  }

  // Guard against a well-formed but partially-populated response.
  if (!Array.isArray(result.optimized_blocks)) {
    result.optimized_blocks = []
  }

  // ----- 3. Persist recommendations (best effort) --------------------------
  const persistence = await persistBlocks(result, defects)

  return NextResponse.json({ ...result, persisted: persistence })
}

/**
 * Writes the recommended blocks to `block_schedules`, resolving each block's
 * asset IDs back to defect UUIDs.
 *
 * Failures here are reported but never fail the request — the plan is still
 * useful to display even if it could not be saved.
 */
async function persistBlocks(
  result: OptimizationResult,
  defects: MaintenanceDefect[]
): Promise<{ saved: number; error: string | null }> {
  if (result.optimized_blocks.length === 0) return { saved: 0, error: null }

  const idByAsset = new Map(defects.map((d) => [d.asset_id, d.id]))

  const rows = result.optimized_blocks
    .map((block) => {
      const defectIds = (block.combined_tasks ?? [])
        .map((task) => idByAsset.get(task.asset))
        .filter((id): id is string => Boolean(id))

      const start = Date.parse(block.block_window_start)
      const end = Date.parse(block.block_window_end)
      if (Number.isNaN(start) || Number.isNaN(end)) return null

      return {
        section_code: block.section_code,
        block_start: new Date(start).toISOString(),
        block_end: new Date(end).toISOString(),
        combined_departments: block.combined_departments ?? [],
        assigned_defect_ids: defectIds,
        total_downtime_saved_hrs: Number(block.downtime_saved_hours) || 0,
        status: 'Recommended',
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)

  if (rows.length === 0) return { saved: 0, error: null }

  try {
    const supabase = createSupabaseServiceClient()
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
