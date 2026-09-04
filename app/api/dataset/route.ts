import { NextRequest, NextResponse } from 'next/server'
import {
  loadUnifiedDataset,
  loadAllSnapshots,
  loadTableSnapshot,
  PREVIEW_LIMIT,
} from '@/lib/data-sources'
import { isSourceTable } from '@/lib/source-tables'
import { getCurrentUserId } from '@/lib/current-user'

export const dynamic = 'force-dynamic'

/**
 * The dashboard's read model.
 *
 * `GET /api/dataset`               → unified dataset + a snapshot per table.
 * `GET /api/dataset?table=<name>`  → one table's snapshot, so the Data Control
 *                                    Center can refresh a single tab after an
 *                                    upload without refetching everything.
 *
 * Serving all of it from the same loader the optimiser uses means the views
 * can never disagree about what the backlog is.
 */
export async function GET(request: NextRequest) {
  // Every read is scoped to the caller's own uploads.
  const ownerId = await getCurrentUserId()
  const requestedTable = request.nextUrl.searchParams.get('table')

  const limitParam = Number(request.nextUrl.searchParams.get('limit'))
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(Math.floor(limitParam), 100)
      : PREVIEW_LIMIT

  // ----- Single-table refresh --------------------------------------------
  if (requestedTable !== null) {
    if (!isSourceTable(requestedTable)) {
      return NextResponse.json(
        { error: `Unknown table "${requestedTable}".` },
        { status: 400 }
      )
    }

    try {
      const snapshot = await loadTableSnapshot(requestedTable, limit, ownerId)
      return NextResponse.json({ snapshot })
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : 'Could not load the table.',
        },
        { status: 502 }
      )
    }
  }

  // ----- Full load --------------------------------------------------------
  try {
    const [dataset, snapshots] = await Promise.all([
      loadUnifiedDataset({ ownerId }),
      loadAllSnapshots(limit, ownerId),
    ])

    return NextResponse.json({
      defects: dataset.defects,
      windows: dataset.windows,
      sources: dataset.sources,
      usedSynthetic: dataset.usedSynthetic,
      isolationActive: dataset.isolationActive,
      snapshots,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Could not load the dataset.',
      },
      { status: 502 }
    )
  }
}
