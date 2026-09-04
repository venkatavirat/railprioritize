-- ===========================================================================
-- Per-user data isolation with full ownership & DELETE rights.
-- ===========================================================================

-- 1. Add owner column and index to all ingestible tables and derived plans
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

-- 2. Apply strict Row Level Security (Users can SELECT, INSERT, UPDATE, DELETE ONLY their own rows)
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tms_defects','smms_defects','tdms_defects',
    'bdms_demands','coa_slots','block_schedules'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- Clean up old permissive policies
    EXECUTE format('DROP POLICY IF EXISTS demo_all_%I ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS owner_rw_%I ON public.%I', t, t);

    -- Grant full control (SELECT, INSERT, UPDATE, DELETE) restricted to the owner
    EXECUTE format($f$
      CREATE POLICY owner_rw_%I ON public.%I
        FOR ALL
        USING (uploaded_by = auth.uid())
        WITH CHECK (uploaded_by = auth.uid())
    $f$, t, t);
  END LOOP;
END$$;

-- 3. Clear out unowned legacy rows so every user starts with a clean slate
DELETE FROM tms_defects        WHERE uploaded_by IS NULL;
DELETE FROM smms_defects       WHERE uploaded_by IS NULL;
DELETE FROM tdms_defects       WHERE uploaded_by IS NULL;
DELETE FROM bdms_demands      WHERE uploaded_by IS NULL;
DELETE FROM coa_slots         WHERE uploaded_by IS NULL;
DELETE FROM block_schedules   WHERE uploaded_by IS NULL;