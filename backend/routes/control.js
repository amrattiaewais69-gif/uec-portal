const express = require('express');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Get faculties (for control results entry)
router.get('/faculties', authenticateToken, requireRole('control'), async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name FROM faculties ORDER BY name');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/appeals', authenticateToken, requireRole('control'), async (req, res) => {
  try {
    const result = await pool.query('SELECT id, student_id, student_name, course, reason, status, date::text FROM appeals ORDER BY date DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Get all appeals error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/appeal-status', authenticateToken, requireRole('control'), async (req, res) => {
  try {
    const { id, status } = req.body;
    if (!id || !status) return res.status(400).json({ error: 'ID and status required' });

    const validStatuses = ['Pending', 'Under Review', 'Revised with change', 'Revised without change'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const old = await pool.query('SELECT student_id, course, status as old_status FROM appeals WHERE id = $1', [id]);
    if (old.rows.length === 0) return res.status(404).json({ error: 'Appeal not found' });

    await pool.query('UPDATE appeals SET status = $1 WHERE id = $2', [status, id]);
    await pool.query("INSERT INTO audit_log (log_id, student_id, course, old_status, new_status, actor) VALUES ($1, $2, $3, $4, $5, $6)", [uuidv4(), old.rows[0].student_id, old.rows[0].course, old.rows[0].old_status, status, req.user.username]);

    res.json({ message: 'Status updated successfully' });
  } catch (err) {
    console.error('Update appeal status error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

// ===== RESULTS ENTRY (Control) =====

// Get students by faculty for results entry
router.get('/students-by-faculty', authenticateToken, requireRole('control'), async (req, res) => {
  try {
    const { faculty } = req.query;
    let query = 'SELECT student_id, name, email, faculty, academic_level, supervisor_id FROM students';
    const params = [];
    if (faculty) { query += ' WHERE LOWER(faculty) = LOWER($1)'; params.push(faculty); }
    query += ' ORDER BY faculty, name';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Get all courses for a student (registered + all faculty courses + courses with results)
router.get('/student-courses/:id', authenticateToken, requireRole('control'), async (req, res) => {
  try {
    const studentId = req.params.id;
    // Get student's faculty
    const stuRes = await pool.query('SELECT faculty FROM students WHERE student_id = $1', [studentId]);
    const faculty = stuRes.rows[0]?.faculty;

    let query = `SELECT DISTINCT c.course_code, c.course_name, c.credit_hours, c.faculty
      FROM courses c
      LEFT JOIN course_selections cs ON cs.course_code = c.course_code AND cs.student_id = $1
      LEFT JOIN requests r ON cs.request_id = r.request_id AND r.status NOT IN ('Rejected','Returned for Modification')
      LEFT JOIN results res ON res.course = c.course_code AND res.student_id = $1
      WHERE c.is_active = true`;

    const params = [studentId];
    let idx = 2;
    if (faculty) {
      query += ` AND (c.faculty = $${idx} OR cs.student_id = $${idx} OR res.student_id = $${idx})`;
      params.push(faculty);
      idx++;
    } else {
      query += ` AND (cs.student_id = $${idx} OR res.student_id = $${idx})`;
      params.push(studentId);
      idx++;
    }
    query += ' ORDER BY c.course_code';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) { console.error('student-courses error:', err); res.status(500).json({ error: 'Server error' }); }
});

// Save individual course result
router.post('/save-result', authenticateToken, requireRole('control'), async (req, res) => {
  try {
    const { studentId, course, year, semester, resultType, midtermGrade, finalGrade, coursework, faculty } = req.body;
    if (!studentId || !course || !year || !semester) return res.status(400).json({ error: 'studentId, course, year, semester required' });
    const rType = resultType || 'final';

    const mg = parseFloat(midtermGrade) || 0;
    const fg = parseFloat(finalGrade) || 0;
    const cw = parseFloat(coursework) || 0;
    const hasMG = midtermGrade !== null && midtermGrade !== undefined && midtermGrade !== '';
    const hasFG = finalGrade !== null && finalGrade !== undefined && finalGrade !== '';
    const hasCW = coursework !== null && coursework !== undefined && coursework !== '';

    let calculatedGrade = null;
    if (hasMG && hasFG) {
      calculatedGrade = (mg * 0.3 + cw * 0.1 + fg * 0.6).toFixed(1);
    } else if (hasFG) {
      calculatedGrade = fg.toFixed(1);
    } else if (hasMG) {
      calculatedGrade = mg.toFixed(1);
    } else if (hasCW) {
      calculatedGrade = cw.toFixed(1);
    }

    await pool.query(
      `INSERT INTO results (student_id, course, grade, result_type, year, semester, midterm_grade, final_grade, coursework, faculty)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (student_id, course, result_type, year, semester)
       DO UPDATE SET midterm_grade = $7, final_grade = $8, coursework = $9, grade = $3, faculty = $10`,
      [studentId, course, calculatedGrade, rType, year, semester, midtermGrade || null, finalGrade || null, coursework || null, faculty || null]
    );
    res.json({ message: 'Result saved', calculatedGrade, success: true });
  } catch (err) { console.error('save-result error:', err.message); res.status(500).json({ error: 'Server error' }); }
});

// Get all results for a student (for viewing), optional year/semester filter
router.get('/student-results/:id', authenticateToken, requireRole('control'), async (req, res) => {
  try {
    const { year, semester, resultType } = req.query;
    let query = 'SELECT * FROM results WHERE student_id = $1';
    const params = [req.params.id];
    let idx = 2;
    if (year) { query += ` AND year = $${idx++}`; params.push(year); }
    if (semester) { query += ` AND semester = $${idx++}`; params.push(semester); }
    if (resultType) { query += ` AND result_type = $${idx++}`; params.push(resultType); }
    query += ' ORDER BY year DESC, semester DESC, course';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Bulk save results
router.post('/save-results-bulk', authenticateToken, requireRole('control'), async (req, res) => {
  try {
    const { results } = req.body;
    if (!results || !Array.isArray(results)) return res.status(400).json({ error: 'results array required' });
    let saved = 0, errors = [];
    for (const r of results) {
      try {
        const { studentId, course, year, semester, resultType, midtermGrade, finalGrade, coursework, faculty } = r;
        const rType = resultType || 'final';
        const mg = parseFloat(midtermGrade) || 0;
        const fg = parseFloat(finalGrade) || 0;
        const cw = parseFloat(coursework) || 0;
        const hasMG = midtermGrade != null && midtermGrade !== '';
        const hasFG = finalGrade != null && finalGrade !== '';
        const hasCW = coursework != null && coursework !== '';

        let calculatedGrade = null;
        if (hasMG && hasFG) { calculatedGrade = (mg * 0.3 + cw * 0.1 + fg * 0.6).toFixed(1); }
        else if (hasFG) { calculatedGrade = fg.toFixed(1); }
        else if (hasMG) { calculatedGrade = mg.toFixed(1); }
        else if (hasCW) { calculatedGrade = cw.toFixed(1); }
        await pool.query(
          `INSERT INTO results (student_id, course, grade, result_type, year, semester, midterm_grade, final_grade, coursework, faculty)
           VALUES ($1,$2,$3,'final',$4,$5,$6,$7,$8,$9)
           ON CONFLICT (student_id, course, result_type, year, semester)
           DO UPDATE SET midterm_grade = $6, final_grade = $7, coursework = $8, grade = $3, faculty = $9`,
          [studentId, course, calculatedGrade, year, semester, midtermGrade || null, finalGrade || null, coursework || null, faculty || null]
        );
        saved++;
      } catch (e) { errors.push(r.course + ': ' + e.message); }
    }
    res.json({ message: `Saved ${saved} results`, errors: errors.slice(0, 10), success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});
