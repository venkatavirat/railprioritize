# RailPrioritize - Full Verification & Testing Guide

## ✅ Refactoring Complete

The `components/rail-prioritize-dashboard-new.tsx` component has been **fully refactored** with:
- ✅ Real Supabase data integration
- ✅ Dynamic filtering by region/division  
- ✅ Auth context integration
- ✅ Drag-drop task status updates
- ✅ One-click task creation
- ✅ Production-ready error handling

---

## Part 1: Pre-Flight Checks

### 1.1 Verify Build Success ✓
```bash
npm run build
```

**Expected Output**:
```
✓ Compiled successfully
✓ Generating static pages
✓ Finalizing page optimization
```

**Status**: ✅ **PASS** (Already verified)

---

### 1.2 Verify No TypeScript Errors ✓
**Expected**: 0 errors in `components/rail-prioritize-dashboard-new.tsx`

**Status**: ✅ **PASS** (Verified with get_errors tool)

---

### 1.3 Check Database Connection
Supabase credentials must be in `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-key
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

**Status**: ✅ **Should be configured** (From previous setup)

---

## Part 2: Manual Feature Testing

### Test 1: Authentication & Filter Defaults

**Steps**:
1. Clear browser cache (Ctrl+Shift+Delete)
2. Run: `npm run dev`
3. Navigate to `http://localhost:3000`
4. If logged in, logout first (click profile avatar → Logout)
5. Login with: `EMP-1042` / any password

**Expected Results**:
- ✓ Dashboard loads
- ✓ Header shows: "CENTRAL CONTROL ROOM • NORTHERN • DELHI"
- ✓ Region dropdown value: "Northern"
- ✓ Division dropdown value: "Delhi"
- ✓ Sidebar shows: "Rajesh Kumar Singh" + "Central Planner"

**Verification**:
```
PASS ✅ if all checks above match
FAIL ❌ if any dropdown is "All regions" or "All divisions"
```

---

### Test 2: Dynamic Failure Fetching

**Steps**:
1. On Overview tab
2. Look at "Priority queue" panel (left side)
3. Note the failures shown (should match Northern/Delhi)
4. Click Region dropdown → Select "Eastern"
5. **Observe**: Queue should update to show Eastern failures
6. Click Division dropdown → Select "Howrah"
7. **Observe**: Queue should further filter to Howrah

**Expected Results**:
- ✓ Failures list updates immediately on filter change
- ✓ Cards with Southern/Western region disappear
- ✓ Cards with non-Howrah division disappear
- ✓ Eyebrow header updates: "CENTRAL CONTROL ROOM • EASTERN • HOWRAH"

**Verification Code** (in browser console):
```javascript
// Check if failures are from correct region
const failures = document.querySelectorAll('.queue-row')
failures.forEach(f => console.log(f.textContent))
```

**Verification**:
```
PASS ✅ if failures match selected region/division
FAIL ❌ if failures don't change when filter changes
```

---

### Test 3: Dynamic Task Fetching

**Steps**:
1. Click "Task board" tab
2. Check tasks in columns
3. Note task regions/divisions
4. Change Region to "Southern"
5. **Observe**: Task board updates to show only Southern tasks
6. Change Division to "Chennai"
7. **Observe**: Further filtered to Chennai

**Expected Results**:
- ✓ Task cards appear/disappear as filters change
- ✓ Column counts update
- ✓ Only tasks matching filters are visible

**Verification**:
```
PASS ✅ if tasks filter correctly on region/division change
FAIL ❌ if task board doesn't update on filter change
```

---

### Test 4: Create Task from Failure

**Steps**:
1. Go to Overview tab
2. Look at Priority queue
3. Click on first failure card (e.g., "F-24081")
4. **Drawer opens** on right side
5. Review failure details (code, category, risk score)
6. Click **"Create maintenance task"** button
7. **Observe**:
   - Button shows loading spinner
   - Success message appears: "✓ Maintenance task created successfully!"
   - After 500ms: Auto-switch to Task board tab
   - New task visible in "Unassigned" column

