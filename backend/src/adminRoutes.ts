import bcrypt from "bcryptjs";
import { Router } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { requireAuth, requireRole } from "./auth.js";
import { pool } from "./db.js";
import { gradeForScore } from "./grading.js";

const router = Router();

interface DepartmentRow extends RowDataPacket {
  id: number;
  name: string;
  code: string;
  program_years: number | null;
}

interface DepartmentProgramRow extends RowDataPacket {
  program_years: number | null;
}

interface CourseDepartmentRow extends DepartmentProgramRow {
  department_id: number;
}

interface CourseRow extends RowDataPacket {
  id: number;
  code: string;
  name: string;
  credit_hours: number;
  department_id: number;
  department_name: string;
}

interface CurriculumRow extends RowDataPacket {
  course_id: number;
  study_year: number;
  semester: string;
}

interface GradeReportCellRow extends RowDataPacket {
  course_id: number;
  course_code: string;
  course_name: string;
  credit_hours: number;
  enrollment_id: number | null;
  student_user_id: number;
  full_name: string;
  student_number: string;
  score: number | null;
}

interface StudentRow extends RowDataPacket {
  id: number;
  full_name: string;
  student_number: string;
  department_id: number | null;
  department_name: string | null;
  study_year: number | null;
  current_academic_year: string | null;
  current_semester: string | null;
  section: string | null;
}

interface StudentCountRow extends RowDataPacket {
  student_count: number;
}

interface EnrollmentRow extends RowDataPacket {
  id: number;
  student_user_id: number;
  student_name: string;
  student_number: string;
  course_code: string;
  course_name: string;
  credit_hours: number;
  academic_year: string;
  semester: string;
  status: "enrolled" | "dropped";
  score: number | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDuplicateEntry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ER_DUP_ENTRY"
  );
}

function isMissingReference(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ER_NO_REFERENCED_ROW_2"
  );
}

function isReferencedRecord(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ER_ROW_IS_REFERENCED_2"
  );
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function requiredText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();
  return text.length > 0 && text.length <= maximumLength ? text : null;
}

