# RailPrioritize Database Setup Guide

This guide will help you set up the database and seed it with sample data.

## Quick Start

### Option 1: Node.js Seed Script (Recommended)

```bash
# Install dotenv if needed
npm install dotenv --save-dev

# Run the seed script
node database/seed.js
```

The script will:
- ✅ Connect to your Supabase instance
- ✅ Create all 6 tables (employees, failures, tasks, corridor_availability, audit_events, schedule_windows)
- ✅ Seed with 56+ sample records
- ✅ Set up EMP-1042 as Central Planner

**Output Example:**
```
🌱 Starting RailPrioritize database seed...

📝 Seeding employees...
  ✓ EMP-1042 - Rajesh Kumar Singh
  ✓ EMP-2051 - Priya Sharma
  ✓ EMP-3047 - Amit Patel
  ✓ EMP-4038 - Neha Verma
  ✓ EMP-5029 - Vikram Desai
  ✓ EMP-6015 - Anjali Nair

✨ Database seed completed successfully!

🚀 You can now log in with: EMP-1042
```

### Option 2: Manual SQL Execution (Supabase Dashboard)

1. Go to [Supabase Dashboard](https://supabase.com)
2. Select your project
3. Click **SQL Editor** in the left sidebar
4. Click **New Query**
5. Copy the entire contents of `database/seed.sql`
6. Paste into the SQL editor
7. Click **Run** (or press `Ctrl+Enter`)

### Option 3: Using psql (PostgreSQL CLI)

```bash
# If you have PostgreSQL installed
psql "postgresql://[user]:[password]@[host]:[port]/[database]" < database/seed.sql
```

Get connection details from Supabase Dashboard → Settings → Database → Connection String

---

## Database Schema

### 1. **employees** table
Stores user information with roles and regions.

| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL | Primary key |
| employee_id | TEXT | Unique (e.g., EMP-1042) |
| full_name | TEXT | User's full name |
| role | TEXT | Central Planner, Operations Manager, Crew Lead, Field Supervisor |
| region | TEXT | Northern, Eastern, Southern, Western |
| initials | TEXT | For avatar display |

**Sample Data:**
- **EMP-1042**: Rajesh Kumar Singh (Central Planner) - Can access re-optimize feature
- EMP-2051: Priya Sharma (Operations Manager)
- EMP-3047: Amit Patel (Crew Lead)
- EMP-4038: Neha Verma (Field Supervisor)

### 2. **failures** table
Incident and failure records from rail network monitoring.

| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL | Primary key |
| failure_code | TEXT | Unique (e.g., F-24081) |
| category | TEXT | Track geometry, Signalling, Electrical, Brake system, etc. |
| description | TEXT | Detailed description |
| severity | TEXT | Critical, High, Medium, Low |
| status | TEXT | Open, Investigating, Resolved |
| risk_score | NUMERIC | 0-100 (used for prioritization) |
| region | TEXT | Geographic region |
| detected_at | TIMESTAMP | When the failure was detected |

**Sample Data:** 6 failures ranging from Critical to Low severity

### 3. **tasks** table
Maintenance tasks generated from failures, with scheduling data.

| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL | Primary key |
| task_code | TEXT | Unique (e.g., TSK-8841) |
| title | TEXT | Task title |
| description | TEXT | Detailed description |
| status | TEXT | Pending, Scheduled, Conflict, Completed |
| priority_score | NUMERIC | 0-100 (inherited from failure) |
| section_id | TEXT | Corridor section (SECN-001, SECN-002, etc.) |
| est_duration_hrs | NUMERIC | Estimated duration in hours |
| assigned_date | DATE | Date assigned by scheduler |
| due_date | TIMESTAMP | Due date |
| region | TEXT | Geographic region |
| created_at | TIMESTAMP | Record creation time |
| updated_at | TIMESTAMP | Last update time |

**Sample Data:** 6 pending tasks ready for automated scheduling

### 4. **corridor_availability** table
Maintenance window availability for each corridor section.

| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL | Primary key |
| section_id | TEXT | Corridor section identifier |
| date | DATE | Date of availability |
| remaining_hrs | NUMERIC | Available hours remaining |
| available_block_hrs | NUMERIC | Continuous block available |
| total_hrs | NUMERIC | Total hours in the day |
| created_at | TIMESTAMP | Record creation time |
| updated_at | TIMESTAMP | Last update time |

**Sample Data:** 14 days of availability for 4 sections (56 total records)

### 5. **audit_events** table
System audit trail for compliance and monitoring.

| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL | Primary key |
| event_type | TEXT | LOGIN, TASK_CREATED, STATUS_UPDATE, SCHEDULE_UPDATED, etc. |
| description | TEXT | Event details |
| actor_name | TEXT | Who performed the action |
| region | TEXT | Affected region(s) |
| created_at | TIMESTAMP | When the event occurred |

**Sample Data:** 6 sample audit events

### 6. **schedule_windows** table
Planned maintenance windows and their confirmation status.

| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL | Primary key |
| section_id | TEXT | Corridor section |
| window_date | DATE | Date of maintenance window |
| start_time | TIME | Start time |
| end_time | TIME | End time |
| maintenance_window_name | TEXT | Descriptive name |
| status | TEXT | Pending, Confirmed, Cancelled |
| created_at | TIMESTAMP | Record creation time |
| updated_at | TIMESTAMP | Last update time |

**Sample Data:** 4 maintenance windows scheduled over next 14 days

---

## Testing the Setup

### 1. Verify All Tables Created

In Supabase SQL Editor, run:
```sql
SELECT tablename FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;
```

Should show:
- ✅ audit_events
- ✅ corridor_availability
- ✅ employees
- ✅ failures
- ✅ schedule_windows
- ✅ tasks

### 2. Verify EMP-1042 Login

```sql
SELECT * FROM employees WHERE employee_id = 'EMP-1042';
```

Should return:
```
employee_id | full_name             | role            | region     | initials
-----------+----------------------+---------------+----------+----------
EMP-1042   | Rajesh Kumar Singh   | Central Planner | Northern | RKS
```

### 3. Verify Pending Tasks

```sql
SELECT task_code, title, status, priority_score 
FROM tasks 
WHERE status = 'Pending'
ORDER BY priority_score DESC;
```

Should show 6 pending tasks ready for scheduling.

### 4. Verify Corridor Availability

```sql
SELECT section_id, date, remaining_hrs 
FROM corridor_availability 
WHERE date >= CURRENT_DATE
ORDER BY section_id, date
LIMIT 15;
```

Should show 14 days of data for each section.

---

## Re-optimize Schedule Feature

Once data is seeded, you can test the automated scheduling engine:

1. **Log in** with EMP-1042
2. Navigate to **Schedule** view
3. Click **"Re-optimize Schedule"** button (Navy #003C71 button)
4. Watch as the system:
   - Fetches all Pending tasks (ordered by priority)
   - Checks corridor availability for 14 days
   - Assigns tasks to available dates
   - Updates task status to 'Scheduled' or 'Conflict'
   - Deducts hours from corridor availability

**Result Alert shows:**
- ✅ "X tasks scheduled, Y conflicts detected"
- Date assignments visible in schedule grid
- Updated corridor availability

---

## Troubleshooting

### "Employee ID not found"
- Ensure you seeded the database with `node database/seed.js`
- Fallback demo users available: EMP-1042, EMP-2051, EMP-3047, EMP-4038
- Check `.env.local` has correct Supabase credentials

### "Corridor availability not found"
- Verify `corridor_availability` table exists
- Check that today's date + 14 days have records
- Run: `SELECT COUNT(*) FROM corridor_availability;` (should show 56+)

### Seed script fails
- Verify `.env.local` exists with:
  ```
  NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
  ```
- Check internet connection to Supabase
- Try manual SQL execution via Supabase dashboard

### Re-optimize button doesn't appear
- Ensure logged-in user has role: "Central Planner"
- Check browser console for errors
- Verify API route `/api/reoptimize` is accessible

---

## Production Checklist

- [ ] Row Level Security (RLS) enabled on all tables
- [ ] Service role key used for sensitive operations
- [ ] Database backups configured
- [ ] Query performance indexed (indexes included in seed.sql)
- [ ] Audit trail in place (audit_events table)
- [ ] Role-based access control implemented
- [ ] Sensitive data encrypted at rest

---

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review Supabase logs in the dashboard
3. Verify all 6 tables exist with expected columns
4. Check that .env.local credentials are correct