**Expected Task Details**:
- Title: "Repair: [Failure Description]"
- Status: "Unassigned" (first column)
- Priority badge: P1 (if severity was Critical) or P2/P3
- Region: Matches selected filter
- Division: Matches selected filter
- Due date: Tomorrow's date

**Verification**:
```
PASS ✅ if task appears in Unassigned column after creation
FAIL ❌ if task doesn't appear or error message shows
```

---

### Test 5: Drag-Drop Task Status Update

**Steps**:
1. On Task board tab
2. Find a task in "Unassigned" column
3. **Drag** the task card
4. **Drop** into "Assigned" column
5. **Observe**:
   - Card moves immediately to Assigned
   - Card becomes draggable in new column
   - Visual feedback (border highlight while dragging)

**Verification in Supabase Dashboard**:
1. Go to Supabase Dashboard
2. Select `railprioritize` project
3. Go to SQL Editor
4. Run query:
   ```sql
   SELECT id, task_code, title, status FROM tasks 
   WHERE status = 'Assigned' 
   LIMIT 5;
   ```
5. Should see the task you just dragged

**Verification**:
```
PASS ✅ if task status changes in Supabase after drag-drop
FAIL ❌ if task status doesn't update in Supabase
```

---

### Test 6: Fallback Data (No Supabase)

**Steps**:
1. Modify `.env.local` - Make Supabase URL invalid temporarily
2. Refresh page (F5)
3. **Observe**:
   - Dashboard still loads
   - Data appears (from fallback arrays)
   - UI doesn't crash
4. Fix `.env.local` and refresh again
5. Real data should now appear

**Verification**:
```
PASS ✅ if app doesn't crash even with invalid DB connection
FAIL ❌ if app shows blank screen or error
```

---

### Test 7: Header Display & Eyebrow Update

**Steps**:
1. Note logged-in employee name (top left sidebar)
2. Check eyebrow in header
3. Verify format: "CENTRAL CONTROL ROOM • REGION"
4. Change Region filter
5. **Observe**: Eyebrow updates immediately

**Expected Eyebrow States**:
- "CENTRAL CONTROL ROOM • NORTHERN" (when All divisions)
- "CENTRAL CONTROL ROOM • NORTHERN • DELHI" (when division selected)
- "CENTRAL CONTROL ROOM • EASTERN" (when region changed)

**Verification**:
```
PASS ✅ if eyebrow updates on filter changes
FAIL ❌ if eyebrow always shows "NORTHERN" regardless of selection
```

---

## Part 3: Code-Level Verification

### Check 1: useCallback on loadData

**File**: `components/rail-prioritize-dashboard-new.tsx`

**Search for**:
```typescript
const loadData = useCallback(
  async (region: string, division: string) => {
```

**Verification**:
```
PASS ✅ if loadData is wrapped with useCallback
FAIL ❌ if loadData is a regular async function
```

---

### Check 2: Auth Context Integration

**Search for**:
```typescript
const { user, employee, signOut, loading: authLoading } = useAuth()
```

**And**:
```typescript
useEffect(() => {
  if (employee) {
    setSelectedRegion(employee.region || 'All regions')
    setSelectedDivision(employee.division || 'All divisions')
  }
}, [employee])
```

**Verification**:
```
PASS ✅ if both code blocks are present
FAIL ❌ if useAuth() is not used or filters not initialized
```

---

### Check 3: Supabase Filter Queries

**Search for**:
```typescript
if (region !== 'All regions') {
  failureQuery = failureQuery.eq('region', region)
}
if (division !== 'All divisions') {
  failureQuery = failureQuery.eq('division', division)
}
```

**Verification**:
```
PASS ✅ if filters applied in loadData
FAIL ❌ if queries don't include .eq() filters
```

---

### Check 4: TaskBoard Drag-Drop

**Search for**:
```typescript
const handleDragStart = (task: Task) => {
  setDraggedTask(task)
}

const handleDrop = async (columnName: string) => {
  if (!draggedTask || draggedTask.status === columnName) {
    setDraggedTask(null)
    return
  }

  if (onTaskStatusChange && draggedTask.id) {
    await onTaskStatusChange(draggedTask.id, columnName)
  }

  setDraggedTask(null)
}
```

