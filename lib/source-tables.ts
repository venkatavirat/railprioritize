// lib/source-tables.ts
//
// Single registry describing every ingestible source table: which columns it
// has, which CSV headers map onto them, how values are coerced, and what the
// upsert conflict target is.
//
// Shared by the ingestion route, the unified loader and the uploader UI so
// they cannot drift apart.

export const SOURCE_TABLES = [
  'tms_defects',
  'smms_defects',
  'tdms_defects',
  'bdms_demands',
  'coa_slots',
] as const

export type SourceTable = (typeof SOURCE_TABLES)[number]

/** Narrows an untrusted string to a known table name. */
export function isSourceTable(value: unknown): value is SourceTable {
  return (
    typeof value === 'string' && (SOURCE_TABLES as readonly string[]).includes(value)
  )
}

type FieldKind = 'string' | 'number' | 'integer' | 'boolean' | 'timestamp'

/**
 * One accepted header for a field.
 *
 * A plain string matches the header as-is. The object form additionally
 * converts the raw number into the column's unit before it is clamped --
 * e.g. a source that reports `total_block_time_minutes` instead of hours.
 */
type AliasSpec =
  | string
  | {
      name: string
      toBaseUnit: (value: number) => number
    }

export type FieldSpec = {
  /** Destination column. */
  column: string
  kind: FieldKind
  /** Accepted CSV headers, lower-cased. The column name is added implicitly. */
  aliases?: AliasSpec[]
  required?: boolean
  /** Used when the CSV omits the column or the value is unparseable. */
  fallback?: unknown
  min?: number
  max?: number
  /**
   * Invoked when this field is `required` but no header supplied a usable
   * value. Lets the field degrade to a flagged best-effort default instead
   * of rejecting the whole row.
   *
   * Only wire this up where losing the row outright is worse than a guess
   * -- see `section_code` below. It must never be used for a column that is
   * part of the table's upsert conflict target (e.g. `asset_id`): defaulting
   * the actual identity key would silently merge unrelated rows together.
   */
  deriveFallback?: (context: {
    /** Columns already mapped for this row, in field-declaration order. */
    mapped: Record<string, unknown>
    /** The row's normalised headers, in case another column can stand in. */
    raw: Map<string, unknown>
  }) => { value: unknown; note: string }
  /**
   * Numeric meanings for textual values, keyed by upper-cased text with
   * separators collapsed to single spaces (see `lookupTextValue`). Consulted
   * only when the raw value will not parse as a number.
   */
  textMap?: Record<string, number>
}

export type TableSpec = {
  table: SourceTable
  label: string
  /** Column(s) that make a row unique, for ON CONFLICT. */
  conflictTarget: string
  fields: FieldSpec[]
  /**
   * Runs after every field is mapped, for rules that span more than one
   * column — per-field coercion cannot see its siblings.
   */
  postProcess?: (row: Record<string, unknown>) => {
    notes: string[]
    /** Set to drop the row, with the reason reported to the uploader. */
    reject?: string
  }
}

/** Normalises free text for `textMap` lookup: "Tier 1"/"tier_1" -> "TIER 1". */
function lookupKey(text: string): string {
  return text.trim().toUpperCase().replace(/[\s_\-/]+/g, ' ')
}

/**
 * Criticality expressed as words rather than a number.
 *
 * Values sit on the column's declared 1-10 scale. The request specified
 * 90/70/50/30, but `asset_criticality_score` is clamped to 1-10 (and the
 * dashboard renders it as "x/10"), so those would all clamp to 10 and erase
 * the very distinction the mapping exists to preserve. The ordering is kept,
 * rescaled.
 */
const CRITICALITY_TEXT: Record<string, number> = {
  CRITICAL: 9,
  'TIER 1': 9,
  HIGH: 7,
  'TIER 2': 7,
  MEDIUM: 5,
  ROUTINE: 5,
  'TIER 3': 5,
  LOW: 3,
  'TIER 4': 3,
}

