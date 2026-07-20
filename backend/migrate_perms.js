require('dotenv').config();
const pool = require('./config/database');

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Add permissions JSONB column to users
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT 'null';
    `);
    console.log('Added permissions column');

    // Give full_admin permissions to existing admin users
    const fullPerms = JSON.stringify({
      students: ['view', 'add', 'edit', 'delete'],
      courses: ['view', 'add', 'edit', 'delete'],
      results: ['view', 'upload'],
      faculties: ['view', 'add', 'edit', 'delete'],
      reports: ['view', 'export'],
      accounts: ['view', 'add', 'edit', 'delete'],
      settings: ['view', 'edit'],
      appeals: ['view', 'edit']
    });

    await client.query(
      "UPDATE users SET permissions = $1 WHERE role = 'admin' AND permissions IS NULL",
      [fullPerms]
    );
    console.log('Gave full permissions to admin users');

    // Give all permissions to finance and control users too (they are staff roles)
    await client.query(
      "UPDATE users SET permissions = $1 WHERE role IN ('finance', 'control') AND permissions IS NULL",
      [fullPerms]
    );
    console.log('Gave full permissions to finance/control users');

    await client.query('COMMIT');
    console.log('Migration complete!');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', e);
  } finally {
    client.release();
    await pool.end();
  }
})();
