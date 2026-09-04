import { NextRequest, NextResponse } from 'next/server'
import Papa from 'papaparse'
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/lib/supabase/server'
import { isDevAuthBypassEnabled } from '@/lib/auth-flags'
import { TABLE_SPECS, isSourceTable, mapRow } from '@/lib/source-tables'

export const dynamic = 'force-dynamic'

/** Rows per upsert request, to stay under payload limits. */
const BATCH_SIZE = 200

/** Refuse absurd uploads before reading them into memory. */
const MAX_BYTES = 8 * 1024 * 1024

/** Cap on how many problem lines we echo back. */
const MAX_REPORTED_PROBLEMS = 10

export async function POST(request: NextRequest) {
  // ----- Authorisation ----------------------------------------------------
  // This endpoint bulk-writes to the database, so it must not be open.
  if (!isDevAuthBypassEnabled()) {
    try {
      const supabase = await createSupabaseServerClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        return NextResponse.json(
          { success: false, error: 'Not signed in.' },
          { status: 401 }
        )
      }
    } catch {
      return NextResponse.json(
        { success: false, error: 'Could not verify your session.' },
        { status: 401 }
      )
    }
  }

  // ----- Read the multipart body -----------------------------------------
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json(
      { success: false, error: 'Expected a multipart form upload.' },
      { status: 400 }
    )
  }

  const tableName = formData.get('table_name')
  if (!isSourceTable(tableName)) {
    return NextResponse.json(
      {
        success: false,
        error: `Unknown table_name. Expected one of: ${Object.keys(TABLE_SPECS).join(', ')}.`,
      },
      { status: 400 }
    )
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json(
      { success: false, error: 'No file provided under the "file" field.' },
      { status: 400 }
    )
  }

  if (file.size === 0) {
    return NextResponse.json(
      { success: false, error: 'That file is empty.' },
      { status: 400 }
    )
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        success: false,
        error: `File is ${(file.size / 1_048_576).toFixed(1)} MB; the limit is ${MAX_BYTES / 1_048_576} MB.`,
      },
      { status: 413 }
    )
  }

  // ----- Parse ------------------------------------------------------------
  const text = await file.text()

  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  })

  if (!parsed.meta.fields || parsed.meta.fields.length === 0) {
    return NextResponse.json(
      { success: false, error: 'That file has no header row.' },
      { status: 400 }
    )
  }

  const spec = TABLE_SPECS[tableName]
  const rows: Record<string, unknown>[] = []
  const problems: string[] = []

  parsed.data.forEach((record, index) => {
    // +2: one for the header line, one for 1-based numbering.
    const { row, problem } = mapRow(spec, record, index + 2)
    if (problem) problems.push(problem)
    if (row) rows.push(row)
  })

  if (rows.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: 'No valid rows found.',
        table: tableName,
        rowsInserted: 0,
        expectedColumns: spec.fields.map((f) => f.column),
        problems: problems.slice(0, MAX_REPORTED_PROBLEMS),
      },
      { status: 422 }
    )
  }

  // ----- Upsert -----------------------------------------------------------
  let rowsInserted = 0
  try {
    const supabase = createSupabaseServiceClient()

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE)
      const { error } = await supabase
        .from(tableName)
        .upsert(batch, { onConflict: spec.conflictTarget })

      if (error) {
        return NextResponse.json(
          {
            success: false,
            error: `${error.message} (writing to ${tableName})`,
            table: tableName,
            rowsInserted,
          },
          { status: 502 }
        )
      }

      rowsInserted += batch.length
    }
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Upload failed.',
        table: tableName,
        rowsInserted,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    rowsInserted,
    table: tableName,
    rowsSkipped: parsed.data.length - rows.length,
    problems: problems.slice(0, MAX_REPORTED_PROBLEMS),
  })
}
