const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_NvLgtK5oaW0G@ep-proud-moon-atj31h3z.c-9.us-east-1.aws.neon.tech/neondb_portal?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  console.log('Running migration...\n');

  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE results ADD COLUMN result_type VARCHAR(20) DEFAULT 'midterm';
    EXCEPTION WHEN duplicate_column THEN null;
    END $$;

    DO $$ BEGIN
      ALTER TABLE students ADD COLUMN photo_url VARCHAR(500);
    EXCEPTION WHEN duplicate_column THEN null;
    END $$;

    INSERT INTO settings (key, value) VALUES ('registration_open', 'true') ON CONFLICT (key) DO NOTHING;
    INSERT INTO settings (key, value) VALUES ('appeal_open', 'true') ON CONFLICT (key) DO NOTHING;
  `);

  console.log('✓ Added result_type column');
  console.log('✓ Added photo_url column');
  console.log('✓ Added registration_open setting');
  console.log('✓ Added appeal_open setting');

  await pool.end();
}

migrate();