/**
 * Parses a bare time of day into today's date.
 *
 * COA publishes free-window bounds as "00:53:00" with no date, but
 * slot_start/slot_end are timestamps. Anchoring to today is a convention,
 * not a fact recovered from the file — see the midnight-wrap fix-up in
 * `coa_slots.postProcess`.
 */
export function parseTimeOfDay(text: string, onDate: Date = new Date()): string | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim())
  if (!match) return null

  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = match[3] ? Number(match[3]) : 0
  if (hours > 23 || minutes > 59 || seconds > 59) return null

  const stamp = new Date(
    Date.UTC(
      onDate.getUTCFullYear(),
      onDate.getUTCMonth(),
      onDate.getUTCDate(),
      hours,
      minutes,
      seconds
    )
  )
  return stamp.toISOString()
}

/**
 * Matches this system's section-code convention, e.g. "SC-KZJ-UP".
 *
 * Requires the trailing "-UP"/"-DN" direction suffix rather than just
 * "letters-dash-letters": every real section code in this system carries
 * one, but so does every asset-type prefix (TRK, PT, OHE, ...), so a looser
 * pattern matches the wrong substring in a composite id like
 * "PT-SC-KZJ-UP-402" -- it would grab "PT-SC-KZJ" instead of "SC-KZJ-UP".
 */
const SECTION_CODE_PATTERN = /[A-Z]{2,6}-[A-Z]{2,6}-(?:UP|DN)/

const DEFECT_FIELDS: FieldSpec[] = [
  {
    column: 'asset_id',
    kind: 'string',
    aliases: [
      'asset',
      'assetid',
      'asset_no',
      'equipment_id',
      'dependency_asset_id',
    ],
    required: true,
  },
  {
    column: 'section_code',
    kind: 'string',
    aliases: [
      'section',
      'sectioncode',
      'block_section',
      'section_id',
      'corridor',
      'section_or_corridor',
      'route',
    ],
    required: true,
    deriveFallback: ({ mapped, raw }) => {
      // section_code is never the upsert conflict key for a defect table
      // (asset_id is), so a placeholder here can't corrupt an upsert the
      // way defaulting asset_id would -- it only files the row under a
      // visibly-fake section until someone corrects the source export.
      const candidates = [
        mapped.asset_id,
        raw.get('dependency_asset_id'),
        raw.get('dependent_asset_id'),
      ]

      for (const candidate of candidates) {
        if (!candidate) continue
        const text = String(candidate).toUpperCase()
        const match = text.match(SECTION_CODE_PATTERN)
        if (match) {
          return {
            value: match[0],
            note: `section_code inferred as "${match[0]}" from "${text}".`,
          }
        }
      }

      return {
        value: 'UNASSIGNED',
        note:
          'section_code missing and could not be inferred -- defaulted to "UNASSIGNED"; correct this row before scheduling it.',
      }
    },
  },
  {
    column: 'defect_description',
    kind: 'string',
    aliases: [
      'description',
      'defect',
      'remarks',
      'fault',
      'maintenance_urgency',
      'priority_class',
    ],
    fallback: '',
  },
  {
    column: 'risk_score',
    kind: 'number',
    aliases: [
      'risk',
      'riskscore',
      'safety_risk_score',
      'maintenance_priority_score',
      'urgency_score',
    ],
    fallback: null, // derived from criticality when absent
    min: 0,
    max: 100,
  },
  {
    column: 'duration_required_hrs',
    kind: 'number',
    aliases: [
      'duration',
      'duration_hrs',
      'hours',
      'est_duration_hrs',
      {
        name: 'recommended_block_duration_minutes',
        toBaseUnit: (minutes) => minutes / 60,
      },
      { name: 'total_block_time_minutes', toBaseUnit: (minutes) => minutes / 60 },
    ],
    fallback: 2,
    min: 0.25,
    max: 99,
  },
  {
    column: 'asset_criticality_score',
    kind: 'integer',
    aliases: ['criticality', 'crit', 'importance', 'priority_class'],
    textMap: CRITICALITY_TEXT,
    fallback: 5,
    min: 1,
    max: 10,
  },
  {
    column: 'is_overdue',
    kind: 'boolean',
    aliases: ['overdue', 'is_late'],
    fallback: false,
  },
]

