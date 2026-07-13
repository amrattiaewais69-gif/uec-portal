const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_NvLgtK5oaW0G@ep-proud-moon-atj31h3z.c-9.us-east-1.aws.neon.tech/neondb_portal?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

async function seed() {
  console.log('Seeding sample data...\n');

  // Sample students
  const students = [
    { id: '25100001', name: 'Ahmed Mohamed', faculty: 'Medicine' },
    { id: '25100002', name: 'Sara Ali', faculty: 'Medicine' },
    { id: '25100003', name: 'Omar Hassan', faculty: 'Dentistry' },
  ];

  for (const s of students) {
    const hash = await bcrypt.hash(s.id, 10);
    await pool.query(
      'INSERT INTO students (student_id, name, password_hash, first_login, faculty) VALUES ($1, $2, $3, true, $4) ON CONFLICT (student_id) DO NOTHING',
      [s.id, s.name, hash, s.faculty]
    );
    console.log('✓ Student:', s.id, '/', s.name);
  }

  // Sample courses
  const courses = [
    { code: 'PATH401', name: 'Foundations of Pathology', credits: 3, seats: 50, fee: 0, faculty: 'Medicine' },
    { code: 'INFE401', name: 'Foundations of Infections & Infestations', credits: 3, seats: 50, fee: 0, faculty: 'Medicine' },
    { code: 'PHAR401', name: 'Foundations of Pharmacology', credits: 3, seats: 50, fee: 0, faculty: 'Medicine' },
    { code: 'IMMU401', name: 'Foundations of Immunology', credits: 3, seats: 50, fee: 0, faculty: 'Medicine' },
  ];

  for (const c of courses) {
    await pool.query(
      'INSERT INTO courses (course_code, course_name, credit_hours, max_seats, fee_per_credit, faculty) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (course_code) DO NOTHING',
      [c.code, c.name, c.credits, c.seats, c.fee, c.faculty]
    );
    console.log('✓ Course:', c.code, '/', c.name);
  }

  // Sample results
  const results = [
    { id: '25100001', course: 'Foundations of Pathology', grade: '18' },
    { id: '25100001', course: 'Foundations of Infections & Infestations', grade: '15' },
    { id: '25100001', course: 'Foundations of Pharmacology', grade: '20' },
    { id: '25100001', course: 'Foundations of Immunology', grade: '22' },
    { id: '25100002', course: 'Foundations of Pathology', grade: '12' },
    { id: '25100002', course: 'Foundations of Immunology', grade: '8' },
  ];

  for (const r of results) {
    await pool.query(
      'INSERT INTO results (student_id, course, grade) VALUES ($1, $2, $3) ON CONFLICT (student_id, course) DO UPDATE SET grade = $3',
      [r.id, r.course, r.grade]
    );
  }
  console.log('✓ Sample results added');

  // Sample supervisor
  const supHash = await bcrypt.hash('super123', 10);
  await pool.query(
    "INSERT INTO supervisors (supervisor_id, name, email, password_hash) VALUES ('sup001', 'Dr. Mohamed Supervisor', 'sup@uec.edu.eg', $1) ON CONFLICT (supervisor_id) DO NOTHING",
    [supHash]
  );
  console.log('✓ Supervisor: sup001 / super123');

  // Assign supervisor to students
  await pool.query("UPDATE students SET supervisor_id = 'sup001' WHERE student_id IN ('25100001', '25100002', '25100003')");
  console.log('✓ Supervisors assigned');

  // Sample failed courses (for registration system)
  await pool.query("INSERT INTO failed_courses (student_id, course_code) VALUES ('25100002', 'PATH401') ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO failed_courses (student_id, course_code) VALUES ('25100002', 'IMMU401') ON CONFLICT DO NOTHING");
  console.log('✓ Failed courses added for registration testing');

  console.log('\n=== Seed Complete ===');
  console.log('\nTest accounts:');
  console.log('  Student:   25100001 / 25100001 (Medicine)');
  console.log('  Student:   25100002 / 25100002 (Medicine - has failed courses)');
  console.log('  Student:   25100003 / 25100003 (Dentistry)');
  console.log('  Admin:     admin / Admin123');
  console.log('  Finance:   finance / Finance123');
  console.log('  Control:   control / Control123');
  console.log('  Supervisor: sup001 / super123');

  await pool.end();
}

seed();
