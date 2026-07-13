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
    if (!username || !role) return res.status(400).json({ error: 'Username and role required' });
    const validRoles = ['finance', 'control', 'admin'];
    if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });

    const actualPassword = password || username;
    const passwordError = validatePassword(actualPassword);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const existing = await pool.query('SELECT username FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Username already exists' });

    const hash = await bcrypt.hash(actualPassword, 10);
    await pool.query('INSERT INTO users (username, password_hash, role, display_name, first_login) VALUES ($1, $2, $3, $4, true)', [username, hash, role, display_name || '']);
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
    const validRoles = ['finance', 'control', 'admin'];
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
    const result = await pool.query('UPDATE users SET password_hash = $1, first_login = true WHERE username = $2', [hash, username]);
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

// Dashboard metrics
router.get('/metrics', async (req, res) => {
  try {
    const { rows: enrolled } = await pool.query("SELECT COUNT(*)::int as cnt FROM requests WHERE status = 'Registered Successfully'");
    const { rows: pendingApproval } = await pool.query("SELECT COUNT(*)::int as cnt FROM requests WHERE status = 'Submitted'");
    const { rows: pendingPayment } = await pool.query("SELECT COUNT(*)::int as cnt FROM requests WHERE status IN ('Approved by Supervisor','Pending Payment','Partially Paid')");
    const { rows: revenue } = await pool.query("SELECT COALESCE(SUM(amount_paid),0)::numeric as total FROM registration_payments WHERE status IN ('Verified','Settlement/Discount')");
    res.json({
      registeredStudents: enrolled[0].cnt,
      pendingApprovals: pendingApproval[0].cnt,
      pendingPayments: pendingPayment[0].cnt,
      totalRevenue: Number(revenue[0].total)
    });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Course allocation stats
router.get('/course-stats', async (req, res) => {
  try {
    const { rows: courses } = await pool.query('SELECT course_code, course_name, max_seats, credit_hours FROM courses ORDER BY course_code');
    const stats = [];
    for (const c of courses) {
      const { rows: count } = await pool.query('SELECT COUNT(DISTINCT student_id)::int as cnt FROM course_selections WHERE course_code = $1', [c.course_code]);
      const allocated = count[0].cnt;
      const pct = c.max_seats > 0 ? Math.round((allocated / c.max_seats) * 100) : 0;
      stats.push({ code: c.course_code, name: c.course_name, allocated, max: c.max_seats, credits: c.credit_hours, percentage: pct + '%' });
    }
    res.json(stats);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Export: Paid students (one row per payment)
router.get('/export/paid', async (req, res) => {
  try {
    const { rows: requests } = await pool.query(`
      SELECT r.request_id, r.student_id, s.name, r.total_credits, r.total_fees, r.status
      FROM requests r JOIN students s ON r.student_id = s.student_id
      WHERE r.status = 'Registered Successfully' ORDER BY r.student_id
    `);
    const { rows: allPayments } = await pool.query("SELECT * FROM registration_payments WHERE status IN ('Verified','Settlement/Discount') ORDER BY payment_date");
    const { rows: allSelections } = await pool.query('SELECT cs.request_id, c.course_name FROM course_selections cs JOIN courses c ON cs.course_code = c.course_code');

    let csv = '\uFEFFStudent ID,Student Name,Courses,Credits,Total Fees,Discount %,Discount Amount,Discount Approved By,Total Paid,Remaining Due,Payment Status,Status,Payment Method,Payment Amount,Payment Date,Receipt No\n';
    requests.forEach(r => {
      const reqPayments = allPayments.filter(p => String(p.request_id) === String(r.request_id));
      const courses = allSelections.filter(s => s.request_id === r.request_id).map(s => s.course_name).join(' - ');
      let discountPct = 0, discountAmt = 0, discountBy = '', totalPaidActual = 0;
      const paidPayments = [];
      reqPayments.forEach(p => {
        if (p.payment_method === 'Discount' || p.status === 'Settlement/Discount') {
          discountAmt += Number(p.amount_paid) || 0;
          const ref = p.reference_number || '';
          const m = ref.match(/^Discount\s+(\d+)%\s*-\s*(.+)$/);
          if (m) { discountPct = Number(m[1]); discountBy = m[2].trim(); }
        } else {
          totalPaidActual += Number(p.amount_paid) || 0;
          paidPayments.push(p);
        }
      });
      const remaining = Number(r.total_fees) - totalPaidActual - discountAmt;
      const settlementStatus = remaining <= 0 ? 'Settled' : 'Pending';
      if (paidPayments.length === 0) {
        csv += `"${r.student_id}","${r.name}","${courses}",${r.total_credits},${r.total_fees},${discountPct || 0},${discountAmt},"${discountBy}",${totalPaidActual},${remaining},"${settlementStatus}","${r.status}","","","",""\n`;
      } else {
        paidPayments.forEach(p => {
          const pDate = p.payment_date ? new Date(p.payment_date).toLocaleDateString('en-GB') : '';
          csv += `"${r.student_id}","${r.name}","${courses}",${r.total_credits},${r.total_fees},${discountPct || 0},${discountAmt},"${discountBy}",${totalPaidActual},${remaining},"${settlementStatus}","${r.status}","${p.payment_method}",${Number(p.amount_paid)},"${pDate}","${p.receipt_no}"\n`;
        });
      }
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=Paid_Students.csv');
    res.send(csv);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Export: Awaiting approval
router.get('/export/pending-approval', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.student_id, s.name, r.total_credits, r.total_fees, r.status, r.supervisor_comments,
        sup.name as supervisor_name
      FROM requests r
      JOIN students s ON r.student_id = s.student_id
      LEFT JOIN supervisors sup ON s.supervisor_id = sup.supervisor_id
      WHERE r.status = 'Submitted' ORDER BY r.student_id
    `);
    let csv = '\uFEFFStudent ID,Student Name,Credits,Total Fees,Status,Supervisor,Supervisor Comments\n';
    rows.forEach(r => { csv += `"${r.student_id}","${r.name}",${r.total_credits},${r.total_fees},"${r.status}","${r.supervisor_name||'N/A'}","${r.supervisor_comments||''}"\n`; });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=Pending_Approval.csv');
    res.send(csv);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Export: Approved & unpaid (one row per payment)
router.get('/export/unpaid', async (req, res) => {
  try {
    const { rows: requests } = await pool.query(`
      SELECT r.request_id, r.student_id, s.name, r.total_credits, r.total_fees, r.status
      FROM requests r JOIN students s ON r.student_id = s.student_id
      WHERE r.status IN ('Approved by Supervisor','Pending Payment','Partially Paid') ORDER BY r.student_id
    `);
    const { rows: allPayments } = await pool.query("SELECT * FROM registration_payments WHERE status IN ('Verified','Settlement/Discount') ORDER BY payment_date");
    const { rows: allSelections } = await pool.query('SELECT cs.request_id, c.course_name FROM course_selections cs JOIN courses c ON cs.course_code = c.course_code');

    let csv = '\uFEFFStudent ID,Student Name,Courses,Credits,Total Fees,Discount %,Discount Amount,Discount Approved By,Total Paid,Remaining Due,Payment Status,Status,Payment Method,Payment Amount,Payment Date,Receipt No\n';
    requests.forEach(r => {
      const reqPayments = allPayments.filter(p => String(p.request_id) === String(r.request_id));
      const courses = allSelections.filter(s => s.request_id === r.request_id).map(s => s.course_name).join(' - ');
      let discountPct = 0, discountAmt = 0, discountBy = '', totalPaidActual = 0;
      const paidPayments = [];
      reqPayments.forEach(p => {
        if (p.payment_method === 'Discount' || p.status === 'Settlement/Discount') {
          discountAmt += Number(p.amount_paid) || 0;
          const ref = p.reference_number || '';
          const m = ref.match(/^Discount\s+(\d+)%\s*-\s*(.+)$/);
          if (m) { discountPct = Number(m[1]); discountBy = m[2].trim(); }
        } else {
          totalPaidActual += Number(p.amount_paid) || 0;
          paidPayments.push(p);
        }
      });
      const remaining = Number(r.total_fees) - totalPaidActual - discountAmt;
      const settlementStatus = remaining <= 0 ? 'Settled' : 'Pending';
      if (paidPayments.length === 0) {
        csv += `"${r.student_id}","${r.name}","${courses}",${r.total_credits},${r.total_fees},${discountPct || 0},${discountAmt},"${discountBy}",${totalPaidActual},${remaining},"${settlementStatus}","${r.status}","","","",""\n`;
      } else {
        paidPayments.forEach(p => {
          const pDate = p.payment_date ? new Date(p.payment_date).toLocaleDateString('en-GB') : '';
          csv += `"${r.student_id}","${r.name}","${courses}",${r.total_credits},${r.total_fees},${discountPct || 0},${discountAmt},"${discountBy}",${totalPaidActual},${remaining},"${settlementStatus}","${r.status}","${p.payment_method}",${Number(p.amount_paid)},"${pDate}","${p.receipt_no}"\n`;
        });
      }
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=Approved_Unpaid.csv');
    res.send(csv);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Update course seats
router.post('/updateCourseSeats', async (req, res) => {
  try {
    const { courseCode, maxSeats } = req.body;
    if (!courseCode || maxSeats === undefined) return res.status(400).json({ error: 'courseCode and maxSeats required' });
    await pool.query('UPDATE courses SET max_seats = $1 WHERE course_code = $2', [maxSeats, courseCode]);
    res.json({ message: `Updated ${courseCode} max seats to ${maxSeats}`, success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Set student photo
router.post('/setPhoto', async (req, res) => {
  try {
    const { studentId, photoUrl } = req.body;
    if (!studentId) return res.status(400).json({ error: 'Student ID required' });
    await pool.query('UPDATE students SET photo_url = $1 WHERE student_id = $2', [photoUrl || null, studentId]);
    res.json({ message: `Photo updated for ${studentId}`, success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Generic password reset
router.post('/resetPassword', async (req, res) => {
  try {
    const { userId, role, newPassword } = req.body;
    if (!userId || !role || !newPassword) return res.status(400).json({ error: 'userId, role, and newPassword required' });
    const passwordError = validatePassword(newPassword);
    if (passwordError) return res.status(400).json({ error: passwordError });
    const hash = await bcrypt.hash(newPassword, 10);
    let result;
    if (role === 'student') {
      result = await pool.query('UPDATE students SET password_hash = $1, first_login = true WHERE student_id = $2', [hash, userId]);
    } else if (role === 'supervisor') {
      result = await pool.query('UPDATE supervisors SET password_hash = $1, first_login = true WHERE supervisor_id = $2', [hash, userId]);
    } else {
      result = await pool.query('UPDATE users SET password_hash = $1, first_login = true WHERE username = $2', [hash, userId]);
    }
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    await pool.query("INSERT INTO audit_log (log_id, actor, description) VALUES ($1, $2, $3)", [uuidv4(), req.user.username, `Reset password for ${role}: ${userId}`]);
    res.json({ message: `Password reset for ${userId}`, success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Bulk upload failed courses
router.post('/bulkFailedCourses', async (req, res) => {
  try {
    const { data } = req.body;
    if (!data || !Array.isArray(data)) return res.status(400).json({ error: 'data array required' });
    let inserted = 0, skipped = 0;
    for (const row of data) {
      const { studentId, courseCode } = row;
      if (!studentId || !courseCode) { skipped++; continue; }
      try {
        const exists = await pool.query('SELECT id FROM failed_courses WHERE student_id = $1 AND course_code = $2', [studentId, courseCode]);
        if (exists.rows.length > 0) { skipped++; continue; }
        await pool.query('INSERT INTO failed_courses (student_id, course_code) VALUES ($1, $2) ON CONFLICT DO NOTHING', [studentId, courseCode]);
        inserted++;
      } catch (e) { skipped++; }
    }
    res.json({ message: `Uploaded ${inserted} failed courses, skipped ${skipped}`, success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Bulk assign supervisors / create students
router.post('/bulkAssignSupervisors', async (req, res) => {
  try {
    const { data } = req.body;
    if (!data || !Array.isArray(data)) return res.status(400).json({ error: 'data array required' });
    let created = 0, updated = 0, skipped = 0;
    for (const row of data) {
      const { studentId, password, name, email, academicLevel, supervisorId, faculty } = row;
      if (!studentId || !name) { skipped++; continue; }
      try {
        const existing = await pool.query('SELECT student_id FROM students WHERE student_id = $1', [studentId]);
        if (existing.rows.length > 0) {
          if (supervisorId) await pool.query('UPDATE students SET supervisor_id = $1 WHERE student_id = $2', [supervisorId, studentId]);
          updated++;
        } else {
          const hash = await bcrypt.hash(password || studentId.replace(/-/g, ''), 10);
          await pool.query('INSERT INTO students (student_id, name, password_hash, first_login, email, academic_level, supervisor_id, faculty) VALUES ($1,$2,$3,true,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
            [studentId, name, hash, email || null, academicLevel || null, supervisorId || null, faculty || null]);
          created++;
        }
      } catch (e) { skipped++; }
    }
    res.json({ message: `Created ${created}, Updated ${updated}, Skipped ${skipped}`, success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Bulk update courses
router.post('/bulkUpdateCourses', async (req, res) => {
  try {
    const { data } = req.body;
    if (!data || !Array.isArray(data)) return res.status(400).json({ error: 'data array required' });
    let created = 0, updated = 0, skipped = 0;
    for (const row of data) {
      const { courseCode, courseName, creditHours, maxSeats, feePerCredit, faculty } = row;
      if (!courseCode) { skipped++; continue; }
      try {
        const existing = await pool.query('SELECT course_code FROM courses WHERE course_code = $1', [courseCode]);
        if (existing.rows.length > 0) {
          await pool.query('UPDATE courses SET course_name = COALESCE($1,course_name), credit_hours = COALESCE($2,credit_hours), max_seats = COALESCE($3,max_seats), fee_per_credit = COALESCE($4,fee_per_credit), faculty = COALESCE($5,faculty) WHERE course_code = $6',
            [courseName || null, creditHours ? Number(creditHours) : null, maxSeats ? Number(maxSeats) : null, feePerCredit ? Number(feePerCredit) : null, faculty || null, courseCode]);
          updated++;
        } else {
          await pool.query('INSERT INTO courses (course_code, course_name, credit_hours, max_seats, fee_per_credit, faculty) VALUES ($1,$2,$3,$4,$5,$6)',
            [courseCode, courseName || courseCode, Number(creditHours) || 3, Number(maxSeats) || 30, Number(feePerCredit) || 0, faculty || 'General']);
          created++;
        }
      } catch (e) { skipped++; }
    }
    res.json({ message: `Created ${created}, Updated ${updated}, Skipped ${skipped}`, success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Add single student
router.post('/addStudent', async (req, res) => {
  try {
    const { studentId, name, email, faculty, academicLevel, supervisorId } = req.body;
    if (!studentId || !name) return res.status(400).json({ error: 'Student ID and Name required' });
    const existing = await pool.query('SELECT student_id FROM students WHERE student_id = $1', [studentId]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Student ID already exists' });
    const hash = await bcrypt.hash(studentId.replace(/-/g, ''), 10);
    await pool.query('INSERT INTO students (student_id, name, password_hash, first_login, email, academic_level, supervisor_id, faculty) VALUES ($1,$2,$3,true,$4,$5,$6,$7)',
      [studentId, name, hash, email || null, academicLevel || null, supervisorId || null, faculty || null]);
    res.json({ message: `Student ${studentId} added. Default password: ${studentId}`, success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Add single supervisor
router.post('/addSupervisor', async (req, res) => {
  try {
    const { supervisorId, name, email } = req.body;
    if (!supervisorId || !name) return res.status(400).json({ error: 'Supervisor ID and Name required' });
    const existing = await pool.query('SELECT supervisor_id FROM supervisors WHERE supervisor_id = $1', [supervisorId]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Supervisor ID already exists' });
    const hash = await bcrypt.hash(supervisorId, 10);
    await pool.query('INSERT INTO supervisors (supervisor_id, name, email, password_hash, first_login) VALUES ($1,$2,$3,$4,true)', [supervisorId, name, email || null, hash]);
    res.json({ message: `Supervisor ${supervisorId} added. Default password: ${supervisorId}`, success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Add single user (finance/admin)
router.post('/addUser', async (req, res) => {
  try {
    const { username, role, email } = req.body;
    if (!username || !role) return res.status(400).json({ error: 'Username and role required' });
    const validRoles = ['finance', 'control', 'admin'];
    if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const existing = await pool.query('SELECT username FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Username already exists' });
    const defaultPwd = username;
    const hash = await bcrypt.hash(defaultPwd, 10);
    await pool.query('INSERT INTO users (username, password_hash, role, display_name, first_login) VALUES ($1,$2,$3,$4,true)', [username, hash, role, username]);
    res.json({ message: `User ${username} added. Default password: ${defaultPwd}`, success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ===== FACULTIES MANAGEMENT =====

router.get('/faculties', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM faculties ORDER BY name');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/faculties', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Faculty name required' });
    const existing = await pool.query('SELECT id FROM faculties WHERE name = $1', [name]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Faculty already exists' });
    await pool.query('INSERT INTO faculties (name) VALUES ($1)', [name]);
    res.json({ message: `Faculty "${name}" added`, success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/faculties/:name', async (req, res) => {
  try {
    const { name } = req.params;
    await pool.query('DELETE FROM faculties WHERE name = $1', [decodeURIComponent(name)]);
    res.json({ message: 'Faculty deleted', success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.put('/faculties/:name', async (req, res) => {
  try {
    const oldName = decodeURIComponent(req.params.name);
    const { newName } = req.body;
    if (!newName) return res.status(400).json({ error: 'New name required' });
    if (newName === oldName) return res.json({ message: 'No change', success: true });
    const existing = await pool.query('SELECT id FROM faculties WHERE name = $1', [newName]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Faculty "' + newName + '" already exists' });
    await pool.query('UPDATE faculties SET name = $1 WHERE name = $2', [newName, oldName]);
    await pool.query('UPDATE students SET faculty = $1 WHERE faculty = $2', [newName, oldName]);
    await pool.query('UPDATE courses SET faculty = $1 WHERE faculty = $2', [newName, oldName]);
    res.json({ message: 'Faculty renamed to "' + newName + '"', success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.put('/faculties/:name/toggle', async (req, res) => {
  try {
    const { name } = req.params;
    const { field } = req.body;
    const allowed = ['reg_open', 'midterm_visible', 'final_visible', 'summer_visible'];
    if (!allowed.includes(field)) return res.status(400).json({ error: 'Invalid field' });
    const decoded = decodeURIComponent(name);
    const result = await pool.query(`UPDATE faculties SET ${field} = NOT ${field} WHERE name = $1 RETURNING *`, [decoded]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Faculty not found' });
    res.json({ message: 'Updated', faculty: result.rows[0], success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ===== UPLOAD RESULTS (with result_type + faculty filtering) =====

router.post('/upload-results', async (req, res) => {
  try {
    const { csvData, resultType, faculty } = req.body;
    if (!csvData) return res.status(400).json({ error: 'CSV data required' });
    const type = resultType || 'midterm';

    const csv = require('csv-parse/sync');
    const records = csv.parse(csvData, { columns: true, skip_empty_lines: true, trim: true });

    let uploaded = 0, skipped = 0, errors = [];
    for (const row of records) {
      const studentId = row.student_id || row.id;
      const course = row.course || row.Course;
      const grade = row.grade || row.Grade;
      const name = row.name || row.Name || '';
      const gpa = row.gpa || row.GPA || null;
      const studentFaculty = row.faculty || row.Faculty || faculty || '';

      if (!studentId || !course || !grade) { skipped++; continue; }

      // If faculty filter is set, skip students not in that faculty
      if (faculty && studentFaculty && studentFaculty.toLowerCase() !== faculty.toLowerCase()) {
        skipped++; continue;
      }

      try {
        if (name) {
          const existing = await pool.query('SELECT student_id FROM students WHERE student_id = $1', [studentId]);
          if (existing.rows.length === 0) {
            const hash = await bcrypt.hash(studentId.replace('-', ''), 10);
            await pool.query('INSERT INTO students (student_id, name, password_hash, first_login, gpa, faculty) VALUES ($1, $2, $3, true, $4, $5) ON CONFLICT (student_id) DO UPDATE SET name = $2, gpa = $4',
              [studentId, name, hash, gpa || null, studentFaculty || null]);
          } else if (gpa) {
            await pool.query('UPDATE students SET gpa = $1 WHERE student_id = $2', [gpa, studentId]);
          }
        }
        await pool.query(
          'INSERT INTO results (student_id, course, grade, result_type) VALUES ($1, $2, $3, $4) ON CONFLICT (student_id, course, result_type) DO UPDATE SET grade = $3',
          [studentId, course, grade, type]
        );
        uploaded++;
      } catch (e) { errors.push(`Row for ${studentId}: ${e.message}`); }
    }

    res.json({ message: `Uploaded ${uploaded} ${type} results, skipped ${skipped}`, errors: errors.slice(0, 10) });
  } catch (err) {
    console.error('Upload results error:', err);
    res.status(500).json({ error: 'Failed to process CSV' });
  }
});

module.exports = router;
