const pool = require('./config/database');
pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'results' ORDER BY ordinal_position").then(r => {
  console.log(r.rows.map(x=>x.column_name).join(', '));
  process.exit();
}).catch(e => { console.error(e.message); process.exit(1); });