async function syncDepartmentEnrollments(
  connection: PoolConnection,
  departmentId: number,
  studentUserId?: number,
): Promise<number> {
  const studentFilter = studentUserId === undefined ? "" : "AND sp.user_id = ?";
  const parameters = studentUserId === undefined
    ? [departmentId]
    : [departmentId, studentUserId];
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT IGNORE INTO course_enrollments
      (student_user_id, course_id, academic_year, semester)
     SELECT sp.user_id, c.id, sp.current_academic_year, sp.current_semester
     FROM student_profiles sp
     JOIN courses c ON c.department_id = sp.department_id
     JOIN department_curriculum cc
       ON cc.course_id = c.id
       AND cc.study_year = sp.study_year
       AND cc.semester = sp.current_semester
     WHERE sp.department_id = ?
       AND sp.current_academic_year IS NOT NULL
       AND sp.current_semester IN ('Semester 1', 'Semester 2')
       ${studentFilter}`,
    parameters,
  );
  return result.affectedRows;
}

router.use(requireAuth, requireRole("admin"));

router.get("/overview", async (_request, response) => {
  const [departmentsResult, coursesResult, curriculumResult, studentCountResult] =
    await Promise.all([
      pool.execute<DepartmentRow[]>(
        "SELECT id, name, code, program_years FROM departments ORDER BY name",
      ),
      pool.execute<CourseRow[]>(
        `SELECT c.id, c.code, c.name, c.credit_hours, c.department_id,
          d.name AS department_name
         FROM courses c
         JOIN departments d ON d.id = c.department_id
         ORDER BY d.name, c.code`,
      ),
      pool.execute<CurriculumRow[]>(
        `SELECT cc.course_id, cc.study_year, cc.semester
         FROM department_curriculum cc
         JOIN courses c ON c.id = cc.course_id
         JOIN departments d ON d.id = c.department_id
         ORDER BY d.name, cc.study_year, cc.semester, c.code`,
      ),
      pool.execute<StudentCountRow[]>(
        "SELECT COUNT(*) AS student_count FROM student_profiles",
      ),
    ]);

  const [departments] = departmentsResult;
  const [courses] = coursesResult;
  const [curriculum] = curriculumResult;
  const [studentCountRows] = studentCountResult;

  response.json({
    departments: departments.map((department) => ({
      id: department.id,
      name: department.name,
      code: department.code,
      programYears: department.program_years,
    })),
    courses: courses.map((course) => ({
      id: course.id,
      code: course.code,
      name: course.name,
      creditHours: Number(course.credit_hours),
      departmentId: course.department_id,
      departmentName: course.department_name,
      curriculum: curriculum
        .filter((entry) => entry.course_id === course.id)
        .map((entry) => ({
          studyYear: entry.study_year,
          semester: entry.semester,
        })),
    })),
    studentCount: Number(studentCountRows[0]?.student_count ?? 0),
  });
});

router.get("/students/search", async (request, response) => {
  const name = requiredText(request.query.name, 200);
  if (!name || name.length < 2) {
    response.status(400).json({ error: "Enter at least 2 characters of the student's name." });
    return;
  }

  const escapedName = name.replace(/[\\%_]/g, "\\$&");
  const [students] = await pool.execute<StudentRow[]>(
    `SELECT u.id, u.full_name, sp.student_number,
            sp.department_id, d.name AS department_name,
            sp.study_year, sp.current_academic_year,
            sp.current_semester, sp.section
     FROM users u
     JOIN student_profiles sp ON sp.user_id = u.id
     LEFT JOIN departments d ON d.id = sp.department_id
     WHERE u.role = 'student' AND u.full_name LIKE ? ESCAPE '\\\\'
     ORDER BY u.full_name, sp.student_number
     LIMIT 20`,
    [`%${escapedName}%`],
  );

  response.json({
    students: students.map((student) => ({
      id: student.id,
      fullName: student.full_name,
      studentNumber: student.student_number,
      departmentId: student.department_id,
      departmentName: student.department_name,
      studyYear: student.study_year,
      academicYear: student.current_academic_year,
      semester: student.current_semester,
      section: student.section,
    })),
  });
});

router.get("/students/:id", async (request, response) => {
  const studentId = positiveInteger(Number(request.params.id));
  if (!studentId) {
    response.status(400).json({ error: "Select a valid student." });
    return;
  }

  const [students] = await pool.execute<StudentRow[]>(
    `SELECT u.id, u.full_name, sp.student_number,
            sp.department_id, d.name AS department_name,
            sp.study_year, sp.current_academic_year,
            sp.current_semester, sp.section
     FROM users u
     JOIN student_profiles sp ON sp.user_id = u.id
     LEFT JOIN departments d ON d.id = sp.department_id
     WHERE u.id = ? AND u.role = 'student'
     LIMIT 1`,
    [studentId],
  );
  const student = students[0];
  if (!student) {
    response.status(404).json({ error: "The student account was not found." });
    return;
  }

  const [enrollments] = await pool.execute<EnrollmentRow[]>(
    `SELECT ce.id, ce.student_user_id, u.full_name AS student_name,
            sp.student_number, c.code AS course_code, c.name AS course_name,
            c.credit_hours, ce.academic_year, ce.semester, ce.status, ce.score
     FROM course_enrollments ce
     JOIN users u ON u.id = ce.student_user_id
     JOIN student_profiles sp ON sp.user_id = u.id
     JOIN courses c ON c.id = ce.course_id
     WHERE ce.student_user_id = ?
     ORDER BY ce.academic_year DESC, ce.semester DESC, c.code`,
    [studentId],
  );

  response.json({
    id: student.id,
    fullName: student.full_name,
    studentNumber: student.student_number,
    departmentId: student.department_id,
    departmentName: student.department_name,
    studyYear: student.study_year,
    academicYear: student.current_academic_year,
    semester: student.current_semester,
    section: student.section,
    enrollments: enrollments.map((enrollment) => ({
      id: enrollment.id,
      studentUserId: enrollment.student_user_id,
      studentName: enrollment.student_name,
      studentNumber: enrollment.student_number,
      courseCode: enrollment.course_code,
      courseName: enrollment.course_name,
      creditHours: Number(enrollment.credit_hours),
      academicYear: enrollment.academic_year,
      semester: enrollment.semester,
      status: enrollment.status,
      score: enrollment.score === null ? null : Number(enrollment.score),
    })),
  });
});

router.post("/departments", async (request, response) => {
  const body: unknown = request.body;
  if (!isObject(body)) {
    response.status(400).json({ error: "Enter a department name and code." });
    return;
  }

  const name = requiredText(body.name, 150);
  const code = requiredText(body.code, 30);
  const programYears = positiveInteger(body.programYears);
  if (!name || !code || !programYears || programYears > 7) {
    response.status(400).json({ error: "Enter a department name, code, and program duration from 1 to 7 years." });
    return;
  }

  try {
    const [result] = await pool.execute<ResultSetHeader>(
      "INSERT INTO departments (name, code, program_years) VALUES (?, ?, ?)",
      [name, code, programYears],
    );
    response.status(201).json({ id: result.insertId, name, code, programYears });
  } catch (error) {
    if (isDuplicateEntry(error)) {
      response.status(409).json({ error: "That department name or code already exists." });
      return;
    }

    throw error;
  }
});

router.post("/courses", async (request, response) => {
  const body: unknown = request.body;
  if (!isObject(body)) {
    response.status(400).json({ error: "Enter the course details." });
    return;
  }

  const departmentId = positiveInteger(body.departmentId);
  const code = requiredText(body.code, 30);
  const name = requiredText(body.name, 200);
  const creditHours = body.creditHours;
  const studyYear = positiveInteger(body.studyYear);
  const semester = body.semester;
  if (
    !departmentId ||
    !code ||
    !name ||
    !studyYear ||
    studyYear > 7 ||
    (semester !== "Semester 1" && semester !== "Semester 2") ||
    typeof creditHours !== "number" ||
    !Number.isFinite(creditHours) ||
    creditHours <= 0 ||
    creditHours > 999.9
  ) {
    response.status(400).json({ error: "Enter a valid department, course, year of study, semester, and credit hours." });
    return;
  }

  const connection = await pool.getConnection();
  try {
    const [departments] = await connection.execute<DepartmentProgramRow[]>(
      "SELECT program_years FROM departments WHERE id = ? LIMIT 1",
      [departmentId],
    );
    if (departments.length === 0) {
      response.status(404).json({ error: "The selected department was not found." });
      return;
    }

    const programYears = departments[0].program_years;
    if (!programYears) {
      response.status(400).json({ error: "Configure the department's program duration first." });
      return;
    }
    if (studyYear > programYears) {
      response.status(400).json({ error: `This department's program has only ${programYears} years.` });
      return;
    }

    const [existingCourses] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM courses WHERE department_id = ? AND code = ? LIMIT 1",
      [departmentId, code],
    );
    if (existingCourses.length > 0) {
      response.status(409).json({ error: "That course code is already used in this department." });
      return;
    }

    await connection.beginTransaction();
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO courses
        (department_id, code, name, credit_hours)
       VALUES (?, ?, ?, ?)`,
      [departmentId, code, name, creditHours],
    );
    await connection.execute(
      `INSERT INTO department_curriculum (course_id, study_year, semester)
       VALUES (?, ?, ?)`,
      [result.insertId, studyYear, semester],
    );
    await syncDepartmentEnrollments(connection, departmentId);
    await connection.commit();
    response.status(201).json({ id: result.insertId });
  } catch (error) {
    await connection.rollback();
    if (isDuplicateEntry(error)) {
      response.status(409).json({ error: "That course code is already used in this department." });
      return;
    }

    if (isMissingReference(error)) {
      response.status(404).json({ error: "The selected department was not found." });
      return;
    }

    throw error;
  } finally {
    connection.release();
  }
});

router.post("/curriculum", async (request, response) => {
  const body: unknown = request.body;
  if (!isObject(body)) {
    response.status(400).json({ error: "Select a course, year of study, and semester." });
    return;
  }

  const courseId = positiveInteger(body.courseId);
  const studyYear = positiveInteger(body.studyYear);
  const semester = body.semester;
  if (
    !courseId ||
    !studyYear ||
    studyYear > 7 ||
    (semester !== "Semester 1" && semester !== "Semester 2")
  ) {
    response.status(400).json({ error: "Select a valid course, year of study, and semester." });
    return;
  }

  const [courses] = await pool.execute<CourseDepartmentRow[]>(
    `SELECT d.program_years, c.department_id
     FROM courses c
     JOIN departments d ON d.id = c.department_id
     WHERE c.id = ?
     LIMIT 1`,
    [courseId],
  );
  if (courses.length === 0) {
    response.status(404).json({ error: "The selected course was not found." });
    return;
  }

  const programYears = courses[0].program_years;
  if (!programYears) {
    response.status(400).json({ error: "Configure the department's program duration before mapping courses." });
    return;
  }
  if (studyYear > programYears) {
    response.status(400).json({ error: `This department's program has only ${programYears} years.` });
    return;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO department_curriculum (course_id, study_year, semester)
       VALUES (?, ?, ?)`,
      [courseId, studyYear, semester],
    );
    await syncDepartmentEnrollments(connection, courses[0].department_id);
    await connection.commit();
    response.status(201).json({ message: "Course added to the department curriculum." });
  } catch (error) {
    await connection.rollback();
    if (isDuplicateEntry(error)) {
      response.status(409).json({ error: "This course is already mapped to that year and semester." });
      return;
    }

    throw error;
  } finally {
    connection.release();
  }
});

router.delete("/curriculum/:courseId/:studyYear/:semester", async (request, response) => {
  const courseId = positiveInteger(Number(request.params.courseId));
  const studyYear = positiveInteger(Number(request.params.studyYear));
  const semester = request.params.semester;
  if (
    !courseId ||
    !studyYear ||
    studyYear > 7 ||
    (semester !== "Semester 1" && semester !== "Semester 2")
  ) {
    response.status(400).json({ error: "Select a valid curriculum entry." });
    return;
  }

  await pool.execute(
    `DELETE FROM department_curriculum
     WHERE course_id = ? AND study_year = ? AND semester = ?`,
    [courseId, studyYear, semester],
  );
  response.status(204).end();
});

router.get("/grade-report", async (request, response) => {
  const departmentId = positiveInteger(
    typeof request.query.departmentId === "string" ? Number(request.query.departmentId) : null,
  );
  const studyYear = positiveInteger(
    typeof request.query.studyYear === "string" ? Number(request.query.studyYear) : null,
  );
  const section = requiredText(request.query.section, 20);
  const academicYear = requiredText(request.query.academicYear, 20);
  const semester = request.query.semester;
  if (
    !departmentId ||
    !studyYear ||
    !section ||
    !academicYear ||
    (semester !== "Semester 1" && semester !== "Semester 2")
  ) {
    response.status(400).json({ error: "Select a department, year, section, academic year, and semester." });
    return;
  }

  const [gradeRows] = await pool.execute<GradeReportCellRow[]>(
    `SELECT cc.course_id
       AS course_id, c.code AS course_code, c.name AS course_name,
       c.credit_hours, u.id AS student_user_id, u.full_name,
       sp.student_number, ce.id AS enrollment_id, ce.score
     FROM student_profiles sp
     JOIN users u ON u.id = sp.user_id AND u.role = 'student'
     JOIN department_curriculum cc
       ON cc.study_year = sp.study_year AND cc.semester = ?
     JOIN courses c
       ON c.id = cc.course_id AND c.department_id = sp.department_id
     LEFT JOIN course_enrollments ce
       ON ce.student_user_id = sp.user_id
       AND ce.course_id = c.id
       AND ce.academic_year = ?
       AND ce.semester = ?
       AND ce.status = 'enrolled'
     WHERE sp.department_id = ?
       AND sp.study_year = ?
       AND sp.section = ?
       AND sp.current_academic_year = ?
       AND sp.current_semester = ?
     ORDER BY u.full_name, sp.student_number, c.code`,
    [
      semester,
      academicYear,
      semester,
      departmentId,
      studyYear,
      section,
      academicYear,
      semester,
    ],
  );
  const courses = new Map<number, {
    id: number;
    code: string;
    name: string;
    creditHours: number;
  }>();
  const students = new Map<number, {
    studentUserId: number;
    fullName: string;
    studentNumber: string;
    grades: Array<{
      courseId: number;
      enrollmentId: number | null;
      score: number | null;
      letterGrade: string | null;
    }>;
  }>();

  for (const row of gradeRows) {
    const courseId = Number(row.course_id);
    courses.set(courseId, {
      id: courseId,
      code: row.course_code,
      name: row.course_name,
      creditHours: Number(row.credit_hours),
    });
    let student = students.get(row.student_user_id);
    if (!student) {
      student = {
        studentUserId: row.student_user_id,
        fullName: row.full_name,
        studentNumber: row.student_number,
        grades: [],
      };
      students.set(row.student_user_id, student);
    }

    const score = row.score === null ? null : Number(row.score);
    student.grades.push({
      courseId,
      enrollmentId: row.enrollment_id === null ? null : Number(row.enrollment_id),
      score,
      letterGrade: score === null ? null : gradeForScore(score).letterGrade,
    });
  }

  response.json({
    courses: [...courses.values()],
    students: [...students.values()],
  });
});

router.patch("/grade-report/scores", async (request, response) => {
  const body: unknown = request.body;
  if (!isObject(body) || !Array.isArray(body.grades) || body.grades.length === 0) {
    response.status(400).json({ error: "Enter at least one course grade to save." });
    return;
  }

  const departmentId = positiveInteger(body.departmentId);
  const studyYear = positiveInteger(body.studyYear);
  const section = requiredText(body.section, 20);
  const academicYear = requiredText(body.academicYear, 20);
  const semester = body.semester;
  if (
    !departmentId ||
    !studyYear ||
    !section ||
    !academicYear ||
    (semester !== "Semester 1" && semester !== "Semester 2")
  ) {
    response.status(400).json({ error: "Select a department, year, section, academic year, and semester." });
    return;
  }

  const grades: Array<{ enrollmentId: number; score: number | null }> = [];
  const enrollmentIds = new Set<number>();
  for (const entry of body.grades) {
    if (!isObject(entry)) {
      response.status(400).json({ error: "Enter valid course grade entries." });
      return;
    }

    const enrollmentId = positiveInteger(entry.enrollmentId);
    const score = entry.score;
    if (
      !enrollmentId ||
      !(score === null ||
        (typeof score === "number" &&
          Number.isInteger(score) &&
          score >= 0 &&
          score <= 100))
    ) {
      response.status(400).json({ error: "Course scores must be whole numbers from 0 to 100." });
      return;
    }

    if (enrollmentIds.has(enrollmentId)) {
      response.status(400).json({ error: "A course enrollment was included more than once." });
      return;
    }
    enrollmentIds.add(enrollmentId);
    grades.push({ enrollmentId, score });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const placeholders = grades.map(() => "?").join(", ");
    const [matchingEnrollments] = await connection.execute<RowDataPacket[]>(
      `SELECT ce.id
       FROM course_enrollments ce
       JOIN student_profiles sp ON sp.user_id = ce.student_user_id
       JOIN users u ON u.id = sp.user_id AND u.role = 'student'
       JOIN courses c ON c.id = ce.course_id
       JOIN department_curriculum cc
         ON cc.course_id = c.id
         AND cc.study_year = sp.study_year
         AND cc.semester = ce.semester
       WHERE ce.id IN (${placeholders})
         AND ce.status = 'enrolled'
         AND ce.academic_year = ?
         AND ce.semester = ?
         AND sp.department_id = ?
         AND sp.study_year = ?
         AND sp.section = ?
         AND sp.current_academic_year = ?
         AND sp.current_semester = ?
       FOR UPDATE`,
      [
        ...grades.map((grade) => grade.enrollmentId),
        academicYear,
        semester,
        departmentId,
        studyYear,
        section,
        academicYear,
        semester,
      ],
    );
    if (matchingEnrollments.length !== grades.length) {
      await connection.rollback();
      response.status(400).json({
        error: "One or more grades no longer belong to this section and semester. Reload the grade sheet and try again.",
      });
      return;
    }

    for (const grade of grades) {
      await connection.execute(
        "UPDATE course_enrollments SET score = ? WHERE id = ?",
        [grade.score, grade.enrollmentId],
      );
    }
    await connection.commit();
    response.json({
      message: `Saved grades for ${grades.length} course enrollments.`,
      grades: grades.map((grade) => ({
        enrollmentId: grade.enrollmentId,
        score: grade.score,
        letterGrade: grade.score === null
          ? null
          : gradeForScore(grade.score).letterGrade,
      })),
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

router.post("/students", async (request, response) => {
  const body: unknown = request.body;
  if (!isObject(body)) {
    response.status(400).json({ error: "Enter the student account details." });
    return;
  }

  const password = typeof body.password === "string" ? body.password : "";
  const fullName = requiredText(body.fullName, 200);
  const studentNumber = requiredText(body.studentNumber, 50);
  const departmentId = positiveInteger(body.departmentId);
  const studyYear = positiveInteger(body.studyYear);
  const academicYear = requiredText(body.academicYear, 20);
  const semester = body.semester;
  const section = requiredText(body.section, 20);

  if (
    password.length < 12 ||
    Buffer.byteLength(password, "utf8") > 72 ||
    !fullName ||
    !studentNumber ||
    !departmentId ||
    !studyYear ||
    studyYear > 7 ||
    !section ||
    !academicYear ||
    (semester !== "Semester 1" && semester !== "Semester 2")
  ) {
    response.status(400).json({
      error: "Complete all student details and select a study year from 1 to 7. Passwords need at least 12 characters and no more than 72 UTF-8 bytes.",
    });
    return;
  }

  const [departments] = await pool.execute<DepartmentProgramRow[]>(
    "SELECT program_years FROM departments WHERE id = ? LIMIT 1",
    [departmentId],
  );
  if (departments.length === 0) {
    response.status(404).json({ error: "The selected department was not found." });
    return;
  }
  const programYears = departments[0].program_years;
  if (!programYears) {
    response.status(400).json({ error: "Configure the department's program duration before enrolling students." });
    return;
  }
  if (studyYear > programYears) {
    response.status(400).json({ error: `This department's program has only ${programYears} years.` });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [userResult] = await connection.execute<ResultSetHeader>(
      "INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, 'student')",
      [studentNumber, passwordHash, fullName],
    );
    await connection.execute(
      `INSERT INTO student_profiles
        (user_id, student_number, department_id, batch_year, study_year,
         current_academic_year, current_semester, section)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userResult.insertId, studentNumber, departmentId, null, studyYear, academicYear, semester, section],
    );
    const enrolledCourses = await syncDepartmentEnrollments(
      connection,
      departmentId,
      userResult.insertId,
    );
    await connection.commit();
    response.status(201).json({
      id: userResult.insertId,
      message: `Student created for study year ${studyYear} and assigned ${enrolledCourses} mapped ${semester} courses for ${academicYear}.`,
    });
  } catch (error) {
    await connection.rollback();
    if (isDuplicateEntry(error)) {
      response.status(409).json({
        error: "That student ID is already in use.",
      });
      return;
    }

    if (isMissingReference(error)) {
      response.status(404).json({ error: "The selected department was not found." });
      return;
    }

    throw error;
  } finally {
    connection.release();
  }
});

router.post("/enrollments/bulk", async (request, response) => {
  const body: unknown = request.body;
  if (!isObject(body)) {
    response.status(400).json({ error: "Enter the department and source and destination study terms." });
    return;
  }

  const departmentId = positiveInteger(body.departmentId);
  const fromStudyYear = positiveInteger(body.fromStudyYear);
  const fromSemester = body.fromSemester;
  const toStudyYear = positiveInteger(body.toStudyYear);
  const toSemester = body.toSemester;
  if (
    !departmentId ||
    !fromStudyYear ||
    !toStudyYear ||
    (fromSemester !== "Semester 1" && fromSemester !== "Semester 2") ||
    (toSemester !== "Semester 1" && toSemester !== "Semester 2")
  ) {
    response.status(400).json({ error: "Select a department, source study year and semester, and destination study year and semester." });
    return;
  }

  const [departments] = await pool.execute<DepartmentProgramRow[]>(
    "SELECT program_years FROM departments WHERE id = ? LIMIT 1",
    [departmentId],
  );
  if (departments.length === 0) {
    response.status(404).json({ error: "The selected department was not found." });
    return;
  }
  const programYears = departments[0].program_years;
  if (!programYears) {
    response.status(400).json({ error: "Configure the department's program duration before bulk enrollment." });
    return;
  }
  if (fromStudyYear > programYears || toStudyYear > programYears) {
    response.status(400).json({ error: `Study years must be within this department's ${programYears}-year program.` });
    return;
  }
  if (fromStudyYear === programYears && fromSemester === "Semester 2") {
    response.status(400).json({ error: "The final semester is for graduation; there is no following study term to enroll." });
    return;
  }

  const [curriculumTerms] = await pool.execute<RowDataPacket[]>(
    `SELECT DISTINCT cc.study_year, cc.semester
     FROM department_curriculum cc
     JOIN courses c ON c.id = cc.course_id
     WHERE c.department_id = ?
       AND (
         (cc.study_year = ? AND cc.semester = ?)
         OR (cc.study_year = ? AND cc.semester = ?)
       )`,
    [departmentId, fromStudyYear, fromSemester, toStudyYear, toSemester],
  );
  const hasFromTerm = curriculumTerms.some(
    (term) => Number(term.study_year) === fromStudyYear && term.semester === fromSemester,
  );
  const hasToTerm = curriculumTerms.some(
    (term) => Number(term.study_year) === toStudyYear && term.semester === toSemester,
  );
  if (!hasFromTerm || !hasToTerm) {
    response.status(400).json({
      error: "The selected source and destination semesters must have courses mapped in this department's curriculum.",
    });
    return;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [cohortRows] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS student_count,
              SUM(sp.current_academic_year IS NULL) AS missing_academic_year_count
       FROM student_profiles sp
       JOIN users u ON u.id = sp.user_id
       WHERE u.role = 'student'
         AND sp.department_id = ?
         AND sp.study_year = ?
         AND sp.current_semester = ?`,
      [departmentId, fromStudyYear, fromSemester],
    );
    if (Number(cohortRows[0]?.missing_academic_year_count ?? 0) > 0) {
      await connection.rollback();
      response.status(400).json({
        error: "Some students in this cohort have no current academic year on their profile. Set it in their profile before transferring the cohort.",
      });
      return;
    }
    const [enrollmentResult] = await connection.execute<ResultSetHeader>(
      `INSERT IGNORE INTO course_enrollments
        (student_user_id, course_id, academic_year, semester)
       SELECT sp.user_id, cc.course_id, sp.current_academic_year, ?
       FROM student_profiles sp
       JOIN users u ON u.id = sp.user_id AND u.role = 'student'
       JOIN department_curriculum cc ON cc.study_year = ? AND cc.semester = ?
       JOIN courses c
         ON c.id = cc.course_id
         AND c.department_id = sp.department_id
       WHERE sp.department_id = ?
         AND sp.study_year = ?
         AND sp.current_semester = ?
         AND sp.current_academic_year IS NOT NULL`,
      [
        toSemester,
        toStudyYear,
        toSemester,
        departmentId,
        fromStudyYear,
        fromSemester,
      ],
    );
    await connection.execute<ResultSetHeader>(
      `UPDATE student_profiles sp
       JOIN users u ON u.id = sp.user_id
       SET sp.study_year = ?, sp.current_semester = ?
       WHERE u.role = 'student'
         AND sp.department_id = ?
         AND sp.study_year = ?
         AND sp.current_semester = ?`,
      [
        toStudyYear,
        toSemester,
        departmentId,
        fromStudyYear,
        fromSemester,
      ],
    );
    await connection.commit();
    const studentCount = Number(cohortRows[0]?.student_count ?? 0);
    response.json({
      message: studentCount === 0
        ? "No students matched that department and source study term."
        : `Moved ${studentCount} students from year ${fromStudyYear}, ${fromSemester} to year ${toStudyYear}, ${toSemester}. Their current academic year was kept, and ${enrollmentResult.affectedRows} course enrollments were added. Sections were ignored; existing grades and dropped enrollments were preserved.`,
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

router.post("/enrollments", async (request, response) => {
  const body: unknown = request.body;
  if (!isObject(body)) {
    response.status(400).json({ error: "Enter the enrollment details." });
    return;
  }

  const studentUserId = positiveInteger(body.studentUserId);
  const academicYear = requiredText(body.academicYear, 20);
  const semester = body.semester;
  if (
    !studentUserId ||
    !academicYear ||
    (semester !== "Semester 1" && semester !== "Semester 2")
  ) {
    response.status(400).json({ error: "Select a student, academic year, and semester." });
    return;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [students] = await connection.execute<RowDataPacket[]>(
      `SELECT sp.department_id, sp.study_year
       FROM student_profiles sp
       JOIN users u ON u.id = sp.user_id
       WHERE sp.user_id = ? AND u.role = 'student'
       LIMIT 1`,
      [studentUserId],
    );
    if (students.length === 0) {
      await connection.rollback();
      response.status(404).json({ error: "The selected student was not found." });
      return;
    }

    const { department_id: departmentId, study_year: studyYear } = students[0];
    if (!departmentId || !studyYear) {
      await connection.rollback();
      response.status(400).json({ error: "Assign the student a department and year of study first." });
      return;
    }

    await connection.execute(
      `UPDATE student_profiles
       SET current_academic_year = ?, current_semester = ?
       WHERE user_id = ?`,
      [academicYear, semester, studentUserId],
    );
    const enrolledCourses = await syncDepartmentEnrollments(
      connection,
      departmentId,
      studentUserId,
    );
    await connection.commit();
    response.status(201).json({
      message: `Added ${enrolledCourses} mapped ${semester} courses for year ${studyYear}.`,
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

router.patch("/enrollments/:id/status", async (request, response) => {
  const enrollmentId = positiveInteger(Number(request.params.id));
  const body: unknown = request.body;
  if (
    !enrollmentId ||
    !isObject(body) ||
    (body.status !== "enrolled" && body.status !== "dropped")
  ) {
    response.status(400).json({ error: "Choose enrolled or dropped status." });
    return;
  }

  const [result] = await pool.execute<ResultSetHeader>(
    "UPDATE course_enrollments SET status = ? WHERE id = ?",
    [body.status, enrollmentId],
  );
  if (result.affectedRows === 0) {
    const [existing] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM course_enrollments WHERE id = ? LIMIT 1",
      [enrollmentId],
    );
    if (existing.length === 0) {
      response.status(404).json({ error: "The course enrollment was not found." });
      return;
    }
  }

  response.status(204).end();
});

router.patch("/enrollments/:id/score", async (request, response) => {
  const enrollmentId = positiveInteger(Number(request.params.id));
  const body: unknown = request.body;
  if (
    !enrollmentId ||
    !isObject(body) ||
    !(body.score === null ||
      (typeof body.score === "number" &&
        Number.isInteger(body.score) &&
        body.score >= 0 &&
        body.score <= 100))
  ) {
    response.status(400).json({ error: "Course scores must be whole numbers from 0 to 100." });
    return;
  }

  const [existing] = await pool.execute<RowDataPacket[]>(
    "SELECT id FROM course_enrollments WHERE id = ? LIMIT 1",
    [enrollmentId],
  );
  if (existing.length === 0) {
    response.status(404).json({ error: "The course enrollment was not found." });
    return;
  }

  await pool.execute(
    "UPDATE course_enrollments SET score = ? WHERE id = ?",
    [body.score, enrollmentId],
  );
  response.json({
    letterGrade: body.score === null
      ? null
      : gradeForScore(body.score).letterGrade,
  });
});

router.patch("/students/:id/password", async (request, response) => {
  const studentId = positiveInteger(Number(request.params.id));
  const body: unknown = request.body;
  if (
    !studentId ||
    !isObject(body) ||
    typeof body.password !== "string" ||
    body.password.length < 12 ||
    Buffer.byteLength(body.password, "utf8") > 72
  ) {
    response.status(400).json({
      error: "The new password needs at least 12 characters and no more than 72 UTF-8 bytes.",
    });
    return;
  }

  const [students] = await pool.execute<RowDataPacket[]>(
    "SELECT id FROM users WHERE id = ? AND role = 'student' LIMIT 1",
    [studentId],
  );
  if (students.length === 0) {
    response.status(404).json({ error: "The student account was not found." });
    return;
  }

  const passwordHash = await bcrypt.hash(body.password, 12);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("UPDATE users SET password_hash = ? WHERE id = ?", [
      passwordHash,
      studentId,
    ]);
    await connection.execute("DELETE FROM auth_sessions WHERE user_id = ?", [
      studentId,
    ]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  response.status(204).end();
});

router.patch("/students/:id", async (request, response) => {
  const studentId = positiveInteger(Number(request.params.id));
  const body: unknown = request.body;
  if (!studentId || !isObject(body)) {
    response.status(400).json({ error: "Enter valid student profile details." });
    return;
  }

  const fullName = requiredText(body.fullName, 200);
  const studentNumber = requiredText(body.studentNumber, 50);
  const departmentId = positiveInteger(body.departmentId);
  const studyYear = positiveInteger(body.studyYear);
  const academicYear = requiredText(body.academicYear, 20);
  const semester = body.semester;
  const section = requiredText(body.section, 20);
  if (
    !fullName ||
    !studentNumber ||
    !departmentId ||
    !studyYear ||
    studyYear > 7 ||
    !academicYear ||
    (semester !== "Semester 1" && semester !== "Semester 2") ||
    !section
  ) {
    response.status(400).json({ error: "Complete all student profile fields, select a year of study from 1 to 7, and choose a current academic year and semester." });
    return;
  }

  const [existingStudents] = await pool.execute<RowDataPacket[]>(
    "SELECT id FROM users WHERE id = ? AND role = 'student' LIMIT 1",
    [studentId],
  );
  if (existingStudents.length === 0) {
    response.status(404).json({ error: "The student account was not found." });
    return;
  }

  const [departments] = await pool.execute<DepartmentProgramRow[]>(
    "SELECT program_years FROM departments WHERE id = ? LIMIT 1",
    [departmentId],
  );
  if (departments.length === 0) {
    response.status(404).json({ error: "The selected department was not found." });
    return;
  }
  const programYears = departments[0].program_years;
  if (!programYears) {
    response.status(400).json({ error: "Configure the department's program duration first." });
    return;
  }
  if (studyYear > programYears) {
    response.status(400).json({ error: `This department's program has only ${programYears} years.` });
    return;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      "UPDATE users SET username = ?, full_name = ? WHERE id = ? AND role = 'student'",
      [studentNumber, fullName, studentId],
    );

    await connection.execute(
      `UPDATE student_profiles
       SET student_number = ?, department_id = ?, study_year = ?,
           current_academic_year = ?, current_semester = ?, section = ?
       WHERE user_id = ?`,
      [studentNumber, departmentId, studyYear, academicYear, semester, section, studentId],
    );
    await syncDepartmentEnrollments(connection, departmentId, studentId);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (isDuplicateEntry(error)) {
      response.status(409).json({
        error: "That student ID is already in use.",
      });
      return;
    }

    if (isMissingReference(error)) {
      response.status(404).json({ error: "The selected department was not found." });
      return;
    }

    throw error;
  } finally {
    connection.release();
  }

  response.status(204).end();
});

