// lib/spreadsheet.ts
//
// Turns an uploaded CSV or Excel file into normalised JSON records.
//
// Server-only: it pulls in SheetJS, which is far too large to ship to the
// browser for no benefit. Parsing here also keeps one implementation for both
// formats, and avoids the client inflating a compact .xlsx into verbose JSON
// before uploading it.

import Papa from 'papaparse'
import * as XLSX from 'xlsx'

export type SheetFormat = 'csv' | 'excel'

export type ParsedSheet = {
  rows: Record<string, unknown>[]
  headers: string[]
  /** The chosen header row exactly as it appeared, before normalisation. */
  rawHeaders: string[]
  format: SheetFormat
  /** Worksheet the rows came from (Excel only). */
  sheetName?: string
  /** Every worksheet in the workbook (Excel only). */
  availableSheets?: string[]
  /** Rows dropped as empty or comments. */
  skipped: number
  /**
   * Zero-based index of the row the headers were read from. Non-zero when a
   * title banner or metadata block sat above the real table.
   */
  headerRowIndex: number
}

export type ParseOptions = {
  /** Worksheet names to prefer, most specific first (Excel only). */
  preferredSheets?: string[]
  /**
   * Column names and aliases the destination table understands. Supplying
   * them lets the parser find a header row buried under a title banner
   * instead of assuming row 1.
   */
  knownHeaders?: string[]
}

/** How far down the sheet to look for the real header row. */
const HEADER_SCAN_LIMIT = 10

/**
 * How many recognised column names a row needs before it is accepted as the
 * header. Two is enough to clear a title banner (which is typically a single
 * merged cell) without misfiring on a data row.
 */
const MIN_HEADER_MATCHES = 2

const EXCEL_EXTENSIONS = ['.xlsx', '.xls', '.xlsm', '.xlsb']

const EXCEL_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.ms-excel.sheet.macroenabled.12',
]

/** True when the file should be read as a workbook rather than as text. */
export function isExcelFile(fileName: string, mimeType?: string): boolean {
  const lowered = fileName.toLowerCase()
  if (EXCEL_EXTENSIONS.some((ext) => lowered.endsWith(ext))) return true
  return Boolean(mimeType && EXCEL_MIME_TYPES.includes(mimeType))
}

/**
 * Converts a header cell to lower snake_case.
 *
 *   "Asset ID"    -> asset_id
 *   "Risk (%)"    -> risk
 *   "duration-hrs"-> duration_hrs
 */
export function normalizeHeader(header: unknown): string {
  return String(header ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-./]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '')
}

/**
 * Coerces a raw cell into a clean JS value.
 *
 * Excel hands back real numbers, booleans and Dates; CSV hands back strings.
 * Normalising here means downstream mapping sees one shape either way.
 *
 * Only literal true/false are treated as booleans — "yes"/"no" are left as
 * strings so a genuine text column (a status, say) is not mangled. The
 * per-field coercion in lib/source-tables.ts still accepts those where the
 * column is actually declared boolean.
 */
export function cleanValue(value: unknown): unknown {
  if (value === null || value === undefined) return null

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    return Number.isNaN(value as number) ? null : value
  }

  const text = String(value).trim()
  if (text === '') return null

  const lowered = text.toLowerCase()
  if (lowered === 'true') return true
  if (lowered === 'false') return false

  // Plain numerics only — avoids turning IDs like "0012" or "1-2" into numbers.
  if (/^-?(?:\d+|\d*\.\d+)$/.test(text) && !/^0\d/.test(text)) {
    const parsed = Number(text)
    if (Number.isFinite(parsed)) return parsed
  }

  return text
}

/** A row is dropped when every cell is empty. */
function isEmptyRow(row: Record<string, unknown>): boolean {
  return Object.values(row).every((v) => v === null || v === '')
}

/** Spreadsheet exports often carry '#' comment banners above the data. */
function isCommentRow(cells: unknown[]): boolean {
  const first = cells.find((c) => c !== null && c !== undefined && String(c).trim() !== '')
  return typeof first === 'string' && first.trim().startsWith('#')
}

/** Words that mark a row as descriptive prose rather than column names. */
const BANNER_KEYWORDS = [
  'synthetic',
  'dataset',
  'sih26027',
  'automatic block planning',
  'automatic_block_planning',
  'railway',
  'maintenance',
]

