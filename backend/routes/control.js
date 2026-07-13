const express = require('express');
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

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
