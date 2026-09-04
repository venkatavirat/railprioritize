-- ===========================================================================
-- 00_reset_auth.sql — Purge and rebuild the authentication schema.
--
-- Run in the Supabase SQL Editor. Destructive: see the DROP block below.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Wipe existing corrupt tables
--
-- CASCADE also drops dependent views, constraints and policies. Nothing else
-- in this project references public.users or public.profiles, but if you have
-- added your own objects on top of them, check before running.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.users CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Rebuild user profiles
-- ---------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  department TEXT NOT NULL CHECK (department IN ('Engineering', 'S&T', 'Traction', 'Operations', 'Admin')),
  full_name TEXT,
  role TEXT DEFAULT 'USER',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 3. Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ⚠ SECURITY WARNING -------------------------------------------------------
-- `WITH CHECK (true)` lets ANY caller holding the public anon key insert ANY
-- row into public.profiles — including an arbitrary `id` and `role = 'ADMIN'`.
-- It is kept here because it is what the spec asked for, and because a
-- client-side signup insert cannot work without it.
--
-- The trigger in section 4 makes that client-side insert unnecessary, so you
-- can close the hole by running the HARDENING block in section 5.
-- ---------------------------------------------------------------------------
CREATE POLICY "Allow public signup profile insertion"
ON public.profiles FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow users to view own profile"
ON public.profiles FOR SELECT USING (auth.uid() = id);

-- Not in the original spec, but without it a signed-in user cannot correct
-- their own name or department.
CREATE POLICY "Allow users to update own profile"
ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- 4. Auto-create a profile whenever an auth user is created
--
-- SECURITY DEFINER means this runs as the function owner and bypasses RLS, so
-- signup works without granting the anon role write access. Values come from
-- the `options.data` payload the login page sends to supabase.auth.signUp().
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, department, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'department', 'Operations'),
    NEW.raw_user_meta_data ->> 'full_name',
    COALESCE(NEW.raw_user_meta_data ->> 'role', 'USER')
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 5. Backfill profiles for users who already exist
--
-- The trigger above only fires on NEW auth.users rows. Anyone who signed up
-- before this migration ran (or before the profiles table was dropped) would
-- otherwise be left with an account that has no profile, and the dashboard
-- would hang on "Loading your profile…".
-- ---------------------------------------------------------------------------
INSERT INTO public.profiles (id, email, department, full_name, role)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data ->> 'department', 'Operations'),
  COALESCE(u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1)),
  COALESCE(u.raw_user_meta_data ->> 'role', 'USER')
FROM auth.users u
WHERE u.email IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. HARDENING (optional — recommended before any real deployment)
--
-- Uncomment to replace the permissive insert policy with one that only lets a
-- signed-in user create their OWN profile row. Safe to apply because the
-- trigger above already creates profiles during signup.
-- ---------------------------------------------------------------------------
-- DROP POLICY IF EXISTS "Allow public signup profile insertion" ON public.profiles;
-- CREATE POLICY "Users may insert only their own profile"
-- ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
