-- ===========================================================================
-- RailPrioritize — Multi-Department Block Optimisation Schema
-- Run this in the Supabase SQL Editor.
--
-- Safe to re-run: type creation is guarded and tables use IF NOT EXISTS.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Enum types
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dept_type') THEN
    CREATE TYPE dept_type AS ENUM ('Engineering', 'S&T', 'Traction_TRD');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'priority_level') THEN
    CREATE TYPE priority_level AS ENUM ('Critical', 'High', 'Medium', 'Low');
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- 2. Unified multi-department defect / maintenance backlog
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS maintenance_defects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department dept_type NOT NULL,
    system_source VARCHAR(10) NOT NULL,          -- TMS, SMMS, TDMS
    asset_id VARCHAR(50) NOT NULL,
    asset_criticality_score INT DEFAULT 5,       -- Scale 1-10
    section_code VARCHAR(50) NOT NULL,
    defect_description TEXT NOT NULL,
    risk_score NUMERIC(5,2) NOT NULL,
    duration_required_hrs NUMERIC(4,2) NOT NULL,
    is_overdue BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- One live defect row per asset, so repeated CSV uploads update instead of
-- duplicating. Required for the uploader's ON CONFLICT upsert.
CREATE UNIQUE INDEX IF NOT EXISTS maintenance_defects_asset_key
    ON maintenance_defects (asset_id);

CREATE INDEX IF NOT EXISTS maintenance_defects_section_idx
    ON maintenance_defects (section_code);
CREATE INDEX IF NOT EXISTS maintenance_defects_risk_idx
    ON maintenance_defects (risk_score DESC);

-- ---------------------------------------------------------------------------
-- 3. Corridor availability / traffic timetable constraints (COA data)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS corridor_windows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section_code VARCHAR(50) NOT NULL,
    window_start TIMESTAMP WITH TIME ZONE NOT NULL,
    window_end TIMESTAMP WITH TIME ZONE NOT NULL,
    freight_impact_score INT DEFAULT 3,
    passenger_traffic_density VARCHAR(20) NOT NULL  -- High, Medium, Low
);

CREATE UNIQUE INDEX IF NOT EXISTS corridor_windows_slot_key
    ON corridor_windows (section_code, window_start);

