require('dotenv').config();
const pool = require('./config/database');
async function run() {
  const q = `SELECT column_name, data_type, character_maximum_length FROM information_schema.columns WHERE table_name='results' AND column_name IN ('midterm_grade','final_grade','coursework','grade')`;
  const r = await pool.query(q);
  console.log(JSON.stringify(r.rows, null, 2));

  try {
    await pool.query('ALTER TABLE results ALTER COLUMN midterm_grade TYPE VARCHAR(50)');
    console.log('midterm_grade -> VARCHAR(50) OK');
  } catch(e) { console.error('midterm_grade ERR:', e.message); }

  try {
    await pool.query('ALTER TABLE results ALTER COLUMN final_grade TYPE VARCHAR(50)');
    console.log('final_grade -> VARCHAR(50) OK');
  } catch(e) { console.error('final_grade ERR:', e.message); }

  try {
    await pool.query('ALTER TABLE results ALTER COLUMN coursework TYPE VARCHAR(50)');
    console.log('coursework -> VARCHAR(50) OK');
  } catch(e) { console.error('coursework ERR:', e.message); }

  process.exit(0);
}
run();