function populatedCells(cells: unknown[]): unknown[] {
  return cells.filter(
    (c) => c !== null && c !== undefined && String(c).trim() !== ''
  )
}

/**
 * Detects a title banner — the merged prose cell these exports open with,
 * e.g. "Synthetic TDMS/TRD Dataset — SIH26027 Automatic Block Planning...".
 *
 * A row recognising even one real column is never treated as a banner. That
 * guard matters: the keyword list contains "maintenance", and the genuine
 * header rows of the TMS and TDMS workbooks begin with "maintenance_id" —
 * without it, keyword matching would discard the very rows we need.
 */
function isBannerRow(cells: unknown[], known: Set<string>): boolean {
  const filled = populatedCells(cells)
  if (filled.length === 0) return false

  const recognised = cells
    .map(normalizeHeader)
    .filter((h) => h && known.has(h)).length
  if (recognised > 0) return false

  // A merged title occupies one cell; a header row spans many.
  if (filled.length <= 1) return true

  // Two-cell rows are ambiguous, so fall back to the wording.
  if (filled.length <= 2) {
    const first = String(filled[0]).toLowerCase()
    return BANNER_KEYWORDS.some((keyword) => first.includes(keyword))
  }

  return false
}

/**
 * Rejects a candidate header row that is mostly numeric.
 *
 * Column names are text; a row made largely of numbers is data. This only
 * gates the relaxed single-match pass below, where the evidence is thin
 * enough that mistaking a data row for the header would silently rename
 * every column and swallow that row.
 */
function looksLikeHeaderRow(cells: unknown[]): boolean {
  const filled = cells.filter(
    (c) => c !== null && c !== undefined && String(c).trim() !== ''
  )
  if (filled.length === 0) return false

  const numeric = filled.filter((c) => {
    if (typeof c === 'number') return true
    const text = String(c).trim()
    return text !== '' && Number.isFinite(Number(text))
  }).length

  return numeric * 2 <= filled.length
}

/**
 * Finds the row the real column headers live on.
 *
 * These exports frequently open with a title banner — e.g.
 * "bdms_block_demand_management_system_sih26027" alone in row 1 — which
 * pushes the actual headers down. Blindly taking row 1 then yields a single
 * nonsense column and every row fails validation.
 *
 * Two passes:
 *  1. Pick the row recognising the most known columns, needing at least
 *     `MIN_HEADER_MATCHES`.
 *  2. If nothing clears that bar but row 1 recognises *nothing* — so it is a
 *     banner, not a header — accept the topmost row below it matching even a
 *     single column. This rescues sheets whose headers are mostly names we
 *     have no alias for yet.
 *
 * Returns -1 when nothing qualifies, so the caller falls back to its old
 * behaviour rather than guessing.
 */
export function findHeaderRow(
  matrix: unknown[][],
  knownHeaders: string[] | undefined,
  limit: number = HEADER_SCAN_LIMIT
): number {
  if (!knownHeaders || knownHeaders.length === 0) return -1

  const known = new Set(knownHeaders.map(normalizeHeader).filter(Boolean))
  if (known.size === 0) return -1

  const scanTo = Math.min(matrix.length, limit)
  const scores: number[] = []

  for (let i = 0; i < scanTo; i += 1) {
    const cells = matrix[i]
    if (
      !cells ||
      cells.length === 0 ||
      isCommentRow(cells) ||
      // Score banners zero so they can never win a pass, and mark them below
      // so they cannot be used as a fallback either.
      isBannerRow(cells, known)
    ) {
      scores.push(0)
      continue
    }

    scores.push(
      cells.map(normalizeHeader).filter((h) => h && known.has(h)).length
    )
  }

  // Pass 1 — strongest match wins. Strictly greater, so the topmost of
  // equally-good rows wins: the header sits above its data, and data rows can
  // echo header-like values.
  let bestIndex = -1
  let bestScore = 0
  for (let i = 0; i < scores.length; i += 1) {
    if (scores[i] > bestScore) {
      bestScore = scores[i]
      bestIndex = i
    }
  }

  if (bestScore >= MIN_HEADER_MATCHES) return bestIndex

  // Pass 2 — relaxed. Only safe because row 1 matched nothing at all, which
  // rules out demoting a legitimate row-1 header.
  if (scores.length > 0 && scores[0] === 0) {
    for (let i = 1; i < scores.length; i += 1) {
      if (scores[i] >= 1 && looksLikeHeaderRow(matrix[i])) return i
    }
  }

  return -1
}

