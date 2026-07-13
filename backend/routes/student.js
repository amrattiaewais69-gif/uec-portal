const express = require('express');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get student results by type
router.get('/results', authenticateToken, async (req, res) => {
  try {
    const studentId = req.user.id;
    const resultType = req.query.type || 'midterm';
    const studentResult = await pool.query('SELECT student_id, name, gpa, faculty FROM students WHERE student_id = $1', [studentId]);
    if (studentResult.rows.length === 0) return res.status(404).json({ error: 'Student not found' });

    const coursesResult = await pool.query('SELECT course, grade FROM results WHERE student_id = $1 AND result_type = $2 ORDER BY course', [studentId, resultType]);
    const courses = {};
    coursesResult.rows.forEach(row => { courses[row.course] = row.grade; });

    const storedGpa = studentResult.rows[0].gpa;
    const gpa = storedGpa !== null ? parseFloat(storedGpa).toFixed(2) : '0.00';

    res.json({ id: studentId, name: studentResult.rows[0].name, faculty: studentResult.rows[0].faculty, courses, gpa, resultType });
  } catch (err) {
    console.error('Get results error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get student photo
router.get('/photo', authenticateToken, async (req, res) => {
  try {
    const studentId = req.user.id;
    const result = await pool.query('SELECT photo_url FROM students WHERE student_id = $1', [studentId]);
    res.json({ photoUrl: result.rows[0]?.photo_url || null });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get registration open status
router.get('/reg-status', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query("SELECT value FROM settings WHERE key = 'registration_open'");
    const open = result.rows.length > 0 ? result.rows[0].value === 'true' : false;
    res.json({ open });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Registration dashboard
router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    const studentId = req.user.id;
    const { rows: students } = await pool.query('SELECT * FROM students WHERE student_id = $1', [studentId]);
    if (students.length === 0) return res.json({ error: 'Student not found' });
    const student = students[0];

    const { rows: sups } = await pool.query('SELECT * FROM supervisors WHERE supervisor_id = $1', [student.supervisor_id]);
    const supervisor = sups[0];

    const { rows: courses } = await pool.query('SELECT * FROM courses WHERE LOWER(faculty) = LOWER($1) AND is_active = TRUE', [student.faculty || '']);

    const { rows: failedRows } = await pool.query('SELECT course_code FROM failed_courses WHERE student_id = $1', [studentId]);
    const failedCourseCodes = failedRows.map(r => r.course_code);

    const { rows: selections } = await pool.query(`
      SELECT cs.course_code FROM course_selections cs
      JOIN requests r ON cs.request_id = r.request_id
      WHERE r.status NOT IN ('Rejected', 'Returned for Modification')
    `);

    const occupancyMap = {};
    courses.forEach(c => { occupancyMap[c.course_code] = 0; });
    selections.forEach(sel => {
      if (occupancyMap[sel.course_code] !== undefined) occupancyMap[sel.course_code]++;
    });

    const availableCourses = courses
      .filter(c => failedCourseCodes.includes(c.course_code))
      .map(c => ({
        courseCode: c.course_code, courseName: c.course_name,
        creditHours: Number(c.credit_hours), maxSeats: Number(c.max_seats),
        availableSeats: Number(c.max_seats) - (occupancyMap[c.course_code] || 0),
        feePerCredit: Number(c.fee_per_credit)
      }));

    const { rows: requests } = await pool.query('SELECT * FROM requests WHERE student_id = $1', [studentId]);
    const studentRequest = requests[0] || null;

    let currentSelection = [];
    if (studentRequest) {
      const { rows: sels } = await pool.query('SELECT course_code FROM course_selections WHERE request_id = $1', [studentRequest.request_id]);
      currentSelection = sels.map(s => s.course_code);
    }

    return res.json({
      studentInfo: { id: student.student_id, name: student.name, level: student.academic_level, supervisorName: supervisor ? supervisor.name : 'N/A', faculty: student.faculty || '---' },
      courses: availableCourses,
      currentRequest: studentRequest
        ? { requestId: studentRequest.request_id, status: studentRequest.status, comments: studentRequest.supervisor_comments, totalCredits: studentRequest.total_credits, totalFees: Number(studentRequest.total_fees) }
        : { status: 'Draft', totalCredits: 0, totalFees: 0 },
      selectedCourses: currentSelection
    });
  } catch (error) {
    console.error('Student dashboard error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Submit registration
router.post('/submitRegistration', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { courses: courseCodes } = req.body;
    const studentId = req.user.id;

    if (!courseCodes || courseCodes.length === 0) {
      await client.query('ROLLBACK');
      return res.json({ error: 'No courses selected' });
    }

    let totalCredits = 0, totalFees = 0;
    for (const code of courseCodes) {
      const { rows } = await client.query('SELECT * FROM courses WHERE course_code = $1', [code]);
      if (rows.length === 0) { await client.query('ROLLBACK'); return res.json({ error: 'Invalid Course: ' + code }); }
      totalCredits += Number(rows[0].credit_hours);
      totalFees += Number(rows[0].credit_hours) * Number(rows[0].fee_per_credit);
    }

    const maxCredits = parseInt(process.env.MAX_CREDIT_HOURS) || 10;
    if (totalCredits > maxCredits) { await client.query('ROLLBACK'); return res.json({ error: `Max ${maxCredits} Credit Hours allowed` }); }

    const { rows: existingReqs } = await client.query('SELECT * FROM requests WHERE student_id = $1', [studentId]);
    let requestId;

    if (existingReqs.length > 0) {
      requestId = existingReqs[0].request_id;
      await client.query('DELETE FROM course_selections WHERE request_id = $1', [requestId]);
      await client.query('UPDATE requests SET total_credits = $1, total_fees = $2, status = $3, supervisor_comments = NULL, reference_number = NULL, payment_date = NULL WHERE request_id = $4', [totalCredits, totalFees, 'Submitted', requestId]);
    } else {
      requestId = uuidv4();
      await client.query('INSERT INTO requests (request_id, student_id, total_credits, total_fees, status) VALUES ($1, $2, $3, $4, $5)', [requestId, studentId, totalCredits, totalFees, 'Submitted']);
    }

    for (const code of courseCodes) {
      await client.query('INSERT INTO course_selections (selection_id, request_id, student_id, course_code) VALUES ($1, $2, $3, $4)', [uuidv4(), requestId, studentId, code]);
    }

    await client.query('INSERT INTO approval_history (history_id, request_id, actor_identifier, actor_role, action, comments) VALUES ($1, $2, $3, $4, $5, $6)', [uuidv4(), requestId, req.user.name, 'Student', 'Submit', 'Registration finalized by Student.']);

    await client.query('COMMIT');
    return res.json({ message: 'Application sent to your advisor' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Submit error:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// Appeal courses
router.get('/appeal-courses', authenticateToken, async (req, res) => {
  try {
    const studentId = req.user.id;
    const settings = await pool.query("SELECT value FROM settings WHERE key = 'appeal_deadline'");
    if (settings.rows.length > 0 && settings.rows[0].value) {
      if (new Date() > new Date(settings.rows[0].value)) {
        return res.json({ status: 'closed', message: 'Appeal deadline has passed' });
      }
    }
    const result = await pool.query(`
      SELECT DISTINCT p.course FROM appeal_payments p
      WHERE p.student_id = $1
      AND NOT EXISTS (SELECT 1 FROM appeals a WHERE a.student_id = $1 AND a.course = p.course AND a.status NOT IN ('Revised without change'))
      ORDER BY p.course
    `, [studentId]);
    res.json({ status: 'open', courses: result.rows.map(r => r.course) });
  } catch (err) {
    console.error('Get appeal courses error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Submit appeal
router.post('/appeal', authenticateToken, async (req, res) => {
  try {
    const studentId = req.user.id;
    const studentName = req.user.name;
    const { course, reason } = req.body;
    if (!course || !reason) return res.status(400).json({ error: 'Course and reason required' });

    const settings = await pool.query("SELECT value FROM settings WHERE key = 'appeal_deadline'");
    if (settings.rows.length > 0 && settings.rows[0].value) {
      if (new Date() > new Date(settings.rows[0].value)) return res.status(400).json({ error: 'Appeal deadline has passed' });
    }

    const existing = await pool.query("SELECT id FROM appeals WHERE student_id = $1 AND course = $2 AND status NOT IN ('Revised without change')", [studentId, course]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Already have an active appeal for this course' });

    await pool.query('INSERT INTO appeals (student_id, student_name, course, reason) VALUES ($1, $2, $3, $4)', [studentId, studentName, course, reason]);
    res.json({ message: 'Appeal submitted successfully' });
  } catch (err) {
    console.error('Submit appeal error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get appeal history
router.get('/appeals', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT course, reason, status, date FROM appeals WHERE student_id = $1 ORDER BY date DESC', [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    console.error('Get appeals error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
