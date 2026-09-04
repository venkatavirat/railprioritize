# RailPrioritize — Setup

Current setup guide for the multi-department block optimisation system.

> The older `QUICK_SETUP.md`, `DATABASE_SETUP.md` and the `REFACTOR_*` notes
> describe the retired `failures` / `tasks` / `corridor_availability` model.
> They are kept for history only — follow **this** file.

## 1. Install

```bash
npm install
```

## 2. Environment

Copy `.env.example` to `.env.local` and fill in every value:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
GEMINI_API_KEY=<Google AI Studio key>

# Optional. Server-only; lets the optimiser write block_schedules past RLS.
SUPABASE_SERVICE_ROLE_KEY=

# Signs you in automatically during local dev.
NEXT_PUBLIC_DEV_AUTH_BYPASS=true
```

- Supabase keys: Supabase dashboard → Project Settings → API.
- Gemini key: <https://aistudio.google.com/apikey>.

Next.js only reads `.env.local` at startup — **restart `npm run dev`** after
editing it.

## 3. Database

In the Supabase dashboard → SQL Editor → New Query, paste and run
[`database/multi-dept-schema.sql`](database/multi-dept-schema.sql).

It creates three tables and loads a 15-defect sample backlog spread across
four sections:

| Table                 | Holds                                              |
| --------------------- | -------------------------------------------------- |
| `maintenance_defects` | Unified backlog from TMS, SMMS and TDMS            |
| `corridor_windows`    | COA traffic availability windows                   |
| `block_schedules`     | Block allocations the optimiser recommends         |

The script is safe to re-run — enum creation is guarded and the seed rows
upsert on `asset_id`.

> **Security note:** the script installs permissive, demo-grade RLS policies so
> the browser anon key can read and write directly. Tighten these before any
> real deployment.

## 4. Run

```bash
npm run dev
```

Open <http://localhost:3000>. With `NEXT_PUBLIC_DEV_AUTH_BYPASS=true` you land
straight on the dashboard as the default planner
(`chief.engineer@scr.railways.gov.in`, `EMP-IR-1042`, Chief Operational Block
Planner, Secunderabad) with no login screen.

The bypass requires **both** that flag and a non-production build, so it
compiles to `return false` in `npm run build` output and cannot leave an
unauthenticated hole in a deployed environment.

## 5. Using it

1. **Data Ingestion** — upload a CSV. The format is detected from the header
   row; see the samples in `database/`.
2. Pick a horizon in the header: **Weekly** (7-day execution plan) or
   **Monthly** (30-day advance reservation).
3. Press **Run AI Optimization Engine**. Gemini 2.5 Flash reconciles the
   backlog against corridor availability and returns KPIs, a block timetable
   and an executive summary. Recommendations are also written to
   `block_schedules`.

### CSV formats

**Defects** (`database/sample-defects.csv`):

```
department,system_source,asset_id,asset_criticality_score,section_code,defect_description,risk_score,duration_required_hrs,is_overdue
```

Only `department`, `asset_id` and `section_code` are strictly required.
`risk_score` falls back to `asset_criticality_score × 10`, and
`system_source` defaults from the department (Engineering→TMS, S&T→SMMS,
Traction_TRD→TDMS).

**Corridor windows** (`database/sample-corridor-windows.csv`):

```
section_code,window_start,window_end,freight_impact_score,passenger_traffic_density
```

Rows upsert, so re-uploading a corrected file updates rather than duplicates.

## Troubleshooting

| Symptom                                        | Cause                                                        |
| ---------------------------------------------- | ------------------------------------------------------------ |
| `GEMINI_API_KEY is not configured` (503)        | Key missing or still `REPLACE_ME`. Set it, restart dev.       |
| `Could not read maintenance data…` (502)        | Supabase keys wrong, or the schema script has not been run.   |
| Dashboard shows "No maintenance backlog"        | Tables exist but are empty — run the seed or upload a CSV.    |
| Login screen appears on localhost               | `NEXT_PUBLIC_DEV_AUTH_BYPASS` is not `true`, or no restart.   |
