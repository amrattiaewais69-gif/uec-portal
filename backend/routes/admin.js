const express = require('express');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

function validatePassword(password) {
  if (!password || password.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least one special character';
  return null;
}

router.use(authenticateToken, requireRole('admin'));

// Upload results CSV
router.post('/upload-results', async (req, res) => {
  try {
    const { csvData } = req.body;
    if (!csvData) return res.status(400).json({ error: 'CSV data required' });

    const csv = require('csv-parse/sync');
    const records = csv.parse(csvData, { columns: true, skip_empty_lines: true, trim: true });

    let uploaded = 0, skipped = 0, errors = [];
    for (const row of records) {
      const studentId = row.student_id || row.id;
      const course = row.course || row.Course;
      const grade = row.grade || row.Grade;
      const name = row.name || row.Name || '';
      const gpa = row.gpa || row.GPA || null;

      if (!studentId || !course || !grade) { skipped++; continue; }

      try {
        if (name) {
          const existing = await pool.query('SELECT student_id FROM students WHERE student_id = $1', [studentId]);
          if (existing.rows.length === 0) {
            const hash = await bcrypt.hash(studentId.replace('-', ''), 10);
            await pool.query('INSERT INTO students (student_id, name, password_hash, first_login, gpa) VALUES ($1, $2, $3, true, $4) ON CONFLICT (student_id) DO UPDATE SET name = $2, gpa = $4', [studentId, name, hash, gpa || null]);
          } else if (gpa) {
            await pool.query('UPDATE students SET gpa = $1 WHERE student_id = $2', [gpa, studentId]);
          }
        }
        await pool.query('INSERT INTO results (student_id, course, grade) VALUES ($1, $2, $3) ON CONFLICT (student_id, course) DO UPDATE SET grade = $3', [studentId, course, grade]);
        uploaded++;
      } catch (e) { errors.push(`Row for ${studentId}: ${e.message}`); }
    }

    res.json({ message: `Uploaded ${uploaded} results, skipped ${skipped}`, errors: errors.slice(0, 10) });
  } catch (err) {
    console.error('Upload results error:', err);
    res.status(500).json({ error: 'Failed to process CSV' });
  }
});

// Accounts CRUD
router.get('/accounts', async (req, res) => {
  try {
    const result = await pool.query('SELECT username, role, display_name FROM users ORDER BY role, username');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/accounts', async (req, res) => {
  try {
    const { username, password, role, display_name } = req.body;
    if (!username || !password || !role) return res.status(400).json({ error: 'Username, password, and role required' });
    const validRoles = ['finance', 'accountant', 'control', 'admin'];
    if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });

    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const existing = await pool.query('SELECT username FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Username already exists' });

    const hash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (username, password_hash, role, display_name) VALUES ($1, $2, $3, $4)', [username, hash, role, display_name || '']);
    res.json({ message: 'Account created successfully' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.put('/accounts/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const { newUsername, role, display_name } = req.body;
    if (!newUsername && !role && display_name === undefined) return res.status(400).json({ error: 'Nothing to update' });

    if (newUsername && newUsername !== username) {
      const existing = await pool.query('SELECT username FROM users WHERE username = $1', [newUsername]);
      if (existing.rows.length > 0) return res.status(400).json({ error: 'Username already exists' });
      await pool.query('UPDATE users SET username = $1 WHERE username = $2', [newUsername, username]);
    }

    const targetUsername = newUsername || username;
    const validRoles = ['finance', 'accountant', 'control', 'admin'];
    if (role) {
      if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });
      await pool.query('UPDATE users SET role = $1 WHERE username = $2', [role, targetUsername]);
    }
    if (display_name !== undefined) {
      await pool.query('UPDATE users SET display_name = $1 WHERE username = $2', [display_name, targetUsername]);
    }
    res.json({ message: 'Account updated successfully' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/accounts/:username', async (req, res) => {
  try {
    const { username } = req.params;
    await pool.query('DELETE FROM users WHERE username = $1', [username]);
    await pool.query("INSERT INTO audit_log (log_id, actor, description) VALUES ($1, $2, $3)", [uuidv4(), req.user.username, 'Deleted account: ' + username]);
    res.json({ message: 'Account deleted' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Password resets
router.put('/accounts/:username/reset-password', async (req, res) => {
  try {
    const { username } = req.params;
    const { newPassword } = req.body;
    const passwordError = validatePassword(newPassword);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const hash = await bcrypt.hash(newPassword, 10);
    const result = await pool.query('UPDATE users SET password_hash = $1 WHERE username = $2', [hash, username]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Account not found' });
    await pool.query("INSERT INTO audit_log (log_id, actor, description) VALUES ($1, $2, $3)", [uuidv4(), req.user.username, 'Reset password for: ' + username]);
    res.json({ message: `Password reset for ${username}` });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.put('/students/:id/reset-password', async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    const passwordError = validatePassword(newPassword);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const hash = await bcrypt.hash(newPassword, 10);
    const result = await pool.query('UPDATE students SET password_hash = $1, first_login = true WHERE student_id = $2', [hash, id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Student not found' });
    res.json({ message: `Password reset for student ${id}` });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.put('/students/reset-all', async (req, res) => {
  try {
    const students = await pool.query('SELECT student_id FROM students');
    let count = 0;
    for (const row of students.rows) {
      const defaultPass = row.student_id.replace('-', '');
      const hash = await bcrypt.hash(defaultPass, 10);
      await pool.query('UPDATE students SET password_hash = $1, first_login = true WHERE student_id = $2', [hash, row.student_id]);
      count++;
    }
    res.json({ message: `Reset ${count} student passwords` });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Students
router.get('/students', async (req, res) => {
  try {
    const result = await pool.query('SELECT student_id, name, first_login, faculty, academic_level, supervisor_id FROM students ORDER BY student_id');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.put('/students/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, newId } = req.body;
    if (!name && !newId) return res.status(400).json({ error: 'Nothing to update' });

    if (newId && newId !== id) {
      const existing = await pool.query('SELECT student_id FROM students WHERE student_id = $1', [newId]);
      if (existing.rows.length > 0) return res.status(400).json({ error: 'Student ID already exists' });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('UPDATE students SET student_id = $1 WHERE student_id = $2', [newId, id]);
        await client.query('UPDATE results SET student_id = $1 WHERE student_id = $2', [newId, id]);
        await client.query('UPDATE appeals SET student_id = $1 WHERE student_id = $2', [newId, id]);
        await client.query('UPDATE appeal_payments SET student_id = $1 WHERE student_id = $2', [newId, id]);
        await client.query('UPDATE requests SET student_id = $1 WHERE student_id = $2', [newId, id]);
        await client.query('UPDATE course_selections SET student_id = $1 WHERE student_id = $2', [newId, id]);
        await client.query('UPDATE failed_courses SET student_id = $1 WHERE student_id = $2', [newId, id]);
        await client.query('UPDATE registration_payments SET student_id = $1 WHERE student_id = $2', [newId, id]);
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    }

    const targetId = newId || id;
    if (name) await pool.query('UPDATE students SET name = $1 WHERE student_id = $2', [name, targetId]);
    res.json({ message: 'Student updated successfully' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Settings
router.get('/settings', async (req, res) => {
  try {
    const result = await pool.query("SELECT key, value FROM settings WHERE key IN ('appeals_open', 'appeal_deadline')");
    const settings = {};
    result.rows.forEach(r => settings[r.key] = r.value);
    res.json(settings);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.put('/settings', async (req, res) => {
  try {
    const { appeal_deadline } = req.body;
    if (appeal_deadline !== undefined) {
      await pool.query("INSERT INTO settings (key, value) VALUES ('appeal_deadline', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [appeal_deadline]);
    }
    res.json({ message: 'Settings updated' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Supervisor management
router.get('/supervisors', async (req, res) => {
  try {
    const result = await pool.query('SELECT supervisor_id, name, email FROM supervisors ORDER BY supervisor_id');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/supervisors', async (req, res) => {
  try {
    const { supervisorId, name, email } = req.body;
    if (!supervisorId || !name) return res.status(400).json({ error: 'Supervisor ID and name required' });
    const existing = await pool.query('SELECT supervisor_id FROM supervisors WHERE supervisor_id = $1', [supervisorId]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Supervisor ID already exists' });
    const hash = await bcrypt.hash(supervisorId, 10);
    await pool.query('INSERT INTO supervisors (supervisor_id, name, email, password_hash) VALUES ($1, $2, $3, $4)', [supervisorId, name, email || null, hash]);
    res.json({ message: `Supervisor ${supervisorId} added. Password: ${supervisorId}` });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Course management
router.get('/courses', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM courses ORDER BY course_code');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/courses', async (req, res) => {
  try {
    const { courseCode, courseName, creditHours, maxSeats, feePerCredit, faculty } = req.body;
    if (!courseCode || !courseName) return res.status(400).json({ error: 'Course code and name required' });
    const existing = await pool.query('SELECT course_code FROM courses WHERE course_code = $1', [courseCode]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Course code already exists' });
    await pool.query('INSERT INTO courses (course_code, course_name, credit_hours, max_seats, fee_per_credit, faculty) VALUES ($1,$2,$3,$4,$5,$6)', [courseCode, courseName, creditHours || 0, maxSeats || 30, feePerCredit || 0, faculty || 'General']);
    res.json({ message: 'Course added' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Clear all
router.delete('/clear-all', async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM appeals');
      await client.query('DELETE FROM appeal_payments');
      await client.query('DELETE FROM results');
      await client.query('DELETE FROM course_selections');
      await client.query('DELETE FROM registration_payments');
      await client.query('DELETE FROM requests');
      await client.query('DELETE FROM failed_courses');
      await client.query('DELETE FROM students');
      await client.query("DELETE FROM settings WHERE key != 'appeal_deadline'");
      await client.query("INSERT INTO audit_log (log_id, actor, description) VALUES ($1, $2, $3)", [uuidv4(), req.user.username, 'Cleared all student data']);
      await client.query('COMMIT');
      res.json({ message: 'All student data cleared' });
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