/**
 * Clones a field list, appending extra aliases to named columns.
 *
 * Lets one table accept vocabulary the others should not. Adding these to the
 * shared DEFECT_FIELDS instead would silently change how TMS and SMMS files
 * are read, which is a wider blast radius than the problem warrants.
 */
function withExtraAliases(
  base: FieldSpec[],
  extras: Record<string, AliasSpec[]>
): FieldSpec[] {
  return base.map((field) => {
    const extra = extras[field.column]
    if (!extra) return field
    return { ...field, aliases: [...(field.aliases ?? []), ...extra] }
  })
}

/**
 * TDMS exports name their columns after traction hardware rather than the
 * generic defect vocabulary the other two systems use.
 */
/**
 * Several source workbooks express risk as a 0-1 fraction (TDMS
 * `priority_score` runs 0.167-1.0) while `risk_score` is a 0-100 column.
 * Left unscaled, every imported row would read as near-zero risk and the
 * optimiser would deprioritise the entire backlog.
 *
 * Values above 1 are assumed to already be on the 0-100 scale.
 */
const fractionToPercent = (value: number) => (value <= 1 ? value * 100 : value)

const TDMS_FIELDS: FieldSpec[] = withExtraAliases(DEFECT_FIELDS, {
  asset_id: [
    'equipment_no',
    'trd_asset_id',
    'ohe_asset_id',
    'structure_number',
    'element_id',
    'loc_id',
    'asset_code',
  ],
  section_code: ['ohe_section', 'substation_section'],
  defect_description: [
    // work_description is the real column in the TDMS workbook.
    'work_description',
    'maintenance_activity',
    'work_required',
    'task_description',
    'ohe_defect',
    'activity_type',
  ],
  risk_score: [
    'criticality_score',
    'urgency',
    'condition_score',
    { name: 'priority_score', toBaseUnit: fractionToPercent },
    { name: 'failure_risk', toBaseUnit: fractionToPercent },
  ],
  duration_required_hrs: [
    // estimated_duration_hours is the real column, already in hours.
    'estimated_duration_hours',
    'required_duration',
    'block_duration',
    'work_hours',
    { name: 'time_required_minutes', toBaseUnit: (minutes) => minutes / 60 },
  ],
  asset_criticality_score: ['asset_criticality'],
})

/**
 * TDMS carries one row per maintenance *request*, and an asset can have
 * several open at once — the real file holds 500 requests across 223 assets.
 * Keying the table on asset_id therefore discarded 55% of the rows as
 * "duplicates", so the request id is the identity instead.
 */
TDMS_FIELDS.push({
  column: 'maintenance_id',
  kind: 'string',
  aliases: [
    'source_record_id',
    'maintenance_request_id',
    'request_id',
    'work_order_id',
  ],
  required: true,
  deriveFallback: ({ mapped }) => {
    // Unlike a constant default, this is derived from the row's own identity,
    // so it cannot merge unrelated rows -- it just reproduces the previous
    // one-row-per-asset behaviour for files that carry no request id.
    const assetId = String(mapped.asset_id ?? '').trim()
    return {
      value: assetId || 'UNKNOWN',
      note: `maintenance_id missing; using asset_id "${assetId}" as the record key, so only the last row for this asset is kept.`,
    }
  },
})

