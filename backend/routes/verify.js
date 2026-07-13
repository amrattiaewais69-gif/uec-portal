const express = require('express');
const pool = require('../config/database');

const router = express.Router();

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const studentResult = await pool.query('SELECT student_id, name FROM students WHERE student_id = $1', [id]);
    if (studentResult.rows.length === 0) return res.status(404).json({ error: 'Student not found' });

    const coursesResult = await pool.query('SELECT course, grade FROM results WHERE student_id = $1 ORDER BY course', [id]);
    const courses = {};
    coursesResult.rows.forEach(row => { courses[row.course] = row.grade; });

    const gpa = studentResult.rows[0].gpa || '0.00';
    res.json({ id: studentResult.rows[0].student_id, name: studentResult.rows[0].name, courses, gpa: parseFloat(gpa).toFixed(2) });
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
