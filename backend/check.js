require('dotenv').config();
const pool = require('./config/database');
async function t() {
  const fc = await pool.query('SELECT student_id, course_code FROM failed_courses');
  console.log('Failed courses:', JSON.stringify(fc.rows));
  const stu = await pool.query("SELECT student_id, faculty FROM students WHERE student_id IN ('25100001','25100002','25100003')");
  console.log('Students:', JSON.stringify(stu.rows));
  const co = await pool.query("SELECT course_code, faculty FROM courses");
  console.log('Courses:', JSON.stringify(co.rows));
  await pool.end();
}
t();
