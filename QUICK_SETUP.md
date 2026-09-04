# Quick Database Setup

The database tables need to be created before seeding. Here's how:

## Step 1: Create Tables in Supabase

1. Go to your Supabase project: https://supabase.com/dashboard
2. Click **SQL Editor** in the left sidebar
3. Click **New Query**
4. Copy everything below and paste into the editor:

```sql
-- Create all tables for RailPrioritize
CREATE TABLE IF NOT EXISTS employees (
  id BIGSERIAL PRIMARY KEY,
  employee_id TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL,
  region TEXT NOT NULL,
  initials TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS failures (
  id BIGSERIAL PRIMARY KEY,
  failure_code TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  risk_score NUMERIC NOT NULL,
  region TEXT NOT NULL,
  detected_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id BIGSERIAL PRIMARY KEY,
  task_code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'Pending',
  priority_score NUMERIC NOT NULL,
  section_id TEXT NOT NULL,
  est_duration_hrs NUMERIC NOT NULL,
  assigned_date DATE,
  due_date TIMESTAMP WITH TIME ZONE,
  region TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS corridor_availability (
  id BIGSERIAL PRIMARY KEY,
  section_id TEXT NOT NULL,
  date DATE NOT NULL,
  remaining_hrs NUMERIC NOT NULL,
  available_block_hrs NUMERIC,
  total_hrs NUMERIC,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(section_id, date)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  description TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  region TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS schedule_windows (
  id BIGSERIAL PRIMARY KEY,
  section_id TEXT NOT NULL,
  window_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  maintenance_window_name TEXT,
  status TEXT DEFAULT 'Pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_section ON tasks(section_id);
CREATE INDEX IF NOT EXISTS idx_corridor_section_date ON corridor_availability(section_id, date);
CREATE INDEX IF NOT EXISTS idx_failures_risk ON failures(risk_score DESC);
```

5. Click **Run** (or press Cmd+Enter / Ctrl+Enter)
6. You should see ✅ "Query executed successfully"

## Step 2: Seed the Data

Once tables are created, run:

```bash
node database/seed.js
```

This will populate all tables with sample data including:
- ✅ 6 employees (EMP-1042 as Central Planner)
- ✅ 6 failures
- ✅ 6 pending tasks ready for scheduling
- ✅ 56 corridor availability records (14 days × 4 sections)
- ✅ 6 audit events
- ✅ 4 schedule windows

## Step 3: Test Login

1. Start the dev server if not running: `npm run dev`
2. Open http://localhost:3000
3. Enter: **EMP-1042**
4. Click "Enter workspace"

You should now see the dashboard with access to the **Schedule** view and **Re-optimize Schedule** button!

---

## Alternative: Use Fallback Demo Mode

If you want to test WITHOUT creating the database, the app has built-in fallback employees:

Just log in with any of these:
- **EMP-1042** (Central Planner) - Full access
- **EMP-2051** (Operations Manager)
- **EMP-3047** (Crew Lead)  
- **EMP-4038** (Field Supervisor)

You'll see sample failures and tasks, but the Re-optimize feature will only work if the database is seeded.
