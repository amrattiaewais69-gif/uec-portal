require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('./config/database');

async function fix() {
  const students = await pool.query("SELECT student_id FROM students");
  for (const s of students.rows) {
    const hash = await bcrypt.hash(s.student_id, 10);
    await pool.query('UPDATE students SET password_hash = $1 WHERE student_id = $2', [hash, s.student_id]);
    const match = await bcrypt.compare(s.student_id, hash);
    console.log('Fixed', s.student_id, 'match:', match);
  }
  
  const admins = await pool.query("SELECT username, role FROM users");
  const passwords = { admin: 'Admin123', finance: 'Finance123', control: 'Control123' };
  for (const u of admins.rows) {
    if (passwords[u.username]) {
      const hash = await bcrypt.hash(passwords[u.username], 10);
      await pool.query('UPDATE users SET password_hash = $1 WHERE username = $2', [hash, u.username]);
      const match = await bcrypt.compare(passwords[u.username], hash);
      console.log('Fixed', u.username, 'match:', match);
    }
  }

  const sups = await pool.query("SELECT supervisor_id FROM supervisors");
  for (const s of sups.rows) {
    const hash = await bcrypt.hash('super123', 10);
    await pool.query('UPDATE supervisors SET password_hash = $1 WHERE supervisor_id = $2', [hash, s.supervisor_id]);
    console.log('Fixed', s.supervisor_id);
  }

  await pool.end();
  console.log('Done!');
}
fix();
