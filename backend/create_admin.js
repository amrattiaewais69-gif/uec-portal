const { Pool } = require('pg');
require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    const hash = await bcrypt.hash('Admin123', 10);
    await pool.query(
      "INSERT INTO users (username, password_hash, role, display_name, first_login) VALUES ($1, $2, $3, $4, false) ON CONFLICT (username) DO NOTHING",
      ['admin', hash, 'admin', 'Administrator']
    );
    console.log('Admin created: admin / Admin123');
    await pool.end();
  } catch(e) { console.error(e); await pool.end(); }
})();
