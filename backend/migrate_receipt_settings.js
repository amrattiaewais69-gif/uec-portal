const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  try {
    await pool.query("INSERT INTO settings (key, value) VALUES ('receipt_prefix', 'UEC-') ON CONFLICT (key) DO NOTHING");
    await pool.query("INSERT INTO settings (key, value) VALUES ('receipt_counter', '1') ON CONFLICT (key) DO NOTHING");
    console.log('Receipt settings initialized');
    await pool.end();
  } catch(e) { console.error(e); await pool.end(); }
})();