function buildRows(
  headerCells: unknown[],
  dataRows: unknown[][]
): {
  rows: Record<string, unknown>[]
  headers: string[]
  rawHeaders: string[]
  skipped: number
} {
  const headers = headerCells.map(normalizeHeader)
  // Kept verbatim so diagnostics can show exactly what was in the chosen row,
  // including cells that normalise away to nothing.
  const rawHeaders = headerCells.map((cell) =>
    cell === null || cell === undefined ? '' : String(cell).trim()
  )
  const rows: Record<string, unknown>[] = []
  let skipped = 0

  for (const cells of dataRows) {
    if (!cells || cells.length === 0) {
      skipped += 1
      continue
    }

    if (isCommentRow(cells)) {
      skipped += 1
      continue
    }

    const row: Record<string, unknown> = {}
    headers.forEach((header, index) => {
      // Unnamed columns carry no meaning downstream.
      if (!header) return
      row[header] = cleanValue(cells[index])
    })

    if (isEmptyRow(row)) {
      skipped += 1
      continue
    }

    rows.push(row)
  }

  return { rows, headers: headers.filter(Boolean), rawHeaders, skipped }
}

/**
 * Picks the worksheet to read.
 *
 * Prefers one whose name matches the target domain (so a workbook holding a
 * tab per department reads the right one), otherwise the first sheet.
 */
export function pickSheetName(
  sheetNames: string[],
  preferred?: string[]
): string | undefined {
  if (sheetNames.length === 0) return undefined

  if (preferred && preferred.length > 0) {
    const wanted = preferred.map(normalizeHeader).filter(Boolean)
    const match = sheetNames.find((name) => {
      const normalised = normalizeHeader(name)
      return wanted.some(
        (want) => normalised === want || normalised.includes(want)
      )
    })
    if (match) return match
  }

  return sheetNames[0]
}

/** Reads only the top of a sheet, enough to judge its header row. */
function peekSheet(sheet: XLSX.WorkSheet, rows: number): unknown[][] {
  const ref = sheet['!ref']
  if (!ref) return []

  // Bounding the range keeps scoring cheap on multi-megabyte workbooks.
  const range = XLSX.utils.decode_range(ref)
  range.e.r = Math.min(range.e.r, range.s.r + rows)

  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
    range: XLSX.utils.encode_range(range),
  })
}

/**
 * Chooses the worksheet holding the actual table.
 *
 * These workbooks lead with a README sheet of prose, so taking sheet 1 reads
 * a banner and imports nothing. An explicit name match still wins — that is
 * the caller stating intent — but otherwise every sheet is scored on how many
 * known columns its header row carries, and the strongest wins.
 */
function chooseSheet(
  workbook: XLSX.WorkBook,
  options: ParseOptions
): string | undefined {
  const names = workbook.SheetNames
  if (names.length === 0) return undefined

  const named = pickSheetNameExact(names, options.preferredSheets)
  if (named) return named

  const known = new Set(
    (options.knownHeaders ?? []).map(normalizeHeader).filter(Boolean)
  )
  if (known.size === 0) return names[0]

  let bestName: string | undefined
  let bestScore = 0

  for (const name of names) {
    const matrix = peekSheet(workbook.Sheets[name], HEADER_SCAN_LIMIT)
    if (matrix.length === 0) continue

    // Deliberately not routed through findHeaderRow: that applies the
    // MIN_HEADER_MATCHES threshold, which would discard a sheet whose header
    // matches only one known column and leave us back on the README.
    const score = bestRowScore(matrix, known)

    // Strictly greater keeps the earliest sheet on a tie.
    if (score > bestScore) {
      bestScore = score
      bestName = name
    }
  }

  return bestName ?? names[0]
}

/** Highest count of known columns on any single non-banner row. */
function bestRowScore(matrix: unknown[][], known: Set<string>): number {
  let best = 0

  const scanTo = Math.min(matrix.length, HEADER_SCAN_LIMIT)
  for (let i = 0; i < scanTo; i += 1) {
    const cells = matrix[i]
    if (!cells || cells.length === 0) continue
    if (isCommentRow(cells) || isBannerRow(cells, known)) continue

    const score = cells
      .map(normalizeHeader)
      .filter((h) => h && known.has(h)).length
    if (score > best) best = score
  }

  return best
}