router.delete("/departments/:id", async (request, response) => {
  const departmentId = positiveInteger(Number(request.params.id));
  if (!departmentId) {
    response.status(400).json({ error: "Select a valid department." });
    return;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [departments] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM departments WHERE id = ? FOR UPDATE",
      [departmentId],
    );
    if (departments.length === 0) {
      await connection.rollback();
      response.status(404).json({ error: "The department was not found." });
      return;
    }

    const [courses] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM courses WHERE department_id = ? LIMIT 1",
      [departmentId],
    );
    const [students] = await connection.execute<RowDataPacket[]>(
      "SELECT user_id FROM student_profiles WHERE department_id = ? LIMIT 1",
      [departmentId],
    );
    if (courses.length > 0 || students.length > 0) {
      await connection.rollback();
      response.status(409).json({
        error: "Reassign or remove this department's courses and students before deleting it.",
      });
      return;
    }

    await connection.execute("DELETE FROM departments WHERE id = ?", [departmentId]);
    await connection.commit();
    response.status(204).end();
  } catch (error) {
    await connection.rollback();
    if (isReferencedRecord(error)) {
      response.status(409).json({
        error: "This department is still in use and cannot be deleted.",
      });
      return;
    }

    throw error;
  } finally {
    connection.release();
  }
});

