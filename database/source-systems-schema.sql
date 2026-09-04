-- ===========================================================================
-- Source-system ingestion tables.
--
-- Each maintenance system owns its own table so raw feeds stay separable and
-- auditable. lib/data-sources.ts unifies them for the optimiser.
--
-- Run in the Supabase SQL Editor. Safe to re-run.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Engineering — Track Management System
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tms_defects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id VARCHAR(50) NOT NULL UNIQUE,
    section_code VARCHAR(50) NOT NULL,
    defect_description TEXT NOT NULL DEFAULT '',
    risk_score NUMERIC(5,2) NOT NULL DEFAULT 50,
    duration_required_hrs NUMERIC(5,2) NOT NULL DEFAULT 2,
    asset_criticality_score INT NOT NULL DEFAULT 5,
    is_overdue BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Signalling & Telecom — Signal Maintenance Management System
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS smms_defects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id VARCHAR(50) NOT NULL UNIQUE,
    section_code VARCHAR(50) NOT NULL,
    defect_description TEXT NOT NULL DEFAULT '',
    risk_score NUMERIC(5,2) NOT NULL DEFAULT 50,
    duration_required_hrs NUMERIC(5,2) NOT NULL DEFAULT 2,
    asset_criticality_score INT NOT NULL DEFAULT 5,
    is_overdue BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Traction / TRD — Traction Distribution Management System
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tdms_defects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id VARCHAR(50) NOT NULL UNIQUE,
    section_code VARCHAR(50) NOT NULL,
    defect_description TEXT NOT NULL DEFAULT '',
    risk_score NUMERIC(5,2) NOT NULL DEFAULT 50,
    duration_required_hrs NUMERIC(5,2) NOT NULL DEFAULT 2,
    asset_criticality_score INT NOT NULL DEFAULT 5,
    is_overdue BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Block Demand Management System — the block requests departments file today
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bdms_demands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    demand_id VARCHAR(50) NOT NULL UNIQUE,
    department VARCHAR(30) NOT NULL,
    section_code VARCHAR(50) NOT NULL,
    requested_start TIMESTAMPTZ,
    requested_end TIMESTAMPTZ,
    duration_required_hrs NUMERIC(5,2) NOT NULL DEFAULT 2,
    purpose TEXT NOT NULL DEFAULT '',
    status VARCHAR(20) NOT NULL DEFAULT 'Pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Corridor Availability — traffic-free slots published by operations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coa_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section_code VARCHAR(50) NOT NULL,
    slot_start TIMESTAMPTZ NOT NULL,
    slot_end TIMESTAMPTZ NOT NULL,
    freight_impact_score INT NOT NULL DEFAULT 3,
    passenger_traffic_density VARCHAR(20) NOT NULL DEFAULT 'Medium',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS coa_slots_slot_key
    ON coa_slots (section_code, slot_start);

CREATE INDEX IF NOT EXISTS tms_defects_section_idx  ON tms_defects  (section_code);
CREATE INDEX IF NOT EXISTS smms_defects_section_idx ON smms_defects (section_code);
CREATE INDEX IF NOT EXISTS tdms_defects_section_idx ON tdms_defects (section_code);
CREATE INDEX IF NOT EXISTS bdms_demands_section_idx ON bdms_demands (section_code);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Demo-grade: permissive so the anon key can read, and so the ingestion route
-- can write with the anon key when no service-role key is configured.
-- Tighten before any real deployment.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['tms_defects','smms_defects','tdms_defects','bdms_demands','coa_slots']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS demo_all_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY demo_all_%I ON public.%I FOR ALL USING (true) WITH CHECK (true)',
      t, t
    );
  END LOOP;
END$$;