/** Exact/substring match on sheet name, or undefined when none matches. */
function pickSheetNameExact(
  sheetNames: string[],
  preferred?: string[]
): string | undefined {
  if (!preferred || preferred.length === 0) return undefined

  const wanted = preferred.map(normalizeHeader).filter(Boolean)
  return sheetNames.find((name) => {
    const normalised = normalizeHeader(name)
    return wanted.some((want) => normalised === want || normalised.includes(want))
  })
}

/** Parses an Excel workbook from raw bytes. */
export function parseExcel(
  buffer: ArrayBuffer,
  options: ParseOptions = {}
): ParsedSheet {
  // cellDates makes SheetJS hand back Date objects rather than serial numbers.
  const workbook = XLSX.read(new Uint8Array(buffer), {
    type: 'array',
    cellDates: true,
  })

  const availableSheets = workbook.SheetNames
  const sheetName = chooseSheet(workbook, options)

  if (!sheetName) {
    return {
      rows: [],
      headers: [],
      rawHeaders: [],
      format: 'excel',
      availableSheets,
      skipped: 0,
      headerRowIndex: 0,
    }
  }

  const sheet = workbook.Sheets[sheetName]

  // header:1 yields arrays of cells, so header handling and comment detection
  // stay under our control rather than SheetJS's.
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  })

  // Prefer the row that actually looks like a header; otherwise take the
  // first row that is neither a comment nor a title banner.
  let headerIndex = findHeaderRow(matrix, options.knownHeaders)

  if (headerIndex < 0) {
    const known = new Set(
      (options.knownHeaders ?? []).map(normalizeHeader).filter(Boolean)
    )
    headerIndex = 0
    while (
      headerIndex < matrix.length &&
      (isCommentRow(matrix[headerIndex]) ||
        isBannerRow(matrix[headerIndex], known))
    ) {
      headerIndex += 1
    }
  }

  if (headerIndex >= matrix.length) {
    return {
      rows: [],
      headers: [],
      rawHeaders: [],
      format: 'excel',
      sheetName,
      availableSheets,
      skipped: matrix.length,
      headerRowIndex: 0,
    }
  }

  const { rows, headers, rawHeaders, skipped } = buildRows(
    matrix[headerIndex],
    matrix.slice(headerIndex + 1)
  )

  return {
    rows,
    headers,
    rawHeaders,
    format: 'excel',
    sheetName,
    availableSheets,
    // Everything above the header row is banner/metadata, not data.
    skipped: skipped + headerIndex,
    headerRowIndex: headerIndex,
  }
}

/** Parses a CSV document from text. */
export function parseCsv(text: string, options: ParseOptions = {}): ParsedSheet {
  const parsed = Papa.parse<unknown[]>(text, {
    header: false,
    skipEmptyLines: 'greedy',
    comments: '#',
  })

  const matrix = (parsed.data ?? []).filter(Array.isArray) as unknown[][]
  if (matrix.length === 0) {
    return {
      rows: [],
      headers: [],
      rawHeaders: [],
      format: 'csv',
      skipped: 0,
      headerRowIndex: 0,
    }
  }

  // A CSV can carry a title banner above the table just as an Excel export
  // can; row 0 is only the default when nothing better is recognised, and
  // even then a banner row is skipped rather than used.
  const detected = findHeaderRow(matrix, options.knownHeaders)

  let headerIndex = detected
  if (headerIndex < 0) {
    const known = new Set(
      (options.knownHeaders ?? []).map(normalizeHeader).filter(Boolean)
    )
    headerIndex = 0
    while (
      headerIndex < matrix.length - 1 &&
      isBannerRow(matrix[headerIndex], known)
    ) {
      headerIndex += 1
    }
  }

  const { rows, headers, rawHeaders, skipped } = buildRows(
    matrix[headerIndex],
    matrix.slice(headerIndex + 1)
  )

  return {
    rows,
    headers,
    rawHeaders,
    format: 'csv',
    skipped: skipped + headerIndex,
    headerRowIndex: headerIndex,
  }
}

/**
 * Parses an uploaded file of either format into normalised records.
 */
export async function parseUploadedFile(
  file: File,
  options: ParseOptions = {}
): Promise<ParsedSheet> {
  if (isExcelFile(file.name, file.type)) {
    return parseExcel(await file.arrayBuffer(), options)
  }
  return parseCsv(await file.text(), options)
}
