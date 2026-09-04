import { NextRequest, NextResponse } from 'next/server'

/** Operational context the dashboard sends alongside each message. */
type ChatContext = {
  department?: string
  section?: string
  defectCount?: number
  overdueCount?: number
  criticalCount?: number
  windowCount?: number
  blockCount?: number
  downtimeSavedHrs?: number
}

export async function POST(request: NextRequest) {
  try {
    const { message, context } = (await request.json()) as {
      message?: unknown
      context?: ChatContext
    }

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Invalid message' }, { status: 400 })
    }

    return NextResponse.json({ reply: generateChatReply(message, context ?? {}) })
  } catch (error) {
    console.error('Chat API error:', error)
    return NextResponse.json({ error: 'Chat API failed' }, { status: 500 })
  }
}

/**
 * Deterministic keyword assistant over the multi-department backlog.
 *
 * Intentionally rule-based: it answers instantly and costs nothing. The
 * heavyweight reasoning lives in /api/optimize-schedule.
 */
function generateChatReply(message: string, ctx: ChatContext) {
  const msg = message.toLowerCase()

  const defects = ctx.defectCount ?? 0
  const overdue = ctx.overdueCount ?? 0
  const critical = ctx.criticalCount ?? 0
  const windows = ctx.windowCount ?? 0
  const blocks = ctx.blockCount ?? 0
  const saved = ctx.downtimeSavedHrs ?? 0

  if (msg.includes('overdue') || msg.includes('backlog')) {
    return `There are ${overdue} overdue item${overdue === 1 ? '' : 's'} out of ${defects} pending defect${defects === 1 ? '' : 's'}. Overdue high-risk assets are weighted first by the optimization engine.`
  }

  if (msg.includes('critical') || msg.includes('risk') || msg.includes('safety')) {
    return `${critical} defect${critical === 1 ? ' carries' : 's carry'} a risk score of 80 or above. Open the Defect Backlog tab and sort by risk to review them.`
  }

  if (msg.includes('window') || msg.includes('corridor') || msg.includes('coa')) {
    return `${windows} corridor window${windows === 1 ? ' is' : 's are'} currently loaded. Low passenger-density night windows are preferred when blocks are placed.`
  }

  if (msg.includes('block') || msg.includes('schedule') || msg.includes('plan')) {
    return blocks > 0
      ? `The current plan has ${blocks} block${blocks === 1 ? '' : 's'}, saving ${saved.toFixed(1)} hours of network downtime. See the Block Optimization tab.`
      : 'No plan has been generated yet. Press "Run AI Optimization Engine" in the header to build one.'
  }

  if (msg.includes('upload') || msg.includes('csv') || msg.includes('import')) {
    return 'Use the Data Ingestion tab. Defect exports from TMS, SMMS and TDMS, and COA corridor window files, are both detected automatically from the CSV header row.'
  }

  if (msg.includes('help') || msg.includes('what can')) {
    return [
      'I can answer questions about:',
      '• Overdue and safety-critical defects',
      '• Corridor window availability',
      '• The current optimized block plan',
      '• Uploading TMS / SMMS / TDMS data',
    ].join('\n')
  }

  return `You have ${defects} pending defect${defects === 1 ? '' : 's'} (${overdue} overdue) across ${windows} corridor window${windows === 1 ? '' : 's'}. Try asking about "overdue", "corridor windows", or "the current plan".`
}