router.delete("/courses/:id", async (request, response) => {
  const courseId = positiveInteger(Number(request.params.id));
  if (!courseId) {
    response.status(400).json({ error: "Select a valid course." });
    return;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [courses] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM courses WHERE id = ? FOR UPDATE",
      [courseId],
    );
    if (courses.length === 0) {
      await connection.rollback();
      response.status(404).json({ error: "The course was not found." });
      return;
    }

    const [enrollments] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM course_enrollments WHERE course_id = ? LIMIT 1",
      [courseId],
    );
    if (enrollments.length > 0) {
      await connection.rollback();
      response.status(409).json({
        error: "This course has enrollment or grade history and cannot be deleted.",
      });
      return;
    }

    await connection.execute("DELETE FROM courses WHERE id = ?", [courseId]);
    await connection.commit();
    response.status(204).end();
  } catch (error) {
    await connection.rollback();
    if (isReferencedRecord(error)) {
      response.status(409).json({
        error: "This course has enrollment history and cannot be deleted.",
      });
      return;
    }

    throw error;
  } finally {
    connection.release();
  }
});

router.patch("/departments/:id", async (request, response) => {
  const departmentId = positiveInteger(Number(request.params.id));
  const body: unknown = request.body;
  if (!departmentId || !isObject(body)) {
    response.status(400).json({ error: "Enter a department name and code." });
    return;
  }

  const name = requiredText(body.name, 150);
  const code = requiredText(body.code, 30);
  const programYears = positiveInteger(body.programYears);
  if (!name || !code || !programYears || programYears > 7) {
    response.status(400).json({ error: "Enter a department name, code, and program duration from 1 to 7 years." });
    return;
  }

  const [existingDepartments] = await pool.execute<RowDataPacket[]>(
    "SELECT id FROM departments WHERE id = ? LIMIT 1",
    [departmentId],
  );
  if (existingDepartments.length === 0) {
    response.status(404).json({ error: "The department was not found." });
    return;
  }

  const [outOfRangeStudents] = await pool.execute<RowDataPacket[]>(
    "SELECT user_id FROM student_profiles WHERE department_id = ? AND study_year > ? LIMIT 1",
    [departmentId, programYears],
  );
  const [outOfRangeCourses] = await pool.execute<RowDataPacket[]>(
    `SELECT cc.course_id
     FROM department_curriculum cc
     JOIN courses c ON c.id = cc.course_id
     WHERE c.department_id = ? AND cc.study_year > ?
     LIMIT 1`,
    [departmentId, programYears],
  );
  if (outOfRangeStudents.length > 0 || outOfRangeCourses.length > 0) {
    response.status(409).json({
      error: "The duration cannot be shorter than a student's current year or a mapped course year.",
    });
    return;
  }

  try {
    await pool.execute(
      "UPDATE departments SET name = ?, code = ?, program_years = ? WHERE id = ?",
      [name, code, programYears, departmentId],
    );
    response.status(204).end();
  } catch (error) {
    if (isDuplicateEntry(error)) {
      response.status(409).json({ error: "That department name or code already exists." });
      return;
    }

    throw error;
  }
});

