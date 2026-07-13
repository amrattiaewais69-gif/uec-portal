require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('./config/database');

async function test() {
  const r = await pool.query("SELECT student_id, password_hash FROM students WHERE student_id = '25100001'");
  console.log('found:', r.rows.length);
  if (r.rows.length) {
    const h = r.rows[0].password_hash;
    console.log('hash starts with:', h.substring(0, 20));
    const v = await bcrypt.compare('25100001', h);
    console.log('password match:', v);
  }
  await pool.end();
}
test();
