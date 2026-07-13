const express = require('express');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

const RECEIPT_PREFIX = process.env.RECEIPT_PREFIX || 'UEC-2026-';
const RECEIPT_START_SEQ = parseInt(process.env.RECEIPT_START_SEQ) || 1001;

router.get('/dashboard', authenticateToken, requireRole('finance'), async (req, res) => {
  try {
    const { rows: requests } = await pool.query(`
      SELECT r.*, s.name as student_name, s.faculty
      FROM requests r JOIN students s ON r.student_id = s.student_id
      WHERE r.status IN ('Approved by Supervisor', 'Pending Payment', 'Partially Paid', 'Registered Successfully')
    `);

    const { rows: allPayments } = await pool.query("SELECT * FROM registration_payments WHERE status IN ('Verified', 'Settlement/Discount')");
    const { rows: allSelections } = await pool.query('SELECT cs.*, c.course_name FROM course_selections cs JOIN courses c ON cs.course_code = c.course_code');

    const financeRequests = requests.map(r => {
      const reqPayments = allPayments.filter(p => String(p.request_id) === String(r.request_id));
      const selCourses = allSelections.filter(sel => sel.request_id === r.request_id).map(sel => sel.course_name).join(' - ');
      let totalPaid = 0;
      reqPayments.forEach(p => { totalPaid += parseFloat(p.amount_paid) || 0; });
      let remaining = Number(r.total_fees) - totalPaid;
      let computedStatus = r.status;
      if (remaining <= 0) computedStatus = 'Registered Successfully';
      else if (totalPaid > 0) computedStatus = 'Partially Paid';

      return {
        requestId: r.request_id, studentId: r.student_id, studentName: r.student_name,
        faculty: r.faculty || 'General', totalFees: Number(r.total_fees),
        paidAmount: totalPaid, remainingAmount: remaining, status: computedStatus,
        courses: selCourses,
        paymentsHistory: reqPayments.map(p => ({ amount: Number(p.amount_paid), date: p.payment_date, receiptNo: p.receipt_no, method: p.payment_method, status: p.status }))
      };
    });

    return res.json({ requests: financeRequests });
  } catch (error) {
    console.error('Finance dashboard error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/processPayment', authenticateToken, requireRole('finance'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { requestId, amountToPay, refNum, paymentMethod, paymentDate, discountPercent, approvedBy } = req.body;

    const { rows } = await client.query('SELECT * FROM requests WHERE request_id = $1', [requestId]);
    if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Request not found' }); }
    const requestRow = rows[0];

    let paymentAmt = Number(amountToPay || 0);
    let discountPerc = Number(discountPercent || 0);
    let discountAmount = discountPerc > 0 ? Math.round(Number(requestRow.total_fees) * (discountPerc / 100)) : 0;

    const { rows: paidRows } = await client.query("SELECT COALESCE(SUM(amount_paid), 0)::numeric as total FROM registration_payments WHERE request_id = $1 AND status IN ('Verified', 'Settlement/Discount')", [requestId]);
    const totalPaidSoFar = parseFloat(paidRows[0].total) || 0;

    if ((totalPaidSoFar + paymentAmt + discountAmount) > Number(requestRow.total_fees)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Payment exceeds total fees' });
    }

    const pDate = paymentDate ? new Date(paymentDate) : new Date();
    const ref = refNum || 'N/A';
    const method = paymentMethod || 'N/A';
    const { rows: payCount } = await client.query('SELECT COUNT(*)::int as cnt FROM registration_payments');
    let nextSeq = RECEIPT_START_SEQ + payCount[0].cnt;
    let newReceiptNo = '';

    if (paymentAmt > 0) {
      newReceiptNo = RECEIPT_PREFIX + nextSeq;
      await client.query('INSERT INTO registration_payments (transaction_id, request_id, student_id, amount_paid, reference_number, payment_date, status, payment_method, receipt_no) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [uuidv4(), requestId, requestRow.student_id, paymentAmt, ref, pDate, 'Verified', method, newReceiptNo]);
      nextSeq++;
    }

    if (discountAmount > 0) {
      let discReceipt = RECEIPT_PREFIX + nextSeq;
      await client.query('INSERT INTO registration_payments (transaction_id, request_id, student_id, amount_paid, reference_number, payment_date, status, payment_method, receipt_no) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [uuidv4(), requestId, requestRow.student_id, discountAmount, `Discount ${discountPerc}% - ${approvedBy}`, pDate, 'Settlement/Discount', 'Discount', discReceipt]);
      if (!newReceiptNo) newReceiptNo = discReceipt;
    }

    const newStatus = (totalPaidSoFar + paymentAmt + discountAmount) >= Number(requestRow.total_fees) ? 'Registered Successfully' : 'Partially Paid';
    await client.query('UPDATE requests SET status = $1, reference_number = $2, payment_date = $3 WHERE request_id = $4', [newStatus, ref !== 'N/A' ? ref : 'Discount Applied', pDate, requestId]);

    await client.query('COMMIT');
    return res.json({ message: 'Payment processed', receiptNo: newReceiptNo });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Finance action error:', error.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// Accountant: get student + record appeal payment
router.get('/student/:id', authenticateToken, requireRole('finance', 'accountant'), async (req, res) => {
  try {
    const { id } = req.params;
    const studentResult = await pool.query('SELECT student_id, name FROM students WHERE student_id = $1', [id]);
    if (studentResult.rows.length === 0) return res.status(404).json({ error: 'Student not found' });

    const coursesResult = await pool.query(`
      SELECT r.course, r.grade FROM results r
      WHERE r.student_id = $1
      AND NOT EXISTS (SELECT 1 FROM appeal_payments p WHERE p.student_id = $1 AND p.course = r.course)
      ORDER BY r.course
    `, [id]);

    const courses = {};
    coursesResult.rows.forEach(row => { courses[row.course] = row.grade; });
    res.json({ id: studentResult.rows[0].student_id, name: studentResult.rows[0].name, courses });
  } catch (err) {
    console.error('Get student error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/payment', authenticateToken, requireRole('finance', 'accountant'), async (req, res) => {
  try {
    const { studentId, course, amount } = req.body;
    if (!studentId || !course || !amount) return res.status(400).json({ error: 'Student ID, course, and amount required' });
    if (typeof amount !== 'number' || amount <= 0) return res.status(400).json({ error: 'Amount must be a positive number' });

    const existing = await pool.query('SELECT id FROM appeal_payments WHERE student_id = $1 AND course = $2', [studentId, course]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'This course has already been paid' });

    const studentResult = await pool.query('SELECT name FROM students WHERE student_id = $1', [studentId]);
    const studentName = studentResult.rows.length > 0 ? studentResult.rows[0].name : '';

    await pool.query('INSERT INTO appeal_payments (student_id, student_name, course, amount, recorded_by) VALUES ($1, $2, $3, $4, $5)', [studentId, studentName, course, amount, req.user.username]);
    res.json({ message: 'Payment saved successfully' });
  } catch (err) {
    console.error('Save payment error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/payments/export', authenticateToken, requireRole('finance', 'accountant'), async (req, res) => {
  try {
    const result = await pool.query("SELECT student_id, student_name, course, amount, COALESCE(recorded_by, 'Unknown') as recorded_by, TO_CHAR(date, 'YYYY-MM-DD HH24:MI:SS') as date FROM appeal_payments ORDER BY date DESC");
    let csv = '\uFEFFStudent ID,Student Name,Course,Amount,Recorded By,Date\n';
    result.rows.forEach(row => {
      const safeName = String(row.student_name || '').replace(/"/g, '""');
      csv += `${row.student_id},"${safeName}",${row.course},${row.amount},${row.recorded_by},${row.date}\n`;
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=UEC_Payments.csv');
    res.send(csv);
  } catch (err) {
    console.error('Export payments error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