export const TABLE_SPECS: Record<SourceTable, TableSpec> = {
  tms_defects: {
    table: 'tms_defects',
    label: 'Engineering — TMS defects',
    conflictTarget: 'asset_id',
    fields: DEFECT_FIELDS,
  },
  smms_defects: {
    table: 'smms_defects',
    label: 'S&T — SMMS defects',
    conflictTarget: 'asset_id',
    fields: DEFECT_FIELDS,
  },
  tdms_defects: {
    table: 'tdms_defects',
    label: 'Traction — TDMS defects',
    // Requires database/2026-09-tdms-maintenance-id.sql to have been run.
    conflictTarget: 'maintenance_id',
    fields: TDMS_FIELDS,
  },
  bdms_demands: {
    table: 'bdms_demands',
    label: 'BDMS block demands',
    conflictTarget: 'demand_id',
    fields: [
      {
        column: 'demand_id',
        kind: 'string',
        // A bare `id` is last on purpose: it is the least specific name here
        // and would otherwise shadow a real block-demand identifier sitting
        // in the same sheet.
        aliases: [
          // bdms_id is the real identifier in the BDMS workbook.
          'bdms_id',
          'block_demand_id',
          'demand',
          'demandid',
          'request_id',
          'req_id',
          'source_record_id',
          'block_id',
          'id',
        ],
        required: true,
      },
      {
        column: 'department',
        kind: 'string',
        aliases: ['dept', 'owning_department', 'requesting_dept'],
        required: true,
      },
      {
        column: 'section_code',
        kind: 'string',
        aliases: ['section', 'block_section', 'section_or_corridor', 'corridor'],
        required: true,
      },
      {
        column: 'requested_start',
        kind: 'timestamp',
        aliases: ['start', 'from', 'window_start'],
        fallback: null,
      },
      {
        column: 'requested_end',
        kind: 'timestamp',
        aliases: ['end', 'to', 'window_end'],
        fallback: null,
      },
      {
        column: 'duration_required_hrs',
        kind: 'number',
        aliases: [
          // estimated_duration_hours is the real column in the BDMS workbook.
          'estimated_duration_hours',
          'duration',
          'duration_hrs',
          'hours',
          {
            name: 'recommended_block_duration_minutes',
            toBaseUnit: (minutes) => minutes / 60,
          },
          { name: 'total_block_time_minutes', toBaseUnit: (minutes) => minutes / 60 },
        ],
        fallback: 2,
        min: 0.25,
        max: 99,
      },
      {
        column: 'purpose',
        kind: 'string',
        aliases: [
          'maintenance_type_detail',
          'maintenance_category',
          'work_description',
          'reason',
          'work',
          'description',
        ],
        fallback: '',
      },
      {
        column: 'status',
        kind: 'string',
        aliases: ['maintenance_status', 'state'],
        fallback: 'Pending',
      },
    ],
  },
  coa_slots: {
    table: 'coa_slots',
    label: 'COA corridor slots',
    conflictTarget: 'section_code,slot_start',
    postProcess: (row) => {
      const notes: string[] = []
      const start = Date.parse(String(row.slot_start ?? ''))
      const end = Date.parse(String(row.slot_end ?? ''))

      if (Number.isNaN(start) || Number.isNaN(end)) return { notes }

      // Identical bounds mean the corridor published no free time at all
      // (COA writes 00:00:00 -> 00:00:00 when occupancy is 100%). Rolling
      // that forward would invent a 24-hour window on the *busiest*
      // corridors — the exact opposite of the truth — so drop the row.
      if (end === start) {
        return {
          notes,
          reject:
            'no free corridor window published (start equals end); nothing to schedule against.',
        }
      }

      // A genuine window running past midnight (22:00 -> 02:00) comes back
      // inverted, because both bounds were anchored to the same day.
      if (end < start) {
        const rolled = new Date(end + 24 * 60 * 60 * 1000)
        row.slot_end = rolled.toISOString()
        notes.push(
          `slot_end preceded slot_start; treated as crossing midnight and moved to ${rolled.toISOString()}.`
        )
      }

      return { notes }
    },
    fields: [
      {
        column: 'section_code',
        kind: 'string',
        aliases: ['section', 'block_section', 'section_or_corridor', 'corridor'],
        required: true,
      },
      {
        column: 'slot_start',
        kind: 'timestamp',
        aliases: [
          'start',
          'window_start',
          'from',
          'start_time',
          'preferred_start_hour',
          // Real column in the COA workbook's corridor_availability sheet.
          // NOTE: it holds a time of day ("00:53:00") with no date, so it
          // will not parse into a timestamp until a date convention is agreed.
          'best_free_window_start',
        ],
        required: true,
      },
      {
        column: 'slot_end',
        kind: 'timestamp',
        aliases: [
          'end',
          'window_end',
          'to',
          'end_time',
          'preferred_end_hour',
          'best_free_window_end',
        ],
        required: true,
      },
      {
        column: 'freight_impact_score',
        kind: 'integer',
        aliases: ['freight_impact', 'freight', 'freight_train_impact'],
        fallback: 3,
        min: 1,
        max: 5,
      },
      {
        column: 'passenger_traffic_density',
        kind: 'string',
        aliases: [
          'traffic_density',
          'density',
          'passenger_density',
          'passenger_train_impact',
        ],
        fallback: 'Medium',
      },
    ],
  },
}

