#!/usr/bin/env node

/**
 * RailPrioritize Database Seed Script
 * Usage: node database/seed.js
 * 
 * This script connects to Supabase and seeds the database with sample data.
 * Requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local
 */

const { createClient } = require('@supabase/supabase-js');

// Load environment variables from .env.local
const fs = require('fs');
const path = require('path');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
} catch (e) {
  // dotenv not installed, but env vars might already be loaded
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Error: SUPABASE_URL and SUPABASE_KEY not found in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function createTables() {
  console.log('📋 Creating database tables...\n');
  
  try {
    // Check if tables exist and create if needed
    const { error: checkError } = await supabase
      .from('employees')
      .select('count', { count: 'exact' })
      .limit(1);
    
    if (checkError?.code === 'PGRST116') {
      // Table doesn't exist, create it
      console.log('Creating employees table...');
      // Note: Supabase client doesn't support DDL directly
      // User must create tables manually or via SQL editor
      console.log('⚠️  Tables must be created manually via Supabase SQL Editor');
      console.log('📖 Copy the contents of database/seed.sql and execute in Supabase Dashboard');
      console.log('   → SQL Editor → New Query → Paste → Run\n');
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Error checking tables:', error.message);
    return false;
  }
}

async function seedDatabase() {
  console.log('🌱 Starting RailPrioritize database seed...\n');

  try {
    // Check if tables exist
    const tablesExist = await createTables();
    if (!tablesExist) {
      console.error('\n❌ Error: Tables do not exist in Supabase');
      console.error('\nTo fix this, execute the SQL seed script:');
      console.error('1. Go to: https://supabase.com/dashboard/project/[your-project-id]/sql/new');
      console.error('2. Copy contents of database/seed.sql');
      console.error('3. Paste into SQL editor and click Run');
      console.error('\nThen run this script again: node database/seed.js\n');
      process.exit(1);
    }

    // 1. Seed Employees
    console.log('📝 Seeding employees...');
    const employees = [
      { employee_id: 'EMP-1042', full_name: 'Rajesh Kumar Singh', role: 'Central Planner', region: 'Northern', initials: 'RKS' },
      { employee_id: 'EMP-2051', full_name: 'Priya Sharma', role: 'Operations Manager', region: 'Eastern', initials: 'PS' },
      { employee_id: 'EMP-3047', full_name: 'Amit Patel', role: 'Crew Lead', region: 'Southern', initials: 'AP' },
      { employee_id: 'EMP-4038', full_name: 'Neha Verma', role: 'Field Supervisor', region: 'Western', initials: 'NV' },
      { employee_id: 'EMP-5029', full_name: 'Vikram Desai', role: 'Central Planner', region: 'Northern', initials: 'VD' },
      { employee_id: 'EMP-6015', full_name: 'Anjali Nair', role: 'Operations Manager', region: 'Southern', initials: 'AN' },
    ];

    for (const emp of employees) {
      const { error } = await supabase
        .from('employees')
        .upsert([emp], { onConflict: 'employee_id' });
      if (error) console.error(`  ⚠️  ${emp.employee_id}: ${error.message}`);
      else console.log(`  ✓ ${emp.employee_id} - ${emp.full_name}`);
    }

    // 2. Seed Failures
    console.log('\n📋 Seeding failures...');
    const failures = [
      { failure_code: 'F-24081', category: 'Track geometry', description: 'Gauge widening above tolerance', severity: 'Critical', status: 'Open', risk_score: 94, region: 'Northern', detected_at: new Date(Date.now() - 7200000).toISOString() },
      { failure_code: 'F-24077', category: 'Signalling', description: 'Intermittent relay failure', severity: 'High', status: 'Open', risk_score: 82, region: 'Eastern', detected_at: new Date(Date.now() - 18000000).toISOString() },
      { failure_code: 'F-24064', category: 'Electrical', description: 'Pantograph contact wear', severity: 'Medium', status: 'Investigating', risk_score: 61, region: 'Southern', detected_at: new Date(Date.now() - 86400000).toISOString() },
      { failure_code: 'F-24052', category: 'Structural', description: 'Expansion joint inspection due', severity: 'Low', status: 'Open', risk_score: 38, region: 'Western', detected_at: new Date(Date.now() - 172800000).toISOString() },
      { failure_code: 'F-24088', category: 'Brake system', description: 'Hydraulic pressure anomaly', severity: 'Critical', status: 'Open', risk_score: 89, region: 'Northern', detected_at: new Date(Date.now() - 3600000).toISOString() },
      { failure_code: 'F-24095', category: 'Cable tension', description: 'OHE sagging at km 234', severity: 'High', status: 'Investigating', risk_score: 76, region: 'Eastern', detected_at: new Date(Date.now() - 10800000).toISOString() },
    ];

    for (const fail of failures) {
      const { error } = await supabase
        .from('failures')
        .upsert([fail], { onConflict: 'failure_code' });
      if (error) console.error(`  ⚠️  ${fail.failure_code}: ${error.message}`);
      else console.log(`  ✓ ${fail.failure_code} - ${fail.category}`);
    }

    // 3. Seed Tasks
    console.log('\n✅ Seeding tasks...');
    const now = new Date();
    const tasks = [
      { task_code: 'TSK-8841', title: 'Isolate and inspect track geometry', description: 'Full inspection and measurement', status: 'Pending', priority_score: 94, section_id: 'SECN-001', est_duration_hrs: 8, due_date: new Date(now.getTime() + 3*24*60*60*1000).toISOString(), region: 'Northern' },
      { task_code: 'TSK-8837', title: 'Replace relay module and test signal', description: 'Complete relay replacement', status: 'Pending', priority_score: 82, section_id: 'SECN-002', est_duration_hrs: 6, due_date: new Date(now.getTime() + 5*24*60*60*1000).toISOString(), region: 'Eastern' },
      { task_code: 'TSK-8824', title: 'Schedule OHE maintenance window', description: 'Coordinate maintenance', status: 'Pending', priority_score: 76, section_id: 'SECN-003', est_duration_hrs: 12, due_date: new Date(now.getTime() + 7*24*60*60*1000).toISOString(), region: 'Southern' },
      { task_code: 'TSK-8809', title: 'Book structural inspection crew', description: 'Schedule inspector', status: 'Pending', priority_score: 61, section_id: 'SECN-004', est_duration_hrs: 4, due_date: new Date(now.getTime() + 10*24*60*60*1000).toISOString(), region: 'Western' },
      { task_code: 'TSK-8902', title: 'Hydraulic pressure system check', description: 'Complete hydraulic inspection', status: 'Pending', priority_score: 89, section_id: 'SECN-001', est_duration_hrs: 10, due_date: new Date(now.getTime() + 2*24*60*60*1000).toISOString(), region: 'Northern' },
      { task_code: 'TSK-8911', title: 'Cable tension assessment', description: 'Cable tension measurement', status: 'Pending', priority_score: 76, section_id: 'SECN-002', est_duration_hrs: 9, due_date: new Date(now.getTime() + 4*24*60*60*1000).toISOString(), region: 'Eastern' },
    ];

    for (const task of tasks) {
      const { error } = await supabase
        .from('tasks')
        .upsert([task], { onConflict: 'task_code' });
      if (error) console.error(`  ⚠️  ${task.task_code}: ${error.message}`);
      else console.log(`  ✓ ${task.task_code} - Priority: ${task.priority_score}`);
    }

    // 4. Seed Corridor Availability (14 days for each section)
    console.log('\n🛤️  Seeding corridor availability...');
    const corridorData = [];
    const sections = ['SECN-001', 'SECN-002', 'SECN-003', 'SECN-004'];
    const hoursPerDay = [
      [4, 8, 10, 12, 6, 9, 12, 8, 11, 12, 5, 10, 12, 7],
      [2, 6, 10, 8, 9, 12, 11, 5, 12, 10, 4, 8, 12, 9],
      [3, 7, 12, 10, 6, 11, 12, 9, 12, 8, 3, 12, 10, 7],
      [5, 8, 12, 9, 6, 10, 12, 7, 11, 12, 8, 9, 12, 6],
    ];

    for (let sIdx = 0; sIdx < sections.length; sIdx++) {
      for (let day = 0; day < 14; day++) {
        const date = new Date(now.getTime() + day * 24 * 60 * 60 * 1000);
        const dateStr = date.toISOString().split('T')[0];
        const remaining_hrs = hoursPerDay[sIdx][day];

        corridorData.push({
          section_id: sections[sIdx],
          date: dateStr,
          remaining_hrs,
          available_block_hrs: remaining_hrs,
          total_hrs: 12,
        });
      }
    }

    const { error: corridorError } = await supabase
      .from('corridor_availability')
      .upsert(corridorData, { onConflict: 'section_id,date' });
    if (corridorError) console.error(`  ⚠️  ${corridorError.message}`);
    else console.log(`  ✓ Seeded ${corridorData.length} corridor availability records (14 days × 4 sections)`);

    // 5. Seed Audit Events
    console.log('\n📊 Seeding audit events...');
    const auditEvents = [
      { event_type: 'LOGIN', description: 'Rajesh Kumar Singh logged in', actor_name: 'Rajesh Kumar Singh', region: 'Northern', created_at: new Date().toISOString() },
      { event_type: 'TASK_CREATED', description: 'Task TSK-8841 created', actor_name: 'Priya Sharma', region: 'Northern', created_at: new Date(Date.now() - 3600000).toISOString() },
      { event_type: 'FAILURE_DETECTED', description: 'Failure F-24081 detected', actor_name: 'System', region: 'Northern', created_at: new Date(Date.now() - 7200000).toISOString() },
      { event_type: 'STATUS_UPDATE', description: 'Task TSK-8837 status changed to In progress', actor_name: 'Amit Patel', region: 'Eastern', created_at: new Date(Date.now() - 10800000).toISOString() },
      { event_type: 'SCHEDULE_UPDATED', description: 'Schedule reoptimized', actor_name: 'Rajesh Kumar Singh', region: 'All regions', created_at: new Date(Date.now() - 14400000).toISOString() },
      { event_type: 'FAILURE_RESOLVED', description: 'Failure F-24064 status changed to Resolved', actor_name: 'Neha Verma', region: 'Southern', created_at: new Date(Date.now() - 18000000).toISOString() },
    ];

    const { error: auditError } = await supabase
      .from('audit_events')
      .upsert(auditEvents, { onConflict: 'id' });
    if (auditError) console.error(`  ⚠️  ${auditError.message}`);
    else console.log(`  ✓ Seeded ${auditEvents.length} audit events`);

    // 6. Seed Schedule Windows
    console.log('\n🗓️  Seeding schedule windows...');
    const scheduleWindows = [
      { section_id: 'SECN-001', window_date: new Date(now.getTime() + 3*24*60*60*1000).toISOString().split('T')[0], start_time: '09:00', end_time: '12:00', maintenance_window_name: 'Track Geometry Inspection', status: 'Pending' },
      { section_id: 'SECN-002', window_date: new Date(now.getTime() + 5*24*60*60*1000).toISOString().split('T')[0], start_time: '14:00', end_time: '16:00', maintenance_window_name: 'Signal Relay Replacement', status: 'Confirmed' },
      { section_id: 'SECN-003', window_date: new Date(now.getTime() + 7*24*60*60*1000).toISOString().split('T')[0], start_time: '06:00', end_time: '18:00', maintenance_window_name: 'OHE Maintenance Window', status: 'Pending' },
      { section_id: 'SECN-004', window_date: new Date(now.getTime() + 10*24*60*60*1000).toISOString().split('T')[0], start_time: '10:00', end_time: '14:00', maintenance_window_name: 'Structural Inspection', status: 'Pending' },
    ];

    const { error: windowError } = await supabase
      .from('schedule_windows')
      .upsert(scheduleWindows, { onConflict: 'id' });
    if (windowError) console.error(`  ⚠️  ${windowError.message}`);
    else console.log(`  ✓ Seeded ${scheduleWindows.length} schedule windows`);

    console.log('\n✨ Database seed completed successfully!\n');
    console.log('📋 Summary:');
    console.log('  • 6 employees (including EMP-1042 as Central Planner)');
    console.log('  • 6 failures');
    console.log('  • 6 pending tasks (ready for scheduling)');
    console.log('  • 56 corridor availability records (14 days × 4 sections)');
    console.log('  • 6 audit events');
    console.log('  • 4 schedule windows');
    console.log('\n🚀 You can now log in with: EMP-1042\n');

  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
}

seedDatabase();
