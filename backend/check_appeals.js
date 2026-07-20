require('dotenv').config();
const pool = require('./config/database');
pool.query("SELECT column_name, column_default FROM information_schema.columns WHERE table_name = 'appeals' ORDER BY ordinal_position")
  .then(r => { console.log(r.rows); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });
