# 🚀 RailPrioritize - Database & Login Setup Guide

## What Was Done ✅

### 1. **Database Setup Files Created**
- ✅ `database/seed.sql` - Complete SQL schema and sample data
- ✅ `database/seed.js` - Node.js seed script (run after tables exist)
- ✅ `DATABASE_SETUP.md` - Comprehensive database documentation
- ✅ `QUICK_SETUP.md` - Quick setup instructions

### 2. **Login Fallback Implemented**
- ✅ Updated `components/rail-prioritize-dashboard.tsx` with fallback employees
- ✅ 4 demo users available without Supabase (but with limited features):
  - **EMP-1042** - Rajesh Kumar Singh (Central Planner) ⭐
  - EMP-2051 - Priya Sharma (Operations Manager)
  - EMP-3047 - Amit Patel (Crew Lead)
  - EMP-4038 - Neha Verma (Field Supervisor)

### 3. **Build Verified**
- ✅ No TypeScript errors
- ✅ All routes properly configured
- ✅ `/api/reoptimize` endpoint recognized

---

## 🎯 Get Started in 3 Steps

### Step 1️⃣: Quick Test WITHOUT Database
**Just want to see the UI?** Log in immediately:

1. Ensure dev server is running: `npm run dev`
2. Open http://localhost:3000
3. Enter: `EMP-1042`
4. Click "Enter workspace"

✅ You'll see:
- Dashboard overview
- Failures and tasks
- Sample data (from fallback)

❌ Limited without database:
- Re-optimize Schedule button won't save to database
- No real scheduling engine operation

---

### Step 2️⃣: Set Up Real Database (Recommended)

#### Option A: Supabase SQL Editor (2 minutes)

1. Go to: https://supabase.com/dashboard
2. Click **SQL Editor** → **New Query**
3. Copy contents of `database/seed.sql`
4. Paste into editor
5. Click **Run**
6. See ✅ "Query executed successfully"

#### Option B: psql CLI (if you have PostgreSQL)

```bash
psql "postgresql://[user]:[password]@[host]:[port]/[database]" < database/seed.sql
```

---

### Step 3️⃣: Seed Sample Data

Once tables exist in Supabase:

```bash
node database/seed.js
```

Expected output:
```
🌱 Starting RailPrioritize database seed...

📝 Seeding employees...
  ✓ EMP-1042 - Rajesh Kumar Singh
  ✓ EMP-2051 - Priya Sharma
  ✓ EMP-3047 - Amit Patel
  ✓ EMP-4038 - Neha Verma
  ✓ EMP-5029 - Vikram Desai
  ✓ EMP-6015 - Anjali Nair

📋 Seeding failures...
  ✓ 6 failures with risk scores
  ✓ Failures seeded

✅ Seeding tasks...
  ✓ 6 pending tasks ready for scheduling

🛤️ Seeding corridor availability...
  ✓ Seeded 56 corridor availability records

✨ Database seed completed successfully!

🚀 You can now log in with: EMP-1042
```

---

## 📊 Database Schema

### 6 Tables Created:

| Table | Purpose | Records |
|-------|---------|---------|
| **employees** | User accounts & roles | 6 (EMP-1042, etc.) |
| **failures** | Rail network failures | 6 (F-24081, etc.) |
| **tasks** | Maintenance tasks | 6 (TSK-8841, etc.) |
| **corridor_availability** | Maintenance windows | 56 (14 days × 4 sections) |
| **audit_events** | Activity logs | 6 |
| **schedule_windows** | Scheduled maintenance | 4 |

### Key Table Fields:

**tasks** (for scheduling engine):
- `task_code`: Unique ID
- `status`: 'Pending' → 'Scheduled' or 'Conflict'
- `priority_score`: 0-100 (higher = more urgent)
- `section_id`: 'SECN-001', 'SECN-002', etc.
- `est_duration_hrs`: Hours needed
- `assigned_date`: Scheduled date (filled by re-optimizer)

**corridor_availability** (availability windows):
- `section_id`: Matching task's section
- `date`: Specific date
- `remaining_hrs`: Hours available on that date
- Gets updated when tasks are scheduled

