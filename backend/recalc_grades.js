require('dotenv').config();
const pool = require('./config/database');

async function recalc() {
  const client = await pool.connect();
  try {
    const results = await client.query("SELECT r.id, r.student_id, r.course, r.midterm_grade, r.final_grade, r.coursework, r.faculty FROM results r WHERE r.midterm_grade IS NOT NULL OR r.final_grade IS NOT NULL OR r.coursework IS NOT NULL");
    
    for (const r of results.rows) {
      let mw = 20, cwW = 40, fw = 40;
      if (r.faculty) {
        const fRes = await client.query('SELECT midterm_weight, coursework_weight, final_weight FROM faculties WHERE name = $1', [r.faculty]);
        if (fRes.rows.length > 0) { mw = fRes.rows[0].midterm_weight; cwW = fRes.rows[0].coursework_weight; fw = fRes.rows[0].final_weight; }
      }
      const mg = parseFloat(r.midterm_grade) || 0;
      const fg = parseFloat(r.final_grade) || 0;
      const cw = parseFloat(r.coursework) || 0;
      const hasAny = r.midterm_grade != null || r.final_grade != null || r.coursework != null;
      if (hasAny) {
        const grade = ((mg * mw + cw * cwW + fg * fw) / 100).toFixed(1);
        await client.query('UPDATE results SET grade = $1 WHERE id = $2', [grade, r.id]);
        console.log(`  ${r.student_id} ${r.course}: ${grade} (mid=${mg}*${mw} + cw=${cw}*${cwW} + fg=${fg}*${fw})`);
      }
    }
    console.log('Done recalculating');
  } finally {
    client.release();
    pool.end();
  }
}

recalc().catch(e => { console.error(e); process.exit(1); });
