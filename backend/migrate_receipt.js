const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  try {
    await pool.query('ALTER TABLE appeal_payments ADD COLUMN IF NOT EXISTS receipt_no VARCHAR(20)');
    console.log('Added receipt_no column');
    await pool.end();
  } catch(e) { console.error(e); await pool.end(); }
})();
