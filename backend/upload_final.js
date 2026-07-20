const fetch = require('node-fetch');
const fs = require('fs');
const API = 'https://portal.uec.edu.eg/api';

async function main() {
  const loginRes = await fetch(`${API}/auth/account-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Admin123', loginType: 'admin' })
  });
  const loginData = await loginRes.json();
  const token = loginData.token;
  console.log('Logged in as admin');

  const raw = fs.readFileSync('D:\\East Capital\\ALL Project\\Summer Course Registration\\upload file\\Results-test final.csv', 'utf8');
  const lines = raw.trim().split('\n');
  const header = lines[0].split(',');

  const nameIdx = header.indexOf('Name');
  const facultyIdx = header.indexOf('faculty');
  const courseColumns = [];
  for (let i = nameIdx + 1; i < facultyIdx; i++) {
    courseColumns.push({ idx: i, code: header[i].trim() });
  }
  console.log(`Courses: ${courseColumns.map(c => c.code).join(', ')}`);

  const longRows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(',').map(p => p.trim());

    let studentId = parts[0].replace(/-/g, '');
    const name = parts[nameIdx];
    const rawFaculty = parts[facultyIdx] || 'Medicine';
    const faculty = rawFaculty === 'Medicine' ? 'Faculty of Medicine' : rawFaculty;

    for (const course of courseColumns) {
      const grade = parts[course.idx];
      if (!grade || grade === '') continue;
      longRows.push({ student_id: studentId, name, course: course.code, grade, faculty });
    }
  }

  const csvHeader = 'student_id,name,course,grade,faculty';
  const csvBody = longRows.map(r => `${r.student_id},${r.name},${r.course},${r.grade},${r.faculty}`).join('\n');
  const csvData = csvHeader + '\n' + csvBody;

  console.log(`\nTotal rows: ${longRows.length} (${longRows.length / courseColumns.length} students x ${courseColumns.length} courses)`);
  console.log('Sample rows:');
  longRows.slice(0, 6).forEach(r => console.log(`  ${r.student_id} | ${r.course} | ${r.grade} | ${r.faculty}`));

  const uploadRes = await fetch(`${API}/admin/upload-results`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      csvData,
      resultType: 'final',
      year: '2026',
      semester: 'spring'
    })
  });
  const uploadData = await uploadRes.json();
  console.log('\nUpload result:', JSON.stringify(uploadData, null, 2));
}

main().catch(console.error);
