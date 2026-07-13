const express = require('express');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/dashboard', authenticateToken, requireRole('supervisor'), async (req, res) => {
  try {
    const supervisorId = req.user.username;
    const { rows: sups } = await pool.query('SELECT * FROM supervisors WHERE supervisor_id = $1', [supervisorId]);
    if (sups.length === 0) return res.status(403).json({ error: 'Access denied' });

    const { rows: assignedStudents } = await pool.query('SELECT * FROM students WHERE supervisor_id = $1', [supervisorId]);
    if (assignedStudents.length === 0) return res.json({ supervisorName: sups[0].name, requests: [] });

    const studentIds = assignedStudents.map(s => s.student_id);
    const { rows: requests } = await pool.query(`
      SELECT r.*, s.name as student_name, s.academic_level FROM requests r
      JOIN students s ON r.student_id = s.student_id WHERE r.student_id = ANY($1)
    `, [studentIds]);

    const { rows: allSelections } = await pool.query('SELECT cs.*, c.course_name FROM course_selections cs JOIN courses c ON cs.course_code = c.course_code');
    const { rows: allFailed } = await pool.query('SELECT fc.*, c.course_name FROM failed_courses fc JOIN courses c ON fc.course_code = c.course_code');

    const detailedRequests = requests.map(r => {
      const selCourses = allSelections.filter(sel => sel.request_id === r.request_id).map(sel => `${sel.course_name} (${sel.course_code})`);
      const failedList = allFailed.filter(f => f.student_id === r.student_id).map(f => `${f.course_name} (${f.course_code})`);
      return {
        requestId: r.request_id, studentId: r.student_id, studentName: r.student_name,
        level: r.academic_level, totalCredits: r.total_credits, totalFees: Number(r.total_fees),
        status: r.status, comments: r.supervisor_comments,
        courses: selCourses.join(', '), failedCourses: failedList.length > 0 ? failedList.join(', ') : 'None'
      };
    });

    return res.json({ supervisorName: sups[0].name, requests: detailedRequests });
  } catch (error) {
    console.error('Supervisor dashboard error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/processAction', authenticateToken, requireRole('supervisor'), async (req, res) => {
  try {
    const { requestId, action, comments } = req.body;
    if (!requestId || !action) return res.status(400).json({ error: 'Request ID and action required' });

    const { rows } = await pool.query('SELECT * FROM requests WHERE request_id = $1', [requestId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Request not found' });

    let nextStatus = '';
    if (action === 'Approve') nextStatus = 'Approved by Supervisor';
    else if (action === 'Reject') nextStatus = 'Rejected';
    else if (action === 'Return') nextStatus = 'Returned for Modification';
    else return res.status(400).json({ error: 'Invalid action' });

    await pool.query('UPDATE requests SET status = $1, supervisor_comments = $2 WHERE request_id = $3', [nextStatus, comments || null, requestId]);
    await pool.query('INSERT INTO approval_history (history_id, request_id, actor_identifier, actor_role, action, comments) VALUES ($1, $2, $3, $4, $5, $6)', [uuidv4(), requestId, req.user.username, 'Supervisor', action, comments]);

    return res.json({ message: 'Application updated' });
  } catch (error) {
    console.error('Supervisor action error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
