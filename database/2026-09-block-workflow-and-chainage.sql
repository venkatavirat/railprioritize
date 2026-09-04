-- ===========================================================================
-- Production enhancements: spatial chainage, block approval workflow.
--
-- Run in the Supabase SQL Editor. Safe to re-run.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Chainage on the defect tables.
--
-- The source workbooks publish a single `chainage_km` point per work site,
-- not a range, so start/end are nullable and the spatial engine treats a bare
-- point as a zero-length extent. Explicit ranges are honoured when supplied.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['tms_defects','smms_defects','tdms_defects']
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS chainage_km NUMERIC(8,3)', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS chainage_start_km NUMERIC(8,3)', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS chainage_end_km NUMERIC(8,3)', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (section_code, chainage_km)',
                   t || '_chainage_idx', t);
  END LOOP;
END$$;

-- ---------------------------------------------------------------------------
-- 2. Block approval workflow.
--
-- block_start/block_end remain the *scheduled* window a controller may edit.
-- The AI's original proposal is preserved alongside so a MODIFIED block shows
-- what actually changed rather than silently overwriting the recommendation.
-- ---------------------------------------------------------------------------
ALTER TABLE block_schedules ADD COLUMN IF NOT EXISTS original_block_start TIMESTAMPTZ;
ALTER TABLE block_schedules ADD COLUMN IF NOT EXISTS original_block_end   TIMESTAMPTZ;
ALTER TABLE block_schedules ADD COLUMN IF NOT EXISTS approved_by          TEXT;
ALTER TABLE block_schedules ADD COLUMN IF NOT EXISTS approval_timestamp   TIMESTAMPTZ;
ALTER TABLE block_schedules ADD COLUMN IF NOT EXISTS rejection_reason     TEXT;
ALTER TABLE block_schedules ADD COLUMN IF NOT EXISTS permit_number        TEXT;
ALTER TABLE block_schedules ADD COLUMN IF NOT EXISTS chainage_start_km    NUMERIC(8,3);
ALTER TABLE block_schedules ADD COLUMN IF NOT EXISTS chainage_end_km      NUMERIC(8,3);
ALTER TABLE block_schedules ADD COLUMN IF NOT EXISTS safety_flags         JSONB;
ALTER TABLE block_schedules ADD COLUMN IF NOT EXISTS coa_window_ref       TEXT;

-- Backfill the original window for rows created before this migration.
UPDATE block_schedules
   SET original_block_start = COALESCE(original_block_start, block_start),
       original_block_end   = COALESCE(original_block_end,   block_end);

-- Migrate the old free-text status onto the controlled vocabulary.
UPDATE block_schedules
   SET status = 'PROPOSED'
 WHERE status IS NULL OR status NOT IN ('PROPOSED','APPROVED','MODIFIED','REJECTED');

-- VARCHAR(20) is long enough for every state, but widen defensively so the
-- CHECK below is the only thing that can reject a value.
ALTER TABLE block_schedules ALTER COLUMN status TYPE TEXT;
ALTER TABLE block_schedules ALTER COLUMN status SET DEFAULT 'PROPOSED';

ALTER TABLE block_schedules DROP CONSTRAINT IF EXISTS block_schedules_status_check;
ALTER TABLE block_schedules
  ADD CONSTRAINT block_schedules_status_check
  CHECK (status IN ('PROPOSED','APPROVED','MODIFIED','REJECTED'));

-- One permit number per issued order.
CREATE UNIQUE INDEX IF NOT EXISTS block_schedules_permit_key
    ON block_schedules (permit_number) WHERE permit_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS block_schedules_status_idx ON block_schedules (status);

-- ---------------------------------------------------------------------------
-- Verify:
--   SELECT status, COUNT(*) FROM block_schedules GROUP BY status;
-- ---------------------------------------------------------------------------
