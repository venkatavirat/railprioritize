import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { isBlockStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * Persisted block schedules, newest first.
 *
 * The optimiser's POST response is transient; the approval workflow needs the
 * stored rows, because only those carry ids, status and permit numbers.
 */
export async function GET(request: NextRequest) {
  const statusFilter = request.nextUrl.searchParams.get('status')
  const limitParam = Number(request.nextUrl.searchParams.get('limit'))
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(Math.floor(limitParam), 500)
      : 100

  try {
    const supabase = createSupabaseServiceClient()

    let query = supabase
      .from('block_schedules')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (statusFilter && isBlockStatus(statusFilter)) {
      query = query.eq('status', statusFilter)
    }

    const { data, error } = await query
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 502 })
    }

    return NextResponse.json({ blocks: data ?? [] })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Could not load block schedules.',
      },
      { status: 502 }
    )
  }
}
