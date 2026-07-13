require('dotenv').config();
const pool = require('./config/database');
async function t() {
  await pool.query("INSERT INTO failed_courses (student_id, course_code) VALUES ('25100001', 'INFE401') ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO failed_courses (student_id, course_code) VALUES ('25100001', 'IMMU401') ON CONFLICT DO NOTHING");
  console.log('Added failed courses for 25100001');
  const r = await pool.query("SELECT * FROM failed_courses WHERE student_id = '25100001'");
  console.log('Now:', JSON.stringify(r.rows));
  await pool.end();
}
t();