/** Which department each defect table belongs to. */
export const TABLE_DEPARTMENT = {
  tms_defects: 'Engineering',
  smms_defects: 'S&T',
  tdms_defects: 'Traction_TRD',
} as const

/** Which source system label each defect table represents. */
export const TABLE_SYSTEM = {
  tms_defects: 'TMS',
  smms_defects: 'SMMS',
  tdms_defects: 'TDMS',
} as const

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

function clamp(value: number, min?: number, max?: number) {
  let result = value
  if (typeof min === 'number') result = Math.max(min, result)
  if (typeof max === 'number') result = Math.min(max, result)
  return result
}

function coerce(
  spec: FieldSpec,
  raw: unknown,
  toBaseUnit?: (value: number) => number
): unknown {
  const text = raw === null || raw === undefined ? '' : String(raw).trim()

  if (text === '') return spec.fallback ?? null

  switch (spec.kind) {
    case 'string':
      return text

    case 'number':
    case 'integer': {
      const parsed = Number(text)

      if (!Number.isFinite(parsed)) {
        // Not numeric — fall back to a declared textual meaning before giving
        // up, so "High" becomes a score rather than the default.
        const mapped = spec.textMap?.[lookupKey(text)]
        if (mapped === undefined) return spec.fallback ?? null

        const bounded = clamp(mapped, spec.min, spec.max)
        return spec.kind === 'integer' ? Math.round(bounded) : bounded
      }

      const converted = toBaseUnit ? toBaseUnit(parsed) : parsed
      const bounded = clamp(converted, spec.min, spec.max)
      return spec.kind === 'integer' ? Math.round(bounded) : bounded
    }

    case 'boolean': {
      const lowered = text.toLowerCase()
      return ['true', '1', 'yes', 'y', 't'].includes(lowered)
    }

    case 'timestamp': {
      const parsed = Date.parse(text)
      if (!Number.isNaN(parsed)) return new Date(parsed).toISOString()

      // A bare time of day carries no date; anchor it to today.
      const timeOnly = parseTimeOfDay(text)
      return timeOnly ?? spec.fallback ?? null
    }
  }
}

/**
 * Every header this table understands — column names plus all their aliases.
 *
 * Handed to the spreadsheet parser so it can recognise the real header row
 * underneath a title banner instead of assuming row 1.
 */
export function knownHeaderNames(spec: TableSpec): string[] {
  const names: string[] = []

  for (const field of spec.fields) {
    names.push(field.column)
    for (const alias of field.aliases ?? []) {
      names.push(typeof alias === 'string' ? alias : alias.name)
    }
  }

  return names
}

export type MappedRow = {
  row: Record<string, unknown> | null
  problem: string | null
  /** Non-fatal notes -- e.g. a field was defaulted rather than rejected. */
  warnings?: string[]
}

/**
 * Maps one parsed CSV record onto a table's columns.
 *
 * Header matching is case- and separator-insensitive, so `Asset ID`,
 * `asset-id` and `asset_id` all land on the same column.
 */
