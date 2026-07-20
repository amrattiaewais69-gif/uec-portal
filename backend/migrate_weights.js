require('dotenv').config();
const pool = require('./config/database');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`ALTER TABLE faculties ADD COLUMN IF NOT EXISTS midterm_weight INT DEFAULT 20`);
    await client.query(`ALTER TABLE faculties ADD COLUMN IF NOT EXISTS coursework_weight INT DEFAULT 40`);
    await client.query(`ALTER TABLE faculties ADD COLUMN IF NOT EXISTS final_weight INT DEFAULT 40`);
    console.log('Added grading weight columns to faculties table');

    const res = await client.query('SELECT name, midterm_weight, coursework_weight, final_weight FROM faculties ORDER BY name');
    console.log('Faculty weights:');
    res.rows.forEach(r => console.log(`  ${r.name}: midterm=${r.midterm_weight}, cw=${r.coursework_weight}, final=${r.final_weight}`));
  } finally {
    client.release();
    pool.end();
  }
}

migrate().catch(e => { console.error(e); process.exit(1); });
