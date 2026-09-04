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

export type FieldSpec = {
  /** Destination column. */
  column: string
  kind: FieldKind
  /** Accepted CSV headers, lower-cased. The column name is added implicitly. */
  aliases?: string[]
  required?: boolean
  /** Used when the CSV omits the column or the value is unparseable. */
  fallback?: unknown
  min?: number
  max?: number
}

export type TableSpec = {
  table: SourceTable
  label: string
  /** Column(s) that make a row unique, for ON CONFLICT. */
  conflictTarget: string
  fields: FieldSpec[]
}

const DEFECT_FIELDS: FieldSpec[] = [
  {
    column: 'asset_id',
    kind: 'string',
    aliases: ['asset', 'assetid', 'asset_no', 'equipment_id'],
    required: true,
  },
  {
    column: 'section_code',
    kind: 'string',
    aliases: ['section', 'sectioncode', 'block_section'],
    required: true,
  },
  {
    column: 'defect_description',
    kind: 'string',
    aliases: ['description', 'defect', 'remarks', 'fault'],
    fallback: '',
  },
  {
    column: 'risk_score',
    kind: 'number',
    aliases: ['risk', 'riskscore'],
    fallback: null, // derived from criticality when absent
    min: 0,
    max: 100,
  },
  {
    column: 'duration_required_hrs',
    kind: 'number',
    aliases: ['duration', 'duration_hrs', 'hours', 'est_duration_hrs'],
    fallback: 2,
    min: 0.25,
    max: 99,
  },
  {
    column: 'asset_criticality_score',
    kind: 'integer',
    aliases: ['criticality', 'crit', 'importance'],
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
    conflictTarget: 'asset_id',
    fields: DEFECT_FIELDS,
  },
  bdms_demands: {
    table: 'bdms_demands',
    label: 'BDMS block demands',
    conflictTarget: 'demand_id',
    fields: [
      {
        column: 'demand_id',
        kind: 'string',
        aliases: ['demand', 'demandid', 'request_id', 'block_id'],
        required: true,
      },
      {
        column: 'department',
        kind: 'string',
        aliases: ['dept', 'owning_department'],
        required: true,
      },
      {
        column: 'section_code',
        kind: 'string',
        aliases: ['section', 'block_section'],
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
        aliases: ['duration', 'duration_hrs', 'hours'],
        fallback: 2,
        min: 0.25,
        max: 99,
      },
      {
        column: 'purpose',
        kind: 'string',
        aliases: ['reason', 'work', 'description'],
        fallback: '',
      },
      {
        column: 'status',
        kind: 'string',
        aliases: ['state'],
        fallback: 'Pending',
      },
    ],
  },
  coa_slots: {
    table: 'coa_slots',
    label: 'COA corridor slots',
    conflictTarget: 'section_code,slot_start',
    fields: [
      {
        column: 'section_code',
        kind: 'string',
        aliases: ['section', 'block_section'],
        required: true,
      },
      {
        column: 'slot_start',
        kind: 'timestamp',
        aliases: ['start', 'window_start', 'from'],
        required: true,
      },
      {
        column: 'slot_end',
        kind: 'timestamp',
        aliases: ['end', 'window_end', 'to'],
        required: true,
      },
      {
        column: 'freight_impact_score',
        kind: 'integer',
        aliases: ['freight_impact', 'freight'],
        fallback: 3,
        min: 1,
        max: 5,
      },
      {
        column: 'passenger_traffic_density',
        kind: 'string',
        aliases: ['traffic_density', 'density', 'passenger_density'],
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

function coerce(spec: FieldSpec, raw: unknown): unknown {
  const text = raw === null || raw === undefined ? '' : String(raw).trim()

  if (text === '') return spec.fallback ?? null

  switch (spec.kind) {
    case 'string':
      return text

    case 'number':
    case 'integer': {
      const parsed = Number(text)
      if (!Number.isFinite(parsed)) return spec.fallback ?? null
      const bounded = clamp(parsed, spec.min, spec.max)
      return spec.kind === 'integer' ? Math.round(bounded) : bounded
    }

    case 'boolean': {
      const lowered = text.toLowerCase()
      return ['true', '1', 'yes', 'y', 't'].includes(lowered)
    }

    case 'timestamp': {
      const parsed = Date.parse(text)
      return Number.isNaN(parsed) ? (spec.fallback ?? null) : new Date(parsed).toISOString()
    }
  }
}

export type MappedRow = {
  row: Record<string, unknown> | null
  problem: string | null
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

  for (const field of spec.fields) {
    const candidates = [field.column, ...(field.aliases ?? [])]
    let raw: unknown

    for (const candidate of candidates) {
      const value = normalised.get(candidate)
      if (value !== undefined && String(value).trim() !== '') {
        raw = value
        break
      }
    }

    const value = coerce(field, raw)

    if (field.required && (value === null || value === '')) {
      missing.push(field.column)
      continue
    }

    if (value !== null) out[field.column] = value
  }

  if (missing.length > 0) {
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

  return { row: out, problem: null }
}