---

## 🎮 Test the Re-optimize Feature

### Prerequisites:
1. ✅ Database tables created (Step 2)
2. ✅ Sample data seeded (Step 3)
3. ✅ Logged in as EMP-1042 (Central Planner role)

### Steps:
1. Click **Schedule** in sidebar
2. Look for **"Re-optimize Schedule"** button (Navy blue #003C71)
3. Click it
4. Watch as the system:
   - Fetches all Pending tasks
   - Checks 14-day corridor availability
   - Assigns each task to first available date
   - Deducts hours from corridor availability
   - Updates task status to 'Scheduled' or 'Conflict'
5. See alert: "X tasks scheduled, Y conflicts detected"

### Expected Results:
- Tasks get assigned to dates with enough availability
- Corridor hours decrease
- Task status changes from 'Pending' to 'Scheduled' or 'Conflict'
- Schedule grid updates live

---

## 🐛 Troubleshooting

### "Employee ID not found"
**Solution**: The fallback should work anyway. If not:
```
✅ Use: EMP-1042, EMP-2051, EMP-3047, or EMP-4038
✅ Check .env.local has Supabase credentials
✅ Restart dev server: npm run dev
```

### "Could not find table" (seed.js error)
**Solution**: Tables must be created first via SQL Editor:
```
1. Go to Supabase Dashboard → SQL Editor
2. Copy database/seed.sql
3. Paste and Run
4. Then: node database/seed.js
```

### Re-optimize button not visible
**Ensure**:
```
✅ Logged in as EMP-1042 or another Central Planner
✅ You're on the "Schedule" view
✅ Database is seeded (sample tasks exist)
```

### Re-optimize runs but nothing changes
**Check**:
```
✅ Tasks have 'Pending' status
✅ corridor_availability table has data
✅ Check browser console for errors (F12)
✅ Verify .env.local has correct Supabase keys
```

---

## 📝 Files Summary

| File | Purpose |
|------|---------|
| `database/seed.sql` | SQL to create all tables & data |
| `database/seed.js` | Node.js script to seed data |
| `DATABASE_SETUP.md` | Full database documentation |
| `QUICK_SETUP.md` | Quick start guide |
| `app/api/reoptimize/route.ts` | Scheduling engine API |
| `lib/actions/reoptimize.ts` | Server action for re-optimize |
| `components/rail-prioritize-dashboard.tsx` | UI with fallback login & Re-optimize button |
| `app/globals.css` | Updated styling with Navy header (#003C71) |

---

## ✨ Features Now Available

### ✅ Automated Scheduling Engine
- Fetches Pending tasks sorted by priority
- Checks corridor availability for 14 days
- Assigns tasks to first available slot
- Updates task status & corridor hours
- Returns success/conflict statistics

### ✅ Re-optimize Button
- Visible only to Central Planner role
- Shows loading state with spinner
- Displays success/error alert
- Refreshes schedule grid live
- Government of India styling (Navy #003C71)

### ✅ Fallback Login
- Works WITHOUT database
- 4 demo employees pre-configured
- Full UI available for testing
- Graceful degradation for re-optimize

### ✅ Sample Data
- 6 diverse employees across all regions
- 6 failures with varying severity
- 6 ready-to-schedule tasks
- 14 days of corridor availability
- Complete audit trail

---

## 🚀 Next Steps

1. **Immediate**: Log in with `EMP-1042` (no database needed)
2. **Optional**: Execute `database/seed.sql` in Supabase SQL Editor
3. **Optional**: Run `node database/seed.js` to populate data
4. **Test**: Use "Re-optimize Schedule" to see the engine in action
5. **Verify**: Check Supabase dashboard to see updated task statuses

---

## 📞 Support Reference

**Dev Server**: `npm run dev` → http://localhost:3000

**Default Credential**: `EMP-1042` (Central Planner)

**Database Setup**: See `QUICK_SETUP.md` or `DATABASE_SETUP.md`

**API Documentation**: See `app/api/reoptimize/route.ts`

---

**Status**: ✅ Ready to use! Start with Step 1 above.
