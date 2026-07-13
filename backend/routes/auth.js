const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

function validatePassword(password) {
  if (!password || password.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least one special character (!@#$%^&*)';
  return null;
}

// Student login
router.post('/login', async (req, res) => {
  try {
    const { id, password } = req.body;
    if (!id || !password) return res.status(400).json({ error: 'Student ID and password required' });

    const result = await pool.query('SELECT * FROM students WHERE student_id = $1', [id]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const student = result.rows[0];
    const valid = await bcrypt.compare(password, student.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: student.student_id, name: student.name, role: 'student', firstLogin: student.first_login },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      student: { id: student.student_id, name: student.name, firstLogin: student.first_login, faculty: student.faculty }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Staff login (admin, finance, accountant, control, supervisor)
router.post('/account-login', async (req, res) => {
  try {
    const { username, password, loginType } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    // Check supervisors table
    if (loginType === 'supervisor') {
      const result = await pool.query('SELECT * FROM supervisors WHERE supervisor_id = $1', [username]);
      if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
      const sup = result.rows[0];
      const valid = await bcrypt.compare(password, sup.password_hash);
      if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
      const token = jwt.sign({ username: sup.supervisor_id, name: sup.name, role: 'supervisor' }, process.env.JWT_SECRET, { expiresIn: '8h' });
      return res.json({ token, role: 'supervisor', username: sup.supervisor_id, displayName: sup.name });
    }

    // Check users table
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, role: user.role, username: user.username, displayName: user.display_name || user.username });
  } catch (err) {
    console.error('Account login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Change password (student)
router.put('/change-password', authenticateToken, async (req, res) => {
  try {
    const { newPassword } = req.body;
    const passwordError = validatePassword(newPassword);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const result = await pool.query('SELECT student_id FROM students WHERE student_id = $1', [req.user.id]);
    if (result.rows.length > 0) {
      const cleanId = result.rows[0].student_id.replace('-', '');
      if (newPassword === result.rows[0].student_id || newPassword === cleanId) {
        return res.status(400).json({ error: 'New password cannot be your student ID' });
      }
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE students SET password_hash = $1, first_login = false WHERE student_id = $2', [hash, req.user.id]);
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Change password (staff)
router.put('/account-change-password', authenticateToken, async (req, res) => {
  try {
    const { newPassword } = req.body;
    const passwordError = validatePassword(newPassword);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const hash = await bcrypt.hash(newPassword, 10);

    // Try supervisors table first
    const supResult = await pool.query('SELECT supervisor_id FROM supervisors WHERE supervisor_id = $1', [req.user.username]);
    if (supResult.rows.length > 0) {
      await pool.query('UPDATE supervisors SET password_hash = $1 WHERE supervisor_id = $2', [hash, req.user.username]);
      return res.json({ message: 'Password updated successfully' });
    }

    await pool.query('UPDATE users SET password_hash = $1 WHERE username = $2', [hash, req.user.username]);
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('Account change password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