export function mapRow(
  spec: TableSpec,
  record: Record<string, unknown>,
  lineNumber: number
): MappedRow {
  // Normalise the record's keys once, so alias lookup is cheap.
  const normalised = new Map<string, unknown>()
  for (const [key, value] of Object.entries(record)) {
    normalised.set(key.trim().toLowerCase().replace(/[\s-]+/g, '_'), value)
  }

  const out: Record<string, unknown> = {}
  const missing: string[] = []
  const warnings: string[] = []

  for (const field of spec.fields) {
    const candidates: AliasSpec[] = [field.column, ...(field.aliases ?? [])]
    let raw: unknown
    let toBaseUnit: ((value: number) => number) | undefined

    for (const candidate of candidates) {
      const name = typeof candidate === 'string' ? candidate : candidate.name
      const value = normalised.get(name)
      if (value !== undefined && String(value).trim() !== '') {
        raw = value
        toBaseUnit = typeof candidate === 'string' ? undefined : candidate.toBaseUnit
        break
      }
    }

    const value = coerce(field, raw, toBaseUnit)

    if (field.required && (value === null || value === '')) {
      if (field.deriveFallback) {
        const derived = field.deriveFallback({ mapped: out, raw: normalised })
        out[field.column] = derived.value
        warnings.push(`Row ${lineNumber}: ${derived.note}`)
        continue
      }
      missing.push(field.column)
      continue
    }

    if (value !== null) out[field.column] = value
  }

  if (missing.length > 0) {
    // Warnings describe values that were defaulted so the row could be kept.
    // This row is being dropped regardless, so reporting them would only be
    // misleading noise next to the actual rejection reason.
    return {
      row: null,
      problem: `Row ${lineNumber}: missing required ${missing.join(', ')}.`,
    }
  }

  // risk_score is NOT NULL in the defect tables but frequently absent from
  // source exports, so derive it from criticality rather than rejecting.
  if (
    spec.fields.some((f) => f.column === 'risk_score') &&
    out.risk_score === undefined
  ) {
    const criticality = Number(out.asset_criticality_score ?? 5)
    out.risk_score = clamp(criticality * 10, 0, 100)
  }

  // Cross-column fix-ups, once every field is present.
  if (spec.postProcess) {
    const { notes, reject } = spec.postProcess(out)

    if (reject) {
      return { row: null, problem: `Row ${lineNumber}: ${reject}` }
    }

    for (const note of notes) warnings.push(`Row ${lineNumber}: ${note}`)
  }

  return {
    row: out,
    problem: null,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

export type DedupeResult = {
  rows: Record<string, unknown>[]
  duplicatesRemoved: number
}

/**
 * Collapses rows that share the same conflict-target key, keeping the LAST
 * occurrence of each.
 *
 * Supabase's upsert rejects a batch outright if it contains the same
 * conflict key twice ("ON CONFLICT DO UPDATE command cannot affect row a
 * second time"), which a real export can easily trigger — e.g. an asset
 * re-inspected twice in one day, appearing on two rows of the same sheet.
 * Deduplicating in memory before the request is the only fix; Supabase has
 * no "last write wins within this batch" mode.
 *
 * "Last occurrence wins" assumes a spreadsheet lists corrections below the
 * original row, which matches how these exports are typically built.
 *
 * `conflictTarget` may name more than one column (e.g. coa_slots' composite
 * "section_code,slot_start"), so the dedupe key is built from all of them.
 */
export function dedupeRows(
  spec: TableSpec,
  rows: Record<string, unknown>[]
): DedupeResult {
  const keyColumns = spec.conflictTarget.split(',').map((c) => c.trim())

  // JSON.stringify each value individually (rather than concatenating raw
  // strings) so two different column combinations can never collide on the
  // same key -- plain concatenation would confuse ("AB", "") with ("A", "B").
  const byKey = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    const key = keyColumns.map((col) => JSON.stringify(row[col] ?? null)).join('|')
    byKey.set(key, row)
  }

  return {
    rows: Array.from(byKey.values()),
    duplicatesRemoved: rows.length - byKey.size,
  }
}
