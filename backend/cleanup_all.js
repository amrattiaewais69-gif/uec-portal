const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tables = [
      'approval_history',
      'course_selections',
      'failed_courses',
      'registration_payments',
      'appeal_payments',
      'appeals',
      'requests',
      'results',
      'courses',
      'students',
      'users',
      'supervisors',
      'audit_log'
    ];

    for (const t of tables) {
      const { rows } = await client.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1) as exists`, [t]);
      if (rows[0].exists) {
        await client.query(`DELETE FROM ${t}`);
        console.log(`Cleared: ${t}`);
      }
    }

    await client.query("DELETE FROM settings WHERE key NOT IN ('receipt_prefix', 'receipt_counter', 'appeal_deadline')");
    console.log('Cleared extra settings (kept receipt_prefix, receipt_counter, appeal_deadline)');

    await client.query('COMMIT');
    console.log('\nDone. Faculties and core settings preserved. Photos untouched.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error:', e.message);
  } finally {
    client.release();
    await pool.end();
  }
})();
