-- UEC Unified Portal — Merged Schema
-- Combines Registration + Results systems

-- USERS (admin, finance, accountant, control)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'finance', 'control')),
  display_name VARCHAR(100) DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- SUPERVISORS
CREATE TABLE IF NOT EXISTS supervisors (
  id SERIAL PRIMARY KEY,
  supervisor_id VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- STUDENTS (merged from both systems)
CREATE TABLE IF NOT EXISTS students (
  student_id VARCHAR(20) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  password_hash VARCHAR(255) NOT NULL,
  first_login BOOLEAN DEFAULT true,
  faculty VARCHAR(255) DEFAULT 'General',
  academic_level VARCHAR(50),
  supervisor_id VARCHAR(100),
  photo_url VARCHAR(500),
  gpa NUMERIC(4,2),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- COURSES (registration)
CREATE TABLE IF NOT EXISTS courses (
  id SERIAL PRIMARY KEY,
  course_code VARCHAR(50) NOT NULL UNIQUE,
  course_name VARCHAR(500) NOT NULL,
  credit_hours INTEGER NOT NULL DEFAULT 0,
  max_seats INTEGER NOT NULL DEFAULT 30,
  fee_per_credit DECIMAL(10,2) NOT NULL DEFAULT 0,
  faculty VARCHAR(255) DEFAULT 'General',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- RESULTS (from result system)
CREATE TABLE IF NOT EXISTS results (
  id SERIAL PRIMARY KEY,
  student_id VARCHAR(20) NOT NULL REFERENCES students(student_id),
  course VARCHAR(255) NOT NULL,
  grade VARCHAR(10) NOT NULL,
  UNIQUE(student_id, course)
);

-- FAILED COURSES (registration)
CREATE TABLE IF NOT EXISTS failed_courses (
  id SERIAL PRIMARY KEY,
  student_id VARCHAR(20) NOT NULL REFERENCES students(student_id),
  course_code VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(student_id, course_code)
);

-- REGISTRATION REQUESTS
CREATE TABLE IF NOT EXISTS requests (
  id SERIAL PRIMARY KEY,
  request_id VARCHAR(100) NOT NULL UNIQUE,
  student_id VARCHAR(20) NOT NULL REFERENCES students(student_id),
  total_credits INTEGER DEFAULT 0,
  total_fees DECIMAL(10,2) DEFAULT 0,
  status VARCHAR(50) DEFAULT 'Draft',
  supervisor_comments TEXT,
  reference_number VARCHAR(255),
  payment_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- COURSE SELECTIONS
CREATE TABLE IF NOT EXISTS course_selections (
  id SERIAL PRIMARY KEY,
  selection_id VARCHAR(100) NOT NULL UNIQUE,
  request_id VARCHAR(100) NOT NULL REFERENCES requests(request_id),
  student_id VARCHAR(20) NOT NULL REFERENCES students(student_id),
  course_code VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- REGISTRATION PAYMENTS
CREATE TABLE IF NOT EXISTS registration_payments (
  id SERIAL PRIMARY KEY,
  transaction_id VARCHAR(100) NOT NULL UNIQUE,
  request_id VARCHAR(100) NOT NULL REFERENCES requests(request_id),
  student_id VARCHAR(20) NOT NULL REFERENCES students(student_id),
  amount_paid DECIMAL(10,2) NOT NULL DEFAULT 0,
  reference_number VARCHAR(255),
  payment_date TIMESTAMP,
  status VARCHAR(50) DEFAULT 'Pending',
  payment_method VARCHAR(100),
  receipt_no VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- APPEAL PAYMENTS (from result system)
CREATE TABLE IF NOT EXISTS appeal_payments (
  id SERIAL PRIMARY KEY,
  student_id VARCHAR(20) NOT NULL REFERENCES students(student_id),
  student_name VARCHAR(255) DEFAULT '',
  course VARCHAR(255) NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  recorded_by VARCHAR(100),
  date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- APPEALS
CREATE TABLE IF NOT EXISTS appeals (
  id SERIAL PRIMARY KEY,
  student_id VARCHAR(20) NOT NULL REFERENCES students(student_id),
  student_name VARCHAR(255) DEFAULT '',
  course VARCHAR(255) NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'Pending',
  date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- SETTINGS
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(50) PRIMARY KEY,
  value TEXT
);

-- APPROVAL HISTORY
CREATE TABLE IF NOT EXISTS approval_history (
  id SERIAL PRIMARY KEY,
  history_id VARCHAR(100) NOT NULL UNIQUE,
  request_id VARCHAR(100) NOT NULL REFERENCES requests(request_id),
  actor_identifier VARCHAR(255),
  actor_role VARCHAR(50),
  action VARCHAR(100),
  action_date TIMESTAMP DEFAULT NOW(),
  comments TEXT
);

-- AUDIT LOG (unified)
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  log_id VARCHAR(100) UNIQUE,
  student_id VARCHAR(20),
  course VARCHAR(255),
  old_status VARCHAR(50),
  new_status VARCHAR(50),
  actor VARCHAR(100),
  description TEXT,
  action_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_requests_student ON requests(student_id);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_selections_request ON course_selections(request_id);
CREATE INDEX IF NOT EXISTS idx_payments_request ON registration_payments(request_id);
CREATE INDEX IF NOT EXISTS idx_results_student ON results(student_id);
CREATE INDEX IF NOT EXISTS idx_appeals_student ON appeals(student_id);
