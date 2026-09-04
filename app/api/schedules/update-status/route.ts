import { NextRequest, NextResponse } from 'next/server'
import {
  createSupabaseServerClient,
  createSupabaseWriteClient,
} from '@/lib/supabase/server'
import { isDevAuthBypassEnabled } from '@/lib/auth-flags'
import { isBlockStatus, type BlockStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

/** Transitions a controller is allowed to make from each state. */
const ALLOWED_TRANSITIONS: Record<BlockStatus, BlockStatus[]> = {
  PROPOSED: ['APPROVED', 'MODIFIED', 'REJECTED'],
  // An approved block can still be re-timed or withdrawn before execution.
  APPROVED: ['MODIFIED', 'REJECTED'],
  MODIFIED: ['APPROVED', 'REJECTED'],
  // A rejected block is reopened by re-running the optimiser, not by editing.
  REJECTED: [],
}

/** SCR/JBP/<year>/<6-char id> — stable per block, derived not random. */
function permitNumber(blockId: string, when: Date): string {
  const suffix = blockId.replace(/[^0-9a-f]/gi, '').slice(-6).toUpperCase()
  return `SCR/JBP/${when.getUTCFullYear()}/${suffix.padStart(6, '0')}`
}

export async function POST(request: NextRequest) {
  // ----- Authorisation ----------------------------------------------------
  // Approving a block is an operational act; it must carry an identity.
  let actor = 'Local developer (auth bypass)'

  if (!isDevAuthBypassEnabled()) {
    try {
      const supabase = await createSupabaseServerClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // Prefer the profile's name so the audit trail reads as a person.
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name,email,department')
        .eq('id', user.id)
        .maybeSingle()

      actor =
        profile?.full_name ||
        profile?.email ||
        user.email ||
        'Unknown controller'
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // ----- Payload ----------------------------------------------------------
  let body: {
    id?: string
    status?: string
    block_start?: string
    block_end?: string
    rejection_reason?: string
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 })
  }

  const { id, status } = body

  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'A block "id" is required.' }, { status: 400 })
  }

  if (!isBlockStatus(status)) {
    return NextResponse.json(
      { error: 'status must be one of PROPOSED, APPROVED, MODIFIED, REJECTED.' },
      { status: 400 }
    )
  }

  const supabase = await createSupabaseWriteClient()

  // ----- Read current state ----------------------------------------------
  const { data: existing, error: readError } = await supabase
    .from('block_schedules')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 502 })
  }
  if (!existing) {
    return NextResponse.json({ error: 'No such block schedule.' }, { status: 404 })
  }

  const current = (isBlockStatus(existing.status) ? existing.status : 'PROPOSED') as BlockStatus

  if (current !== status && !ALLOWED_TRANSITIONS[current].includes(status)) {
    return NextResponse.json(
      {
        error: `Cannot move a ${current} block to ${status}.`,
        allowed: ALLOWED_TRANSITIONS[current],
      },
      { status: 409 }
    )
  }

  // ----- Build the update -------------------------------------------------
  const now = new Date()
  const update: Record<string, unknown> = { status }

  if (status === 'APPROVED' || status === 'MODIFIED') {
    update.approved_by = actor
    update.approval_timestamp = now.toISOString()
    update.rejection_reason = null
    // Issue the permit once and keep it stable across later edits.
    update.permit_number = existing.permit_number ?? permitNumber(id, now)
  }

  if (status === 'REJECTED') {
    update.rejection_reason =
      typeof body.rejection_reason === 'string' && body.rejection_reason.trim()
        ? body.rejection_reason.trim()
        : 'No reason recorded.'
    update.approved_by = actor
    update.approval_timestamp = now.toISOString()
  }

  // ----- Window adjustment ------------------------------------------------
  if (body.block_start || body.block_end) {
    const start = Date.parse(body.block_start ?? existing.block_start)
    const end = Date.parse(body.block_end ?? existing.block_end)

    if (Number.isNaN(start) || Number.isNaN(end)) {
      return NextResponse.json(
        { error: 'block_start and block_end must be valid timestamps.' },
        { status: 400 }
      )
    }
    if (end <= start) {
      return NextResponse.json(
        { error: 'The block must end after it starts.' },
        { status: 400 }
      )
    }

    update.block_start = new Date(start).toISOString()
    update.block_end = new Date(end).toISOString()

    // Preserve what the optimiser originally proposed, so a MODIFIED block
    // shows what the controller actually changed.
    if (!existing.original_block_start) {
      update.original_block_start = existing.block_start
      update.original_block_end = existing.block_end
    }
  }

  const { data: updated, error: writeError } = await supabase
    .from('block_schedules')
    .update(update)
    .eq('id', id)
    .select()
    .maybeSingle()

  if (writeError) {
    return NextResponse.json({ error: writeError.message }, { status: 502 })
  }

  return NextResponse.json({ success: true, block: updated })
}
