const pool = require('./config/database');

async function main() {
  await pool.query('ALTER TABLE faculties ADD COLUMN IF NOT EXISTS appeal_fee NUMERIC DEFAULT 0');
  console.log('Added appeal_fee column to faculties table');

  const result = await pool.query('SELECT name, appeal_fee FROM faculties');
  console.log('Faculties:', result.rows);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
