-- ===========================================================================
-- RailPrioritize — unified baseline migration.
--
-- Supersedes the three earlier migration files. Safe to re-run; idempotent.
--
-- Corrects four things against the draft consolidated script:
--   * uses `status`, not `workflow_status` — the application reads and writes
--     `status`, so a new column would never be populated and the approval
--     workflow would silently do nothing.
--   * adds the approval/permit columns the workflow actually needs, without
--     which Approve/Reject and the printable block order still fail.
--   * adds chainage to the DEFECT tables, not just block_schedules — the
--     500 m spatial engine reads coordinates from the defects.
--   * gives tdms_defects a UNIQUE maintenance_id and drops the old
--     UNIQUE(asset_id), otherwise the TDMS upsert has no matching conflict
--     target and 55% of rows are discarded as duplicates.
--
-- The DELETE of unowned legacy rows is intentionally NOT repeated here: it
-- has already been applied, and re-running destructive statements by default
-- is how data gets lost twice.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. TDMS: one row per maintenance REQUEST, not per asset
-- ---------------------------------------------------------------------------
ALTER TABLE public.tdms_defects ADD COLUMN IF NOT EXISTS maintenance_id VARCHAR(64);

UPDATE public.tdms_defects SET maintenance_id = asset_id WHERE maintenance_id IS NULL;

-- Drop the inline UNIQUE(asset_id) constraint by its real name, whatever it is.
DO $$
DECLARE cname TEXT;
BEGIN
  SELECT con.conname INTO cname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
   WHERE rel.relname = 'tdms_defects'
     AND con.contype = 'u'
     AND array_length(con.conkey, 1) = 1
     AND att.attname = 'asset_id'
   LIMIT 1;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.tdms_defects DROP CONSTRAINT %I', cname);
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS tdms_defects_maintenance_key
  ON public.tdms_defects (maintenance_id);
CREATE INDEX IF NOT EXISTS tdms_defects_asset_idx
  ON public.tdms_defects (asset_id);

-- ---------------------------------------------------------------------------
-- 2. Chainage on the DEFECT tables — the spatial engine's coordinates
-- ---------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['tms_defects','smms_defects','tdms_defects']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS chainage_km NUMERIC(8,3)', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS chainage_start_km NUMERIC(8,3)', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS chainage_end_km NUMERIC(8,3)', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (section_code, chainage_km)',
                   t || '_chainage_idx', t);
  END LOOP;
END$$;

-- ---------------------------------------------------------------------------
-- 3. Block schedules: approval workflow, permits, spatial bounds
-- ---------------------------------------------------------------------------
ALTER TABLE public.block_schedules
  ADD COLUMN IF NOT EXISTS original_block_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS original_block_end   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by          TEXT,
  ADD COLUMN IF NOT EXISTS approval_timestamp   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason     TEXT,
  ADD COLUMN IF NOT EXISTS permit_number        TEXT,
  ADD COLUMN IF NOT EXISTS chainage_start_km    NUMERIC(8,3),
  ADD COLUMN IF NOT EXISTS chainage_end_km      NUMERIC(8,3),
  ADD COLUMN IF NOT EXISTS safety_flags         JSONB,
  ADD COLUMN IF NOT EXISTS coa_window_ref       TEXT;

UPDATE public.block_schedules
   SET original_block_start = COALESCE(original_block_start, block_start),
       original_block_end   = COALESCE(original_block_end,   block_end);

-- Controlled vocabulary on the column the application actually uses.
UPDATE public.block_schedules
   SET status = 'PROPOSED'
 WHERE status IS NULL OR status NOT IN ('PROPOSED','APPROVED','MODIFIED','REJECTED');

ALTER TABLE public.block_schedules ALTER COLUMN status TYPE TEXT;
ALTER TABLE public.block_schedules ALTER COLUMN status SET DEFAULT 'PROPOSED';

ALTER TABLE public.block_schedules DROP CONSTRAINT IF EXISTS block_schedules_status_check;
ALTER TABLE public.block_schedules
  ADD CONSTRAINT block_schedules_status_check
  CHECK (status IN ('PROPOSED','APPROVED','MODIFIED','REJECTED'));

CREATE UNIQUE INDEX IF NOT EXISTS block_schedules_permit_key
  ON public.block_schedules (permit_number) WHERE permit_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS block_schedules_status_idx
  ON public.block_schedules (status);

-- ---------------------------------------------------------------------------
-- 4. Ownership + owner-scoped RLS (already applied; kept for a clean rebuild)
-- ---------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tms_defects','smms_defects','tdms_defects',
    'bdms_demands','coa_slots','block_schedules'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES auth.users(id) ON DELETE CASCADE', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (uploaded_by)', t || '_owner_idx', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS demo_all_%I ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS owner_rw_%I ON public.%I', t, t);
    EXECUTE format($f$
      CREATE POLICY owner_rw_%I ON public.%I
        FOR ALL
        USING (uploaded_by = auth.uid())
        WITH CHECK (uploaded_by = auth.uid())
    $f$, t, t);
  END LOOP;
END$$;

-- ---------------------------------------------------------------------------
-- 5. Housekeeping: remove the row left by the RLS verification probe
-- ---------------------------------------------------------------------------
DELETE FROM public.tms_defects WHERE asset_id IN ('RLS-OK-1','RLS-BAD-1','RLS-TEST-1');

-- ---------------------------------------------------------------------------
-- Verify:
--   SELECT status, COUNT(*) FROM block_schedules GROUP BY status;
--   SELECT COUNT(*) rows, COUNT(DISTINCT asset_id) assets,
--          COUNT(DISTINCT maintenance_id) requests FROM tdms_defects;
-- ---------------------------------------------------------------------------
