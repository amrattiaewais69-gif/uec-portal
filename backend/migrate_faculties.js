require('dotenv').config();
const pool = require('./config/database');

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create faculties table
    await client.query(`
      CREATE TABLE IF NOT EXISTS faculties (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        reg_open BOOLEAN DEFAULT false,
        midterm_visible BOOLEAN DEFAULT false,
        final_visible BOOLEAN DEFAULT false,
        summer_visible BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('Created faculties table');

    // 2. Seed existing faculties from students and courses
    const { rows: studentFaculties } = await client.query(
      "SELECT DISTINCT faculty FROM students WHERE faculty IS NOT NULL AND faculty != ''"
    );
    const { rows: courseFaculties } = await client.query(
      "SELECT DISTINCT faculty FROM courses WHERE faculty IS NOT NULL AND faculty != ''"
    );

    const allFaculties = new Set();
    studentFaculties.forEach(r => allFaculties.add(r.faculty));
    courseFaculties.forEach(r => allFaculties.add(r.faculty));

    for (const name of allFaculties) {
      await client.query(
        'INSERT INTO faculties (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
        [name]
      );
      console.log('Seeded faculty:', name);
    }

    // 3. Fix UNIQUE constraint on results to include result_type
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'results_student_id_course_key'
          AND conrelid = 'results'::regclass
        ) THEN
          ALTER TABLE results DROP CONSTRAINT results_student_id_course_key;
          ALTER TABLE results ADD CONSTRAINT results_student_id_course_result_type_key
            UNIQUE (student_id, course, result_type);
          RAISE NOTICE 'Updated UNIQUE constraint to include result_type';
        ELSE
          RAISE NOTICE 'Constraint not found, checking if alternative exists...';
        END IF;
      END $$;
    `);
    console.log('Fixed UNIQUE constraint');

    // 4. Remove global registration_open setting (now per-faculty)
    await client.query("DELETE FROM settings WHERE key = 'registration_open'");
    console.log('Removed global registration_open setting');

    await client.query('COMMIT');
    console.log('Migration complete!');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', e);
  } finally {
    client.release();
    await pool.end();
  }
})();
