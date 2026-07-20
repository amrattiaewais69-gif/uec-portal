require('dotenv').config();
const pool = require('./config/database');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

async function run() {
  // 1. Drop FK constraint
  console.log('Dropping FK constraints...');
  await pool.query('ALTER TABLE results DROP CONSTRAINT IF EXISTS results_student_id_fkey');
  console.log('FK dropped');

  // 2. Get all students with dashes
  const res = await pool.query("SELECT student_id FROM students WHERE student_id LIKE '%-%'");
  const students = res.rows;
  console.log(`Found ${students.length} students with dashes`);

  let updated = 0, failed = 0;
  for (const s of students) {
    const oldId = s.student_id;
    const newId = oldId.replace(/-/g, '');
    if (oldId === newId) continue;

    try {
      const hash = await bcrypt.hash(newId, 10);

      // Update students first
      await pool.query('UPDATE students SET student_id = $1, password_hash = $2 WHERE student_id = $3', [newId, hash, oldId]);
      // Then all child tables
      await pool.query('UPDATE results SET student_id = $1 WHERE student_id = $2', [newId, oldId]);
      await pool.query('UPDATE requests SET student_id = $1 WHERE student_id = $2', [newId, oldId]).catch(() => {});
      await pool.query('UPDATE failed_courses SET student_id = $1 WHERE student_id = $2', [newId, oldId]).catch(() => {});
      await pool.query('UPDATE course_selections SET student_id = $1 WHERE student_id = $2', [newId, oldId]).catch(() => {});
      await pool.query('UPDATE appeal_payments SET student_id = $1 WHERE student_id = $2', [newId, oldId]).catch(() => {});
      await pool.query("UPDATE audit_log SET actor = $1 WHERE actor = $2", [newId, oldId]).catch(() => {});

      // Rename photo
      const oldPhoto = path.join(__dirname, 'public', 'photos', oldId + '.jpg');
      const newPhoto = path.join(__dirname, 'public', 'photos', newId + '.jpg');
      if (fs.existsSync(oldPhoto)) fs.renameSync(oldPhoto, newPhoto);

      updated++;
      if (updated % 50 === 0) console.log(`Progress: ${updated}/${students.length}`);
    } catch (e) {
      failed++;
      console.error(`Failed ${oldId}: ${e.message}`);
    }
  }

  // 3. Re-add FK constraint
  console.log('\nRe-adding FK constraint...');
  await pool.query('ALTER TABLE results ADD CONSTRAINT results_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(student_id)');
  console.log('FK re-added');

  console.log(`\nDone! Updated: ${updated}, Failed: ${failed}`);
  const check = await pool.query("SELECT student_id FROM students WHERE student_id LIKE '%-%'");
  console.log(`Remaining with dashes: ${check.rows.length}`);
  process.exit(0);
}

run();