router.patch("/courses/:id", async (request, response) => {
  const courseId = positiveInteger(Number(request.params.id));
  const body: unknown = request.body;
  if (!courseId || !isObject(body)) {
    response.status(400).json({ error: "Enter the course details." });
    return;
  }

  const departmentId = positiveInteger(body.departmentId);
  const code = requiredText(body.code, 30);
  const name = requiredText(body.name, 200);
  const creditHours = body.creditHours;
  const curriculum = body.curriculum;
  if (
    !departmentId ||
    !code ||
    !name ||
    typeof creditHours !== "number" ||
    !Number.isFinite(creditHours) ||
    creditHours <= 0 ||
    creditHours > 999.9
  ) {
    response.status(400).json({ error: "Enter a valid department, course code, name, and credit hours." });
    return;
  }

  let mappings: Array<{ studyYear: number; semester: "Semester 1" | "Semester 2" }> | undefined;
  if (curriculum !== undefined) {
    if (!Array.isArray(curriculum) || curriculum.length > 14) {
      response.status(400).json({ error: "Enter valid course year and semester mappings." });
      return;
    }

    mappings = [];
    const mappingKeys = new Set<string>();
    for (const entry of curriculum) {
      if (!isObject(entry)) {
        response.status(400).json({ error: "Enter valid course year and semester mappings." });
        return;
      }

      const studyYear = positiveInteger(entry.studyYear);
      const semester = entry.semester;
      if (
        !studyYear ||
        studyYear > 7 ||
        (semester !== "Semester 1" && semester !== "Semester 2")
      ) {
        response.status(400).json({ error: "Select a valid year of study and semester." });
        return;
      }

      const key = `${studyYear}:${semester}`;
      if (mappingKeys.has(key)) {
        response.status(409).json({ error: "A course cannot have duplicate year and semester mappings." });
        return;
      }
      mappingKeys.add(key);
      mappings.push({ studyYear, semester });
    }
  }

  const [duplicateCourses] = await pool.execute<RowDataPacket[]>(
    "SELECT id FROM courses WHERE department_id = ? AND code = ? AND id <> ? LIMIT 1",
    [departmentId, code, courseId],
  );
  if (duplicateCourses.length > 0) {
    response.status(409).json({ error: "That course code is already used in this department." });
    return;
  }

  const [departmentRows] = await pool.execute<DepartmentProgramRow[]>(
    "SELECT program_years FROM departments WHERE id = ? LIMIT 1",
    [departmentId],
  );
  if (departmentRows.length === 0) {
    response.status(404).json({ error: "The selected department was not found." });
    return;
  }
  const programYears = departmentRows[0].program_years;
  if (!programYears) {
    response.status(400).json({ error: "Configure the department's program duration first." });
    return;
  }
  if (mappings?.some((mapping) => mapping.studyYear > programYears)) {
    response.status(409).json({
      error: `This department's program has only ${programYears} years.`,
    });
    return;
  }
  if (!mappings) {
    const [outOfRangeMappings] = await pool.execute<RowDataPacket[]>(
      `SELECT course_id
       FROM department_curriculum
       WHERE course_id = ? AND study_year > ?
       LIMIT 1`,
      [courseId, programYears],
    );
    if (outOfRangeMappings.length > 0) {
      response.status(409).json({
        error: "The course has curriculum mappings beyond the selected department's program duration.",
      });
      return;
    }
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existingCourses] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM courses WHERE id = ? FOR UPDATE",
      [courseId],
    );
    if (existingCourses.length === 0) {
      await connection.rollback();
      response.status(404).json({ error: "The course was not found." });
      return;
    }

    await connection.execute(
      `UPDATE courses
        SET department_id = ?, code = ?, name = ?, credit_hours = ?
       WHERE id = ?`,
      [departmentId, code, name, creditHours, courseId],
    );
    if (mappings) {
      await connection.execute(
        "DELETE FROM department_curriculum WHERE course_id = ?",
        [courseId],
      );
      for (const mapping of mappings) {
        await connection.execute(
          `INSERT INTO department_curriculum (course_id, study_year, semester)
           VALUES (?, ?, ?)`,
          [courseId, mapping.studyYear, mapping.semester],
        );
      }
    }
    await syncDepartmentEnrollments(connection, departmentId);

    await connection.commit();
    response.status(204).end();
  } catch (error) {
    await connection.rollback();
    if (isDuplicateEntry(error)) {
      response.status(409).json({ error: "That course code is already used in this department." });
      return;
    }

    if (isMissingReference(error)) {
      response.status(404).json({ error: "The selected department was not found." });
      return;
    }

    throw error;
  } finally {
    connection.release();
  }
});

export default router;
