-- RailPrioritize Database Seed Script
-- Creates all 6 tables and populates with sample data
-- Execute in Supabase SQL Editor

-- 1. EMPLOYEES TABLE
CREATE TABLE IF NOT EXISTS employees (
  id BIGSERIAL PRIMARY KEY,
  employee_id TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL,
  region TEXT NOT NULL,
  initials TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. FAILURES TABLE
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
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. TASKS TABLE (with scheduling fields)
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

-- 4. CORRIDOR_AVAILABILITY TABLE (for scheduling)
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

-- 5. AUDIT_EVENTS TABLE
CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  description TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  region TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. SCHEDULE_WINDOWS TABLE
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

-- SAMPLE DATA

-- Insert Employees
INSERT INTO employees (employee_id, full_name, role, region, initials) VALUES
('EMP-1042', 'Rajesh Kumar Singh', 'Central Planner', 'Northern', 'RKS'),
('EMP-2051', 'Priya Sharma', 'Operations Manager', 'Eastern', 'PS'),
('EMP-3047', 'Amit Patel', 'Crew Lead', 'Southern', 'AP'),
('EMP-4038', 'Neha Verma', 'Field Supervisor', 'Western', 'NV'),
('EMP-5029', 'Vikram Desai', 'Central Planner', 'Northern', 'VD'),
('EMP-6015', 'Anjali Nair', 'Operations Manager', 'Southern', 'AN')
ON CONFLICT (employee_id) DO NOTHING;

-- Insert Failures
INSERT INTO failures (failure_code, category, description, severity, status, risk_score, region, detected_at) VALUES
('F-24081', 'Track geometry', 'Gauge widening above tolerance', 'Critical', 'Open', 94, 'Northern', NOW() - INTERVAL '2 hours'),
('F-24077', 'Signalling', 'Intermittent relay failure', 'High', 'Open', 82, 'Eastern', NOW() - INTERVAL '5 hours'),
('F-24064', 'Electrical', 'Pantograph contact wear', 'Medium', 'Investigating', 61, 'Southern', NOW() - INTERVAL '24 hours'),
('F-24052', 'Structural', 'Expansion joint inspection due', 'Low', 'Open', 38, 'Western', NOW() - INTERVAL '48 hours'),
('F-24088', 'Brake system', 'Hydraulic pressure anomaly', 'Critical', 'Open', 89, 'Northern', NOW() - INTERVAL '1 hour'),
('F-24095', 'Cable tension', 'OHE sagging at km 234', 'High', 'Investigating', 76, 'Eastern', NOW() - INTERVAL '3 hours')
ON CONFLICT (failure_code) DO NOTHING;

-- Insert Tasks (with Pending status for scheduling)
INSERT INTO tasks (task_code, title, description, status, priority_score, section_id, est_duration_hrs, due_date, region) VALUES
('TSK-8841', 'Isolate and inspect track geometry', 'Full inspection and measurement of track geometry', 'Pending', 94, 'SECN-001', 8, NOW() + INTERVAL '3 days', 'Northern'),
('TSK-8837', 'Replace relay module and test signal', 'Complete relay replacement and signal testing', 'Pending', 82, 'SECN-002', 6, NOW() + INTERVAL '5 days', 'Eastern'),
('TSK-8824', 'Schedule OHE maintenance window', 'Coordinate OHE maintenance and traffic diversion', 'Pending', 76, 'SECN-003', 12, NOW() + INTERVAL '7 days', 'Southern'),
('TSK-8809', 'Book structural inspection crew', 'Schedule structural inspector and prepare reports', 'Pending', 61, 'SECN-004', 4, NOW() + INTERVAL '10 days', 'Western'),
('TSK-8902', 'Hydraulic pressure system check', 'Complete hydraulic system inspection', 'Pending', 89, 'SECN-001', 10, NOW() + INTERVAL '2 days', 'Northern'),
('TSK-8911', 'Cable tension assessment', 'Full cable tension measurement and adjustment', 'Pending', 76, 'SECN-002', 9, NOW() + INTERVAL '4 days', 'Eastern')
ON CONFLICT (task_code) DO NOTHING;

-- Insert Corridor Availability (14 days of data for scheduling)
INSERT INTO corridor_availability (section_id, date, remaining_hrs, available_block_hrs, total_hrs) VALUES
-- SECN-001 availability
('SECN-001', NOW()::DATE, 4, 4, 12),
('SECN-001', (NOW() + INTERVAL '1 day')::DATE, 8, 8, 12),
('SECN-001', (NOW() + INTERVAL '2 day')::DATE, 10, 10, 12),
('SECN-001', (NOW() + INTERVAL '3 day')::DATE, 12, 12, 12),
('SECN-001', (NOW() + INTERVAL '4 day')::DATE, 6, 6, 12),
('SECN-001', (NOW() + INTERVAL '5 day')::DATE, 9, 9, 12),
('SECN-001', (NOW() + INTERVAL '6 day')::DATE, 12, 12, 12),
('SECN-001', (NOW() + INTERVAL '7 day')::DATE, 8, 8, 12),
('SECN-001', (NOW() + INTERVAL '8 day')::DATE, 11, 11, 12),
('SECN-001', (NOW() + INTERVAL '9 day')::DATE, 12, 12, 12),
('SECN-001', (NOW() + INTERVAL '10 day')::DATE, 5, 5, 12),
('SECN-001', (NOW() + INTERVAL '11 day')::DATE, 10, 10, 12),
('SECN-001', (NOW() + INTERVAL '12 day')::DATE, 12, 12, 12),
('SECN-001', (NOW() + INTERVAL '13 day')::DATE, 7, 7, 12),

-- SECN-002 availability
('SECN-002', NOW()::DATE, 2, 2, 12),
('SECN-002', (NOW() + INTERVAL '1 day')::DATE, 6, 6, 12),
('SECN-002', (NOW() + INTERVAL '2 day')::DATE, 10, 10, 12),
('SECN-002', (NOW() + INTERVAL '3 day')::DATE, 8, 8, 12),
('SECN-002', (NOW() + INTERVAL '4 day')::DATE, 9, 9, 12),
('SECN-002', (NOW() + INTERVAL '5 day')::DATE, 12, 12, 12),
('SECN-002', (NOW() + INTERVAL '6 day')::DATE, 11, 11, 12),
('SECN-002', (NOW() + INTERVAL '7 day')::DATE, 5, 5, 12),
('SECN-002', (NOW() + INTERVAL '8 day')::DATE, 12, 12, 12),
('SECN-002', (NOW() + INTERVAL '9 day')::DATE, 10, 10, 12),
('SECN-002', (NOW() + INTERVAL '10 day')::DATE, 4, 4, 12),
('SECN-002', (NOW() + INTERVAL '11 day')::DATE, 8, 8, 12),
('SECN-002', (NOW() + INTERVAL '12 day')::DATE, 12, 12, 12),
('SECN-002', (NOW() + INTERVAL '13 day')::DATE, 9, 9, 12),

-- SECN-003 availability
('SECN-003', NOW()::DATE, 3, 3, 12),
('SECN-003', (NOW() + INTERVAL '1 day')::DATE, 7, 7, 12),
('SECN-003', (NOW() + INTERVAL '2 day')::DATE, 12, 12, 12),
('SECN-003', (NOW() + INTERVAL '3 day')::DATE, 10, 10, 12),
('SECN-003', (NOW() + INTERVAL '4 day')::DATE, 6, 6, 12),
('SECN-003', (NOW() + INTERVAL '5 day')::DATE, 11, 11, 12),
('SECN-003', (NOW() + INTERVAL '6 day')::DATE, 12, 12, 12),
('SECN-003', (NOW() + INTERVAL '7 day')::DATE, 9, 9, 12),
('SECN-003', (NOW() + INTERVAL '8 day')::DATE, 12, 12, 12),
('SECN-003', (NOW() + INTERVAL '9 day')::DATE, 8, 8, 12),
('SECN-003', (NOW() + INTERVAL '10 day')::DATE, 3, 3, 12),
('SECN-003', (NOW() + INTERVAL '11 day')::DATE, 12, 12, 12),
('SECN-003', (NOW() + INTERVAL '12 day')::DATE, 10, 10, 12),
('SECN-003', (NOW() + INTERVAL '13 day')::DATE, 7, 7, 12),

-- SECN-004 availability
('SECN-004', NOW()::DATE, 5, 5, 12),
('SECN-004', (NOW() + INTERVAL '1 day')::DATE, 8, 8, 12),
('SECN-004', (NOW() + INTERVAL '2 day')::DATE, 12, 12, 12),
('SECN-004', (NOW() + INTERVAL '3 day')::DATE, 9, 9, 12),
('SECN-004', (NOW() + INTERVAL '4 day')::DATE, 6, 6, 12),
('SECN-004', (NOW() + INTERVAL '5 day')::DATE, 10, 10, 12),
('SECN-004', (NOW() + INTERVAL '6 day')::DATE, 12, 12, 12),
('SECN-004', (NOW() + INTERVAL '7 day')::DATE, 7, 7, 12),
('SECN-004', (NOW() + INTERVAL '8 day')::DATE, 11, 11, 12),
('SECN-004', (NOW() + INTERVAL '9 day')::DATE, 12, 12, 12),
('SECN-004', (NOW() + INTERVAL '10 day')::DATE, 8, 8, 12),
('SECN-004', (NOW() + INTERVAL '11 day')::DATE, 9, 9, 12),
('SECN-004', (NOW() + INTERVAL '12 day')::DATE, 12, 12, 12),
('SECN-004', (NOW() + INTERVAL '13 day')::DATE, 6, 6, 12)
ON CONFLICT (section_id, date) DO NOTHING;

-- Insert Audit Events
INSERT INTO audit_events (event_type, description, actor_name, region) VALUES
('LOGIN', 'Rajesh Kumar Singh logged in', 'Rajesh Kumar Singh', 'Northern'),
('TASK_CREATED', 'Task TSK-8841 created', 'Priya Sharma', 'Northern'),
('FAILURE_DETECTED', 'Failure F-24081 detected', 'System', 'Northern'),
('STATUS_UPDATE', 'Task TSK-8837 status changed to In progress', 'Amit Patel', 'Eastern'),
('SCHEDULE_UPDATED', 'Schedule reoptimized', 'Rajesh Kumar Singh', 'All regions'),
('FAILURE_RESOLVED', 'Failure F-24064 status changed to Resolved', 'Neha Verma', 'Southern')
ON CONFLICT DO NOTHING;

-- Insert Sample Schedule Windows
INSERT INTO schedule_windows (section_id, window_date, start_time, end_time, maintenance_window_name, status) VALUES
('SECN-001', (NOW() + INTERVAL '3 day')::DATE, '09:00:00', '12:00:00', 'Track Geometry Inspection', 'Pending'),
('SECN-002', (NOW() + INTERVAL '5 day')::DATE, '14:00:00', '16:00:00', 'Signal Relay Replacement', 'Confirmed'),
('SECN-003', (NOW() + INTERVAL '7 day')::DATE, '06:00:00', '18:00:00', 'OHE Maintenance Window', 'Pending'),
('SECN-004', (NOW() + INTERVAL '10 day')::DATE, '10:00:00', '14:00:00', 'Structural Inspection', 'Pending')
ON CONFLICT DO NOTHING;

-- Enable Row Level Security (Optional - for production)
-- ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE failures ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE corridor_availability ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE schedule_windows ENABLE ROW LEVEL SECURITY;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_section ON tasks(section_id);
CREATE INDEX IF NOT EXISTS idx_corridor_section_date ON corridor_availability(section_id, date);
CREATE INDEX IF NOT EXISTS idx_failures_risk ON failures(risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_events(created_at DESC);

-- Summary
-- Tables created: 6 (employees, failures, tasks, corridor_availability, audit_events, schedule_windows)
-- Sample employees: 6 (including EMP-1042 as Central Planner)
-- Sample tasks: 6 (all with Pending status, ready for scheduling)
-- Sample corridor availability: 56 rows (14 days × 4 sections)
-- Sample failures: 6
-- Sample audit events: 6
-- Sample schedule windows: 4
