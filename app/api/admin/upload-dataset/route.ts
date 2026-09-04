import { NextRequest, NextResponse } from 'next/server'
import {
  createSupabaseServerClient,
  createSupabaseWriteClient,
} from '@/lib/supabase/server'
import { isDevAuthBypassEnabled } from '@/lib/auth-flags'
import {
  TABLE_SPECS,
  isSourceTable,
  mapRow,
  dedupeRows,
  knownHeaderNames,
} from '@/lib/source-tables'
import { parseUploadedFile } from '@/lib/spreadsheet'
import { getCurrentUserId } from '@/lib/current-user'

export const dynamic = 'force-dynamic'

/**
 * Rows per upsert request.
 *
 * Large extracts are chunked so a single payload never trips Supabase's
 * request size limit or the gateway timeout.
 */
const BATCH_SIZE = 500

/** Refuse absurd uploads before reading them into memory. */
const MAX_BYTES = 16 * 1024 * 1024

/** Cap on how many problem lines we echo back. */
const MAX_REPORTED_PROBLEMS = 10

export async function POST(request: NextRequest) {
  // Owner of everything this request writes. Resolved before any work so an
  // unidentifiable caller cannot reach the database at all.
  const ownerId = await getCurrentUserId()

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

  // ----- Parse (CSV or Excel) ---------------------------------------------
  const spec = TABLE_SPECS[tableName]

  let parsed
  try {
    parsed = await parseUploadedFile(file, {
      // Prefer a worksheet named after the target domain, so a workbook
      // holding one tab per department still reads the right sheet.
      preferredSheets: [tableName, spec.label],
      // Lets the parser locate the header row under a title banner.
      knownHeaders: knownHeaderNames(spec),
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: `Could not read that file: ${
          error instanceof Error ? error.message : 'unsupported or corrupt'
        }`,
      },
      { status: 400 }
    )
  }

  if (parsed.headers.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error:
          parsed.format === 'excel'
            ? `No header row found in worksheet "${parsed.sheetName ?? '(none)'}".`
            : 'That file has no header row.',
        availableSheets: parsed.availableSheets,
        // Diagnostics: which row was chosen, and what was literally in it.
        scannedHeaderRowIndex: parsed.headerRowIndex,
        actualHeadersFound: parsed.rawHeaders,
        expectedColumns: spec.fields.map((f) => f.column),
      },
      { status: 400 }
    )
  }

  const mappedRows: Record<string, unknown>[] = []
  const problems: string[] = []

  parsed.rows.forEach((record, index) => {
    // Report the line as it appears in the user's file: the header's own
    // position, plus one for the header line and one for 1-based numbering.
    const lineNumber = index + parsed.headerRowIndex + 2
    const { row, problem, warnings } = mapRow(spec, record, lineNumber)
    if (problem) problems.push(problem)
    if (warnings) problems.push(...warnings)
    if (row) mappedRows.push(row)
  })

  if (mappedRows.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: 'No valid rows found.',
        table: tableName,
        rowsInserted: 0,
        format: parsed.format,
        sheetName: parsed.sheetName,
        detectedColumns: parsed.headers,
        headerRow: parsed.headerRowIndex + 1,
        // Diagnostics: the row index actually scanned to, and the raw strings
        // found there — enough to tell a banner from a real header.
        scannedHeaderRowIndex: parsed.headerRowIndex,
        actualHeadersFound: parsed.rawHeaders,
        expectedColumns: spec.fields.map((f) => f.column),
        problems: problems.slice(0, MAX_REPORTED_PROBLEMS),
      },
      { status: 422 }
    )
  }

  // Supabase's upsert rejects a batch outright if the same conflict key
  // appears twice in it ("ON CONFLICT DO UPDATE command cannot affect row a
  // second time"), which a real export can easily trigger — the same asset
  // inspected twice in one day, say. Collapse those before batching; the
  // later row in the file wins.
  const { rows: dedupedRows, duplicatesRemoved } = dedupeRows(spec, mappedRows)

  // Stamp ownership so this upload is visible only to the account that made
  // it. Dropped harmlessly by the retry below if the isolation migration has
  // not been run yet.
  const rows: Record<string, unknown>[] = ownerId
    ? dedupedRows.map((row) => ({ ...row, uploaded_by: ownerId }))
    : dedupedRows

  // ----- Upsert in batches ------------------------------------------------
  let rowsInserted = 0
  let batchesWritten = 0
  const droppedColumns: string[] = []

  try {
    const supabase = await createSupabaseWriteClient()

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      let batch = rows.slice(i, i + BATCH_SIZE).map((row) => {
        // Re-apply drops discovered on an earlier batch.
        if (droppedColumns.length === 0) return row
        const copy = { ...row }
        for (const column of droppedColumns) delete copy[column]
        return copy
      })

      let error = (
        await supabase.from(tableName).upsert(batch, { onConflict: spec.conflictTarget })
      ).error

      // The ingest spec can legitimately know about a column the database has
      // not gained yet (a pending migration). Rather than failing the whole
      // upload, drop the unknown column and retry -- the rest of the row is
      // still worth keeping. Each pass can only reveal one missing column, so
      // loop until it writes or runs out of columns to shed.
      let guard = 0
      while (error && guard < 12) {
        const missing = /Could not find the '([^']+)' column/.exec(error.message)?.[1]
        if (!missing) break

        droppedColumns.push(missing)
        batch = batch.map((row) => {
          const copy = { ...row }
          delete copy[missing]
          return copy
        })

        error = (
          await supabase
            .from(tableName)
            .upsert(batch, { onConflict: spec.conflictTarget })
        ).error
        guard += 1
      }

      if (error) {
        return NextResponse.json(
          {
            success: false,
            // Partial writes are possible: earlier batches already committed.
            error: `${error.message} (writing to ${tableName}, batch ${batchesWritten + 1})`,
            table: tableName,
            rowsInserted,
            partial: rowsInserted > 0,
            scannedHeaderRowIndex: parsed.headerRowIndex,
            actualHeadersFound: parsed.rawHeaders,
          },
          { status: 502 }
        )
      }

      rowsInserted += batch.length
      batchesWritten += 1
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
    // Rejected by validation, plus blank/comment lines dropped while parsing.
    // Duplicates are reported separately since they were valid rows, just
    // superseded by a later one sharing the same key.
    rowsSkipped: parsed.rows.length - mappedRows.length + parsed.skipped,
    duplicatesRemoved,
    batches: batchesWritten,
    format: parsed.format,
    sheetName: parsed.sheetName,
    // Columns the file supplied that the database does not have yet.
    droppedColumns: Array.from(new Set(droppedColumns)),
    // 1-based, so it lines up with what the user sees in Excel.
    headerRow: parsed.headerRowIndex + 1,
    problems: problems.slice(0, MAX_REPORTED_PROBLEMS),
  })
}
