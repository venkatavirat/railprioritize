import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isDevAuthBypassEnabled } from '@/lib/auth-flags'
import { runPlanningAgent, DEFAULT_SECTION_CODE } from '@/lib/agent'
import { getCurrentUserId } from '@/lib/current-user'

export const dynamic = 'force-dynamic'

/** A tool-calling run is slow; give it room before the platform cuts it off. */
export const maxDuration = 300

/**
 * Triggers one autonomous planning cycle.
 *
 * Two ways in:
 *  - An operator, signed in (the dashboard button).
 *  - A scheduler, presenting CRON_SECRET as a bearer token, since a cron job
 *    has no Supabase session to offer.
 *
 * Either way the run is billed and writes to the database, so it is never
 * anonymous.
 */
async function authorise(request: NextRequest): Promise<string | null> {
  if (isDevAuthBypassEnabled()) return 'Local developer (auth bypass)'

  // Scheduled invocation.
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return 'Scheduled agent run'
  }

  // Interactive invocation.
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name,email')
      .eq('id', user.id)
      .maybeSingle()

    return profile?.full_name || profile?.email || user.email || 'Controller'
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  const actor = await authorise(request)
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let sectionCode = DEFAULT_SECTION_CODE
  try {
    const body = await request.json()
    if (typeof body?.section_code === 'string' && body.section_code.trim()) {
      sectionCode = body.section_code.trim()
    }
  } catch {
    // No body is fine — plan the default section.
  }

  const startedAt = Date.now()

  try {
    const result = await runPlanningAgent({
      sectionCode,
      ownerId: await getCurrentUserId(),
    })

    return NextResponse.json({
      success: true,
      triggered_by: actor,
      elapsed_seconds: Math.round((Date.now() - startedAt) / 100) / 10,
      ...result,
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Agent run failed.',
        triggered_by: actor,
      },
      { status: 502 }
    )
  }
}
