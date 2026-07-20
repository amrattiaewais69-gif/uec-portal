require('dotenv').config();
const pool = require('./config/database');

async function cleanup() {
  const client = await pool.connect();
  try {
    // 1) Delete old test results (year IS NULL)
    const del1 = await client.query("DELETE FROM results WHERE year IS NULL");
    console.log(`Deleted ${del1.rowCount} old test results (year IS NULL)`);

    // 2) Delete duplicate result_types for same student/course/year/semester — keep only 'final'
    const del2 = await client.query(
      "DELETE FROM results WHERE result_type != 'final' AND student_id IN (SELECT student_id FROM results WHERE result_type = 'final')"
    );
    console.log(`Deleted ${del2.rowCount} duplicate non-final results`);

    // 3) Show remaining results
    const remaining = await client.query("SELECT id, student_id, course, result_type, year, semester, grade FROM results ORDER BY student_id, course");
    console.log(`\nRemaining results (${remaining.rowCount}):`);
    remaining.rows.forEach(r => console.log(`  ${r.student_id} | ${r.course} | ${r.result_type} | ${r.year}/${r.semester} | grade=${r.grade}`));
  } finally {
    client.release();
    pool.end();
  }
}

cleanup().catch(e => { console.error(e); process.exit(1); });
