const { Pool } = require('pg');

// Connect to default postgres database to create portal database
const adminPool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_NvLgtK5oaW0G@ep-proud-moon-atj31h3z.c-9.us-east-1.aws.neon.tech/postgres?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

async function setup() {
  console.log('=== UEC Portal — Database Setup ===\n');

  try {
    // Check if database exists
    const dbCheck = await adminPool.query("SELECT 1 FROM pg_database WHERE datname = 'neondb_portal'");
    if (dbCheck.rows.length === 0) {
      console.log('Creating database neondb_portal...');
      await adminPool.query('CREATE DATABASE neondb_portal');
      console.log('✓ Database created');
    } else {
      console.log('✓ Database already exists');
    }
  } catch (err) {
    console.error('Error creating database:', err.message);
    console.log('\nTrying to connect directly to neondb_portal...');
  }

  await adminPool.end();

  // Connect to portal database
  const portalPool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_NvLgtK5oaW0G@ep-proud-moon-atj31h3z.c-9.us-east-1.aws.neon.tech/neondb_portal?sslmode=require',
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('\nCreating tables...');
    await portalPool.query(`
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

      CREATE TABLE IF NOT EXISTS supervisors (
        id SERIAL PRIMARY KEY,
        supervisor_id VARCHAR(100) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

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

      CREATE TABLE IF NOT EXISTS results (
        id SERIAL PRIMARY KEY,
        student_id VARCHAR(20) NOT NULL REFERENCES students(student_id),
        course VARCHAR(255) NOT NULL,
        grade VARCHAR(10) NOT NULL,
        UNIQUE(student_id, course)
      );

      CREATE TABLE IF NOT EXISTS failed_courses (
        id SERIAL PRIMARY KEY,
        student_id VARCHAR(20) NOT NULL REFERENCES students(student_id),
        course_code VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(student_id, course_code)
      );

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

      CREATE TABLE IF NOT EXISTS course_selections (
        id SERIAL PRIMARY KEY,
        selection_id VARCHAR(100) NOT NULL UNIQUE,
        request_id VARCHAR(100) NOT NULL REFERENCES requests(request_id),
        student_id VARCHAR(20) NOT NULL REFERENCES students(student_id),
        course_code VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

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

      CREATE TABLE IF NOT EXISTS appeal_payments (
        id SERIAL PRIMARY KEY,
        student_id VARCHAR(20) NOT NULL REFERENCES students(student_id),
        student_name VARCHAR(255) DEFAULT '',
        course VARCHAR(255) NOT NULL,
        amount NUMERIC(10,2) NOT NULL,
        recorded_by VARCHAR(100),
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS appeals (
        id SERIAL PRIMARY KEY,
        student_id VARCHAR(20) NOT NULL REFERENCES students(student_id),
        student_name VARCHAR(255) DEFAULT '',
        course VARCHAR(255) NOT NULL,
        reason TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'Pending',
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(50) PRIMARY KEY,
        value TEXT
      );

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

      CREATE INDEX IF NOT EXISTS idx_requests_student ON requests(student_id);
      CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
      CREATE INDEX IF NOT EXISTS idx_selections_request ON course_selections(request_id);
      CREATE INDEX IF NOT EXISTS idx_payments_request ON registration_payments(request_id);
      CREATE INDEX IF NOT EXISTS idx_results_student ON results(student_id);
      CREATE INDEX IF NOT EXISTS idx_appeals_student ON appeals(student_id);
    `);
    console.log('✓ Tables created');

    // Seed admin accounts
    const bcrypt = require('bcrypt');

    console.log('\nSeeding admin accounts...');
    const adminHash = await bcrypt.hash('Admin123', 10);
    await portalPool.query(
      "INSERT INTO users (username, password_hash, role, display_name) VALUES ('admin', $1, 'admin', 'Admin') ON CONFLICT (username) DO UPDATE SET password_hash = $1",
      [adminHash]
    );
    console.log('✓ admin / Admin123 (admin)');

    const financeHash = await bcrypt.hash('Finance123', 10);
    await portalPool.query(
      "INSERT INTO users (username, password_hash, role, display_name) VALUES ('finance', $1, 'finance', 'Finance') ON CONFLICT (username) DO UPDATE SET password_hash = $1",
      [financeHash]
    );
    console.log('✓ finance / Finance123 (finance)');

    const controlHash = await bcrypt.hash('Control123', 10);
    await portalPool.query(
      "INSERT INTO users (username, password_hash, role, display_name) VALUES ('control', $1, 'control', 'Control') ON CONFLICT (username) DO UPDATE SET password_hash = $1",
      [controlHash]
    );
    console.log('✓ control / Control123 (control)');

    console.log('\n=== Setup Complete ===');
    console.log('\nNext: Add .env file with DATABASE_URL and deploy.');
  } catch (err) {
    console.error('Error:', err.message);
  }

  await portalPool.end();
}

setup();
