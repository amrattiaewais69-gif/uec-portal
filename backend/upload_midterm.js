const fetch = require('node-fetch');
const fs = require('fs');
const API = 'https://portal.uec.edu.eg/api';

async function main() {
  // Login as admin
  const loginRes = await fetch(`${API}/auth/account-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Admin123', loginType: 'admin' })
  });
  const loginData = await loginRes.json();
  const token = loginData.token;
  console.log('Logged in as admin');

  // Read CSV
  const raw = fs.readFileSync('C:\\Users\\AMR\\Downloads\\Results-Mid.csv', 'utf8');
  const lines = raw.trim().split('\n');
  const header = lines[0].split(',');

  // Find course columns (everything between Name and faculty)
  const nameIdx = header.indexOf('Name');
  const facultyIdx = header.indexOf('faculty');
  const courseColumns = [];
  for (let i = nameIdx + 1; i < facultyIdx; i++) {
    courseColumns.push({ idx: i, code: header[i].trim() });
  }
  console.log(`Courses found: ${courseColumns.map(c => c.code).join(', ')}`);

  // Transform to long format
  const longRows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Parse CSV carefully (handle commas in names)
    const parts = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { parts.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    parts.push(current.trim());

    const studentId = parts[0];
    const name = parts[nameIdx];
      const rawFaculty = parts[facultyIdx] || 'Medicine';
      const faculty = rawFaculty === 'Medicine' ? 'Faculty of Medicine' : rawFaculty;

    for (const course of courseColumns) {
      const grade = parts[course.idx];
      if (!grade || grade === '') continue;
      longRows.push({ student_id: studentId, name, course: course.code, grade, faculty });
    }
  }

  // Build CSV in long format
  const csvHeader = 'student_id,name,course,grade,faculty';
  const csvBody = longRows.map(r => {
    const escapedName = r.name.includes(',') ? `"${r.name}"` : r.name;
    return `${r.student_id},${escapedName},${r.course},${r.grade},${r.faculty}`;
  }).join('\n');
  const csvData = csvHeader + '\n' + csvBody;

  console.log(`\nTotal rows to upload: ${longRows.length} (${longRows.length / courseColumns.length} students x ${courseColumns.length} courses)`);

  // Upload via API
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
  const uploadRes = await fetch(`${API}/admin/upload-results`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      csvData,
      resultType: 'midterm',
      year: '2026',
      semester: 'spring'
    })
  });
  const uploadData = await uploadRes.json();
  console.log('\nUpload result:', JSON.stringify(uploadData, null, 2));
}

main().catch(console.error);
