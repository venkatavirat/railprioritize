-- ===========================================================================
-- Re-key tdms_defects on maintenance_id.
--
-- WHY: TDMS holds one row per maintenance *request*, and an asset can have
-- several open at once. The real SIH26027 workbook carries 500 requests
-- across only 223 distinct assets, so a UNIQUE(asset_id) key silently
-- discarded 277 rows (55%) as upsert duplicates.
--
-- Run in the Supabase SQL Editor. Safe to re-run.
-- ===========================================================================

-- 1. Add the request identifier.
ALTER TABLE tdms_defects
  ADD COLUMN IF NOT EXISTS maintenance_id VARCHAR(64);

-- 2. Backfill existing rows. They were imported under the old key, so one row
--    per asset is all that exists; reusing asset_id keeps them addressable
--    and cannot collide.
UPDATE tdms_defects
   SET maintenance_id = asset_id
 WHERE maintenance_id IS NULL;

ALTER TABLE tdms_defects
  ALTER COLUMN maintenance_id SET NOT NULL;

-- 3. Swap the uniqueness constraint over.
--    asset_id keeps a plain (non-unique) index: it is still the column we
--    group and join on, it just no longer identifies a row.
--
--    The table declared `asset_id ... UNIQUE` inline, which Postgres stores
--    as a CONSTRAINT (tdms_defects_asset_id_key) rather than a bare index, so
--    DROP INDEX alone would silently do nothing. This finds whatever unique
--    constraint covers asset_id on its own and drops it by its real name.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT con.conname INTO constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
   WHERE rel.relname = 'tdms_defects'
     AND con.contype = 'u'
     AND array_length(con.conkey, 1) = 1
     AND att.attname = 'asset_id'
   LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE tdms_defects DROP CONSTRAINT %I', constraint_name);
  END IF;
END$$;

-- Also covers the case where it exists as a standalone unique index.
DROP INDEX IF EXISTS tdms_defects_asset_key;

CREATE UNIQUE INDEX IF NOT EXISTS tdms_defects_maintenance_key
    ON tdms_defects (maintenance_id);

CREATE INDEX IF NOT EXISTS tdms_defects_asset_idx
    ON tdms_defects (asset_id);

-- ---------------------------------------------------------------------------
-- Verify:
--   SELECT COUNT(*) AS rows, COUNT(DISTINCT asset_id) AS assets,
--          COUNT(DISTINCT maintenance_id) AS requests
--     FROM tdms_defects;
--
-- After re-importing the TDMS workbook, `rows` and `requests` should both be
-- 500 while `assets` stays at 223.
-- ---------------------------------------------------------------------------
