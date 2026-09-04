-- ===========================================================================
-- Per-user data isolation.
--
-- Until now every source table was global: any signed-in user saw every other
-- user's uploads. This adds an owner column, scopes Row Level Security to it,
-- and indexes it.
--
-- Run in the Supabase SQL Editor. Read section 4 before running -- it decides
-- what happens to the rows that already exist.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Owner column on every ingestible table and on the plans derived from them
-- ---------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tms_defects','smms_defects','tdms_defects',
    'bdms_demands','coa_slots','block_schedules'
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES auth.users(id) ON DELETE CASCADE', t);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (uploaded_by)', t || '_owner_idx', t);
  END LOOP;
END$$;

-- ---------------------------------------------------------------------------
-- 2. Replace the permissive demo policies with owner-scoped ones
--
-- The old policies were `USING (true)`, i.e. everyone sees everything. These
-- restrict every operation to rows the caller owns.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tms_defects','smms_defects','tdms_defects',
    'bdms_demands','coa_slots','block_schedules'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- Drop the old global-access policies by their known names.
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
-- 3. Confirm what each account now owns
-- ---------------------------------------------------------------------------
-- SELECT uploaded_by, COUNT(*) FROM tms_defects GROUP BY uploaded_by;

-- ---------------------------------------------------------------------------
-- 4. EXISTING ROWS -- CHOOSE ONE. Nothing below runs until you uncomment it.
--
-- ~18,000 rows already exist with uploaded_by = NULL. They match no owner, so
-- once the policies above are live they belong to nobody and will not appear
-- for any user. Decide deliberately:
--
--   OPTION A -- claim them for one account (put your own user id in):
--
-- UPDATE tms_defects    SET uploaded_by = '<YOUR-USER-UUID>' WHERE uploaded_by IS NULL;
-- UPDATE smms_defects   SET uploaded_by = '<YOUR-USER-UUID>' WHERE uploaded_by IS NULL;
-- UPDATE tdms_defects   SET uploaded_by = '<YOUR-USER-UUID>' WHERE uploaded_by IS NULL;
-- UPDATE bdms_demands   SET uploaded_by = '<YOUR-USER-UUID>' WHERE uploaded_by IS NULL;
-- UPDATE coa_slots      SET uploaded_by = '<YOUR-USER-UUID>' WHERE uploaded_by IS NULL;
-- UPDATE block_schedules SET uploaded_by = '<YOUR-USER-UUID>' WHERE uploaded_by IS NULL;
--
--   Find your id with:  SELECT id, email FROM auth.users;
--
--   OPTION B -- discard the shared legacy data and start clean:
--
-- DELETE FROM tms_defects    WHERE uploaded_by IS NULL;
-- DELETE FROM smms_defects   WHERE uploaded_by IS NULL;
-- DELETE FROM tdms_defects   WHERE uploaded_by IS NULL;
-- DELETE FROM bdms_demands   WHERE uploaded_by IS NULL;
-- DELETE FROM coa_slots      WHERE uploaded_by IS NULL;
-- DELETE FROM block_schedules WHERE uploaded_by IS NULL;