-- ---------------------------------------------------------------------------
-- 4. AI-optimised block allocations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS block_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section_code VARCHAR(50) NOT NULL,
    block_start TIMESTAMP WITH TIME ZONE NOT NULL,
    block_end TIMESTAMP WITH TIME ZONE NOT NULL,
    combined_departments dept_type[] NOT NULL,
    assigned_defect_ids UUID[] NOT NULL,
    total_downtime_saved_hrs NUMERIC(4,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'Recommended',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS block_schedules_section_idx
    ON block_schedules (section_code, block_start);

-- ---------------------------------------------------------------------------
-- 5. Row Level Security
--
-- NOTE: these are permissive, demo-grade policies so the browser anon key can
-- read and write directly. Before any real deployment, replace them with
-- policies scoped to authenticated users / departments.
-- ---------------------------------------------------------------------------
ALTER TABLE maintenance_defects ENABLE ROW LEVEL SECURITY;
ALTER TABLE corridor_windows    ENABLE ROW LEVEL SECURITY;
ALTER TABLE block_schedules     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS demo_all_maintenance_defects ON maintenance_defects;
CREATE POLICY demo_all_maintenance_defects ON maintenance_defects
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS demo_all_corridor_windows ON corridor_windows;
CREATE POLICY demo_all_corridor_windows ON corridor_windows
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS demo_all_block_schedules ON block_schedules;
CREATE POLICY demo_all_block_schedules ON block_schedules
    FOR ALL USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 6. Seed data
--
-- Deliberately clusters several departments onto the SAME section_code so the
-- optimiser has genuine multi-department co-use opportunities to find.
-- ---------------------------------------------------------------------------

-- Engineering (TMS)
INSERT INTO maintenance_defects
  (department, system_source, asset_id, asset_criticality_score, section_code,
   defect_description, risk_score, duration_required_hrs, is_overdue)
VALUES
  ('Engineering','TMS','TRK-9021',9,'SC-KZJ-UP','Deep screening required — fouled ballast over 1.2 km, degraded drainage',88.50,3.00,TRUE),
  ('Engineering','TMS','TRK-9044',7,'SC-KZJ-UP','Rail profile grinding due — gauge corner checking at 4 locations',72.00,2.00,FALSE),
  ('Engineering','TMS','BRG-118',10,'BZA-GNT-UP','Girder bearing inspection overdue on minor bridge No. 118',94.00,4.00,TRUE),
  ('Engineering','TMS','TRK-7710',6,'SC-MED-UP','Weld renewal — 3 suspect AT welds flagged by USFD',64.00,2.50,FALSE),
  ('Engineering','TMS','TRK-8802',8,'GTL-DHNE-DN','Track tamping and lifting over 800 m, cross-level defects',79.00,3.50,TRUE),

-- Signalling & Telecom (SMMS)
  ('S&T','SMMS','PT-402B',9,'SC-KZJ-UP','Point machine overhaul — obstruction test failure, slow operation',86.00,2.50,TRUE),
  ('S&T','SMMS','SIG-221',7,'SC-KZJ-UP','LED signal unit replacement — intermittent aspect failure',70.50,1.50,FALSE),
  ('S&T','SMMS','AXC-051',8,'BZA-GNT-UP','Axle counter reset card replacement, repeated system resets',81.00,2.00,TRUE),
  ('S&T','SMMS','PT-609',6,'SC-MED-UP','Point machine lubrication and adjustment, routine schedule',55.00,1.00,FALSE),
  ('S&T','SMMS','IPS-014',9,'GTL-DHNE-DN','IPS battery bank replacement — backup below 60% capacity',84.00,2.00,TRUE),

-- Traction / TRD (TDMS)
  ('Traction_TRD','TDMS','OHE-102',9,'SC-KZJ-UP','Insulator replacement — tracking marks on 6 cantilever insulators',85.00,2.00,TRUE),
  ('Traction_TRD','TDMS','OHE-118',7,'BZA-GNT-UP','Contact wire wear beyond limit over 400 m span',74.00,3.00,FALSE),
  ('Traction_TRD','TDMS','TSS-04',10,'BZA-GNT-UP','Traction substation breaker maintenance — overdue by 45 days',92.00,4.00,TRUE),
  ('Traction_TRD','TDMS','OHE-233',6,'SC-MED-UP','Dropper renewal at 12 locations, tension adjustment',58.00,1.50,FALSE),
  ('Traction_TRD','TDMS','OHE-341',8,'GTL-DHNE-DN','Section insulator overhaul, arcing reported by loco pilots',77.50,2.50,TRUE)
ON CONFLICT (asset_id) DO UPDATE SET
  department              = EXCLUDED.department,
  system_source           = EXCLUDED.system_source,
  asset_criticality_score = EXCLUDED.asset_criticality_score,
  section_code            = EXCLUDED.section_code,
  defect_description      = EXCLUDED.defect_description,
  risk_score              = EXCLUDED.risk_score,
  duration_required_hrs   = EXCLUDED.duration_required_hrs,
  is_overdue              = EXCLUDED.is_overdue;

-- Corridor availability windows (COA), anchored to "tomorrow" so the data
-- stays in the future no matter when the script is run.
INSERT INTO corridor_windows
  (section_code, window_start, window_end, freight_impact_score, passenger_traffic_density)
VALUES
  ('SC-KZJ-UP',    (CURRENT_DATE + 1) + TIME '01:30', (CURRENT_DATE + 1) + TIME '05:30', 2, 'Low'),
  ('SC-KZJ-UP',    (CURRENT_DATE + 2) + TIME '02:00', (CURRENT_DATE + 2) + TIME '05:00', 3, 'Low'),
  ('BZA-GNT-UP',   (CURRENT_DATE + 1) + TIME '00:30', (CURRENT_DATE + 1) + TIME '05:00', 4, 'Medium'),
  ('BZA-GNT-UP',   (CURRENT_DATE + 3) + TIME '01:00', (CURRENT_DATE + 3) + TIME '06:00', 2, 'Low'),
  ('SC-MED-UP',    (CURRENT_DATE + 2) + TIME '23:00', (CURRENT_DATE + 3) + TIME '03:00', 3, 'Medium'),
  ('GTL-DHNE-DN',  (CURRENT_DATE + 1) + TIME '02:00', (CURRENT_DATE + 1) + TIME '06:30', 1, 'Low'),
  ('GTL-DHNE-DN',  (CURRENT_DATE + 4) + TIME '01:00', (CURRENT_DATE + 4) + TIME '04:30', 3, 'Low'),
  ('SC-MED-UP',    (CURRENT_DATE + 5) + TIME '01:30', (CURRENT_DATE + 5) + TIME '04:30', 2, 'Low')
ON CONFLICT (section_code, window_start) DO UPDATE SET
  window_end                = EXCLUDED.window_end,
  freight_impact_score      = EXCLUDED.freight_impact_score,
  passenger_traffic_density = EXCLUDED.passenger_traffic_density;