**Verification**:
```
PASS ✅ if both functions exist
FAIL ❌ if TaskBoard doesn't have drag-drop handlers
```

---

### Check 5: FailureDrawer Task Creation

**Search for**:
```typescript
const handleCreateTask = async () => {
  setIsCreatingTask(true)
  setCreationError(null)
  setCreationSuccess(false)

  try {
    const supabase = getSupabaseBrowserClient()
    const { data, error } = await supabase
      .from('tasks')
      .insert([...])
```

**Verification**:
```
PASS ✅ if handleCreateTask function exists
FAIL ❌ if FailureDrawer only shows failure details without creation
```

---

### Check 6: UpdateTaskStatus Function

**Search for**:
```typescript
async function updateTaskStatus(taskId: string | number, newStatus: string) {
  try {
    const supabase = getSupabaseBrowserClient()
    const { error } = await supabase
      .from('tasks')
      .update({ status: newStatus })
      .eq('id', taskId)
```

**Verification**:
```
PASS ✅ if updateTaskStatus function exists
FAIL ❌ if Kanban status updates not implemented
```

---

## Part 4: Performance Checks

### Check 1: Initial Load Time
**Measure**:
1. Open DevTools → Performance tab
2. Refresh page (F5)
3. Record until page fully loads
4. Check: Look for "Compiled successfully" message

**Target**: < 3 seconds for development, < 1 second for production

---

### Check 2: Filter Change Response
**Measure**:
1. Open DevTools → Performance tab
2. Click Region dropdown
3. Select "Eastern"
4. Record time until UI updates

**Target**: < 500ms for data refresh and UI update

---

### Check 3: Drag-Drop Performance
**Measure**:
1. Open DevTools → Performance tab
2. Drag a task card to another column
3. Record performance

**Target**: Instant visual feedback (< 100ms), Supabase update happens in background

---

## Part 5: Error Scenario Testing

### Scenario 1: Network Error During Task Creation

**Simulate**:
1. Open Task board
2. Click failure to open drawer
3. Open DevTools → Network tab
4. Toggle "Offline" mode
5. Click "Create maintenance task"

**Expected**:
- ✓ Loading spinner appears
- ✓ After timeout: Error message shown
- ✓ Can retry without page reload

**Verification**:
```
PASS ✅ if error handled gracefully
FAIL ❌ if page crashes or no error message
```

---

### Scenario 2: Invalid Filter Selection

**Simulate**:
1. Manually modify Region filter to non-existent value
2. Observe dashboard behavior

