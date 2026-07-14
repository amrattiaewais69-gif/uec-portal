require('dotenv').config();
const pool = require('./config/database');
async function migrate() {
  try {
    await pool.query('ALTER TABLE results ADD COLUMN IF NOT EXISTS year VARCHAR(10)');
    await pool.query('ALTER TABLE results ADD COLUMN IF NOT EXISTS semester VARCHAR(20)');
    await pool.query('ALTER TABLE results ADD COLUMN IF NOT EXISTS midterm_grade VARCHAR(5)');
    await pool.query('ALTER TABLE results ADD COLUMN IF NOT EXISTS final_grade VARCHAR(5)');
    await pool.query('ALTER TABLE results ADD COLUMN IF NOT EXISTS coursework VARCHAR(5)');
    // Drop old unique constraint if exists
    await pool.query('ALTER TABLE results DROP CONSTRAINT IF EXISTS results_student_id_course_key');
    await pool.query('ALTER TABLE results DROP CONSTRAINT IF EXISTS results_student_course_year_sem');
    await pool.query('ALTER TABLE results ADD CONSTRAINT results_student_course_year_sem UNIQUE (student_id, course, year, semester)');
    console.log('Migration complete');
    const r = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'results' ORDER BY ordinal_position");
    console.log('Result columns:', r.rows.map(x => x.column_name));
  } catch(e) { console.error(e.message); }
  process.exit();
}
migrate();