**Expected**:
- ✓ Shows fallback data or no data (doesn't crash)
- ✓ Filter dropdown reverts to valid option
- ✓ No console errors

---

## Part 6: Browser Compatibility

### Test in Multiple Browsers:

| Browser | Drag-Drop | Supabase | Status |
|---------|-----------|----------|--------|
| Chrome | ✓ | ✓ | Should work |
| Firefox | ✓ | ✓ | Should work |
| Safari | ✓ | ✓ | Should work |
| Edge | ✓ | ✓ | Should work |

**Known Issues**:
- IE11: Not supported (modern app)
- Some mobile browsers: Drag-drop may not work (use click instead)

---

## Part 7: Database Integration Checks

### Check 1: Employees Table
```sql
SELECT employee_id, full_name, role, region, division 
FROM employees 
WHERE employee_id = 'EMP-1042';
```

**Expected**: 1 row with Rajesh Kumar Singh, Central Planner, Northern, Delhi

---

### Check 2: Failures Table
```sql
SELECT failure_code, severity, risk_score, region, division 
FROM failures 
WHERE region = 'Northern' 
ORDER BY risk_score DESC;
```

**Expected**: At least 1 Critical/High failure with risk_score >= 80

---

### Check 3: Tasks Table
```sql
SELECT task_code, title, status, priority_score, region, division 
FROM tasks 
WHERE region = 'Northern';
```

**Expected**: Tasks appear with Unassigned/Assigned/Scheduled statuses

---

### Check 4: Verify Task Creation Insert
1. Create a task via UI (follow Test 4)
2. Run query:
```sql
SELECT * FROM tasks 
WHERE title LIKE 'Repair:%' 
ORDER BY created_at DESC 
LIMIT 1;
```

**Expected**: New row with all fields populated

---

### Check 5: Verify Task Status Update
1. Drag a task to new column (follow Test 5)
2. Run query:
```sql
SELECT id, task_code, status, updated_at 
FROM tasks 
WHERE status = 'Assigned' 
ORDER BY updated_at DESC 
LIMIT 1;
```

**Expected**: `updated_at` timestamp should be recent (< 1 minute ago)

---

## Part 8: Summary Checklist

### Feature Completeness
- [ ] Auth context displays user profile
- [ ] Region/division filters default to employee profile
- [ ] Failures fetch dynamically with filters
- [ ] Tasks fetch dynamically with filters
- [ ] Audit events display in Overview
- [ ] All views update when filters change
- [ ] Can create task from failure
- [ ] Can drag-drop tasks between columns
- [ ] Status updates persist in Supabase
- [ ] Fallback data works if DB unreachable

### Code Quality
- [ ] No TypeScript errors
- [ ] No runtime console errors
- [ ] Build succeeds with no warnings
- [ ] useCallback prevents unnecessary re-renders
- [ ] Error handling in all async operations
- [ ] Proper state management with useState

### Performance
- [ ] Initial load: < 3 seconds (dev), < 1 second (prod)
- [ ] Filter change response: < 500ms
- [ ] Drag-drop visual feedback: < 100ms
- [ ] No memory leaks on page refresh

### UX/UX
- [ ] Clear loading states (spinners, skeleton loaders)
- [ ] Clear error messages with actionable info
- [ ] Success feedback (checkmarks, confirmation)
- [ ] Cursor changes indicate draggable items
- [ ] Mobile responsive (sidebar collapses)

### Database
- [ ] Employees table has test data
- [ ] Failures table has test data (6+ records)
- [ ] Tasks table has test data (6+ records)
- [ ] Audit events table has test data
- [ ] Task creation inserts correct fields
- [ ] Task updates save to `updated_at` field

---

## Final Verification Script

Run this in browser console to check all systems:
```javascript
// Check auth context
console.log('Employee:', window.__auth?.employee)

// Check Supabase
console.log('Supabase connected:', !!window.__supabase)

// Check component state
console.log('All systems:', {
  hasEmployee: !!window.__auth?.employee,
  hasSupabase: !!window.__supabase,
  isDevelopment: !window.__PRODUCTION__,
})
```

---

## Troubleshooting Matrix

| Symptom | Possible Cause | Solution |
|---------|----------------|----------|
| Filters always show "All regions" | Employee data not loaded | Logout → Login again |
| Tasks don't update on filter change | useEffect not triggering | Check browser console for errors |
| Drag-drop doesn't work | Browser doesn't support HTML5 | Try different browser |
| Task creation fails | Supabase connection issue | Check .env.local config |
| No data showing | Fallback triggered | Verify Supabase data exists |
| Build fails | TypeScript error | Run `npm run build` for details |

---

## Success Criteria

✅ **PASS** all of the following:
1. No build errors
2. No TypeScript errors
3. Dashboard loads and displays user profile
4. Filters default to employee region/division
5. Data updates when filters change
6. Can create task from failure (appears in Unassigned)
7. Can drag task to new column (status updates in Supabase)
8. Browser console has no errors
9. Page loads in < 3 seconds

---

## Deployment Checklist

Before deploying to production:
- [ ] All tests pass
- [ ] No console errors
- [ ] Verified with test data
- [ ] Database backups created
- [ ] Environment variables configured
- [ ] Performance acceptable
- [ ] Mobile-responsive tested
- [ ] Error scenarios tested
- [ ] Team sign-off obtained

---

## Support

For issues:
1. Check browser console (F12 → Console)
2. Check Supabase Dashboard for data
3. Verify `.env.local` configuration
4. Check network tab for failed requests
5. Review error logs in Supabase

---

**Status**: 🚀 **Ready for Testing**
