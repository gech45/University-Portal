import bcrypt from "bcryptjs";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import {
  createSessionToken,
  hashSessionToken,
  requireAuth,
  requireRole,
  sessionCookieName,
  sessionCookieOptions,
} from "./auth.js";
import { pool } from "./db.js";
import { calculateWeightedGpa, gradeForScore } from "./grading.js";

const router = Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

interface UserRow extends RowDataPacket {
  id: number;
  username: string | null;
  email: string | null;
  password_hash: string;
  full_name: string;
  role: "student" | "admin";
}

interface CourseGradeRow extends RowDataPacket {
  code: string;
  name: string;
  credit_hours: number;
  academic_year: string;
  semester: string;
  score: number | null;
}

interface StudentProfileRow extends RowDataPacket {
  student_number: string;
  department_name: string | null;
  study_year: number | null;
  academic_year: string | null;
  semester: string | null;
}

interface StudentCourse {
  courseCode: string;
  courseName: string;
  creditHours: number;
  academicYear: string;
  semester: string;
  score: number | null;
  letterGrade: string | null;
  gradePoints: number | null;
}

interface StudentStatus {
  student: {
    fullName: string;
    studentNumber: string;
    department: string | null;
    studyYear: number | null;
    academicYear: string | null;
    semester: string | null;
  };
  gpa: number | null;
  semesterGpa: number | null;
  academicYearGpa: number | null;
  courses: StudentCourse[];
}

function createPdf(lines: string[]): Buffer {
  const safeLines = lines.map((line) =>
    line.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/[\\()]/g, "\\$&"),
  );
  const pages: string[][] = [];
  for (let index = 0; index < safeLines.length; index += 48) {
    pages.push(safeLines.slice(index, index + 48));
  }

  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>";

  pages.forEach((pageLines, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const text = [
      "BT",
      "/F1 9 Tf",
      "46 754 Td",
      "12 TL",
      ...pageLines.flatMap((line) => [`(${line}) Tj`, "T*"]),
      "ET",
    ].join("\n");
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(text, "ascii")} >>\nstream\n${text}\nendstream`;
  });

  let document = "%PDF-1.4\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(document, "ascii");
    document += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(document, "ascii");
  document += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    document += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  document += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(document, "ascii");
}

async function loadStudentStatus(studentId: number): Promise<StudentStatus | null> {
  const [profileRows] = await pool.execute<StudentProfileRow[]>(
    `SELECT sp.student_number, d.name AS department_name, sp.study_year,
       sp.current_academic_year AS academic_year, sp.current_semester AS semester
     FROM student_profiles sp
     LEFT JOIN departments d ON d.id = sp.department_id
     WHERE sp.user_id = ?`,
    [studentId],
  );
  const profile = profileRows[0];
  if (!profile) {
    return null;
  }

  const [rows] = await pool.execute<CourseGradeRow[]>(
    `SELECT c.code, c.name, c.credit_hours, ce.academic_year, ce.semester,
       ce.score
     FROM course_enrollments ce
     JOIN courses c ON c.id = ce.course_id
     WHERE ce.student_user_id = ?
       AND ce.status = 'enrolled'
     ORDER BY ce.academic_year DESC,
       CASE ce.semester WHEN 'Semester 2' THEN 2 ELSE 1 END DESC,
       c.code`,
    [studentId],
  );

  const courses: StudentCourse[] = rows.map((course) => {
    const grade = gradeForScore(course.score === null ? null : Number(course.score));
    return {
      courseCode: course.code,
      courseName: course.name,
      creditHours: Number(course.credit_hours),
      academicYear: course.academic_year,
      semester: course.semester,
      score: course.score === null ? null : Number(course.score),
      letterGrade: grade.letterGrade,
      gradePoints: grade.gradePoints,
    };
  });
  const gpaFor = (matchingCourses: StudentCourse[]) =>
    calculateWeightedGpa(matchingCourses.map((course) => ({
      score: course.score,
      creditHours: course.creditHours,
    }))).gpa;
  const academicYear = profile.academic_year ?? courses[0]?.academicYear ?? null;
  const semester = profile.semester ?? courses[0]?.semester ?? null;

  return {
    student: {
      fullName: "",
      studentNumber: profile.student_number,
      department: profile.department_name,
      studyYear: profile.study_year === null ? null : Number(profile.study_year),
      academicYear,
      semester,
    },
    gpa: gpaFor(courses),
    semesterGpa: academicYear && semester
      ? gpaFor(courses.filter((course) =>
          course.academicYear === academicYear && course.semester === semester,
        ))
      : null,
    academicYearGpa: academicYear
      ? gpaFor(courses.filter((course) => course.academicYear === academicYear))
      : null,
    courses,
  };
}

async function signIn(
  identifier: unknown,
  password: unknown,
  role: "student" | "admin",
  response: Response,
): Promise<void> {
  if (
    typeof identifier !== "string" ||
    identifier.trim().length === 0 ||
    identifier.trim().length > (role === "admin" ? 254 : 100) ||
    typeof password !== "string" ||
    password.length === 0
  ) {
    response.status(400).json({
      error: `Enter your ${role === "admin" ? "email" : "username"} and password.`,
    });
    return;
  }

  if (Buffer.byteLength(password, "utf8") > 72) {
    response.status(400).json({ error: "Passwords cannot exceed 72 UTF-8 bytes." });
    return;
  }

  const normalizedIdentifier = identifier.trim();
  if (role === "admin" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedIdentifier)) {
    response.status(400).json({ error: "Enter a valid administrator email address." });
    return;
  }

  const [rows] =
    role === "admin"
      ? await pool.execute<UserRow[]>(
          "SELECT id, username, email, password_hash, full_name, role FROM users WHERE email = ? AND role = 'admin' LIMIT 1",
          [normalizedIdentifier.toLowerCase()],
        )
      : await pool.execute<UserRow[]>(
          "SELECT id, username, email, password_hash, full_name, role FROM users WHERE username = ? AND role = 'student' LIMIT 1",
          [normalizedIdentifier],
        );
  const user = rows[0];

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    response.status(401).json({ error: "The email/username or password is incorrect." });
    return;
  }

  const token = createSessionToken();
  const tokenHash = hashSessionToken(token);
  await pool.execute(
    `INSERT INTO auth_sessions (token_hash, user_id, expires_at)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 8 HOUR))`,
    [tokenHash, user.id],
  );

  response.cookie(sessionCookieName, token, sessionCookieOptions());
  response.json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
    },
  });
}

router.post("/auth/student/login", loginLimiter, async (request, response) => {
  const { username, password } = request.body ?? {};
  await signIn(username, password, "student", response);
});

router.post("/auth/admin/login", loginLimiter, async (request, response) => {
  const { email, password } = request.body ?? {};
  await signIn(email, password, "admin", response);
});

router.post("/auth/logout", requireAuth, async (request, response) => {
  if (request.sessionTokenHash) {
    await pool.execute("DELETE FROM auth_sessions WHERE token_hash = ?", [
      request.sessionTokenHash,
    ]);
  }

  response.clearCookie(sessionCookieName, sessionCookieOptions());
  response.status(204).end();
});

router.get("/auth/me", requireAuth, (request, response) => {
  response.json({ user: request.authUser });
});

router.get(
  "/student/dashboard",
  requireAuth,
  requireRole("student"),
  async (request, response) => {
    const studentId = request.authUser?.id;
    if (!studentId) {
      response.status(401).json({ error: "Please sign in to continue." });
      return;
    }

    const status = await loadStudentStatus(studentId);
    if (!status) {
      response.status(404).json({ error: "Your student profile could not be found." });
      return;
    }

    response.json({
      student: {
        ...status.student,
        fullName: request.authUser?.fullName ?? "",
      },
      gpa: status.gpa,
      semesterGpa: status.semesterGpa,
      academicYearGpa: status.academicYearGpa,
      courses: status.courses.map((course) => ({
        courseCode: course.courseCode,
        courseName: course.courseName,
        creditHours: course.creditHours,
        academicYear: course.academicYear,
        semester: course.semester,
        score: course.score,
        letterGrade: course.letterGrade,
      })),
    });
  },
);

router.get(
  "/student/status.pdf",
  requireAuth,
  requireRole("student"),
  async (request, response) => {
    const studentId = request.authUser?.id;
    if (!studentId) {
      response.status(401).json({ error: "Please sign in to continue." });
      return;
    }

    const status = await loadStudentStatus(studentId);
    if (!status) {
      response.status(404).json({ error: "Your student profile could not be found." });
      return;
    }
    status.student.fullName = request.authUser?.fullName ?? "";

    const rows = [
      "ADDIS ABABA SCIENCE AND TECHNOLOGY UNIVERSITY",
      "STUDENT GRADE REPORT",
      "",
      `Student: ${status.student.fullName}`,
      `Student ID: ${status.student.studentNumber}`,
      `Department: ${status.student.department ?? "Not assigned"}`,
      `Study year: ${status.student.studyYear ?? "Not assigned"}`,
      `Academic year: ${status.student.academicYear ?? "Not set"}`,
      `Semester: ${status.student.semester ?? "Not set"}`,
      "",
      `Semester GPA: ${status.semesterGpa?.toFixed(2) ?? "N/A"}`,
      `Academic year CGPA: ${status.academicYearGpa?.toFixed(2) ?? "N/A"}`,
      `Cumulative GPA: ${status.gpa?.toFixed(2) ?? "N/A"}`,
      "",
      "COURSE CODE  COURSE TITLE                     CR  SCORE  GRADE  YEAR      SEMESTER",
      "-".repeat(88),
      ...status.courses.map((course) =>
        `${course.courseCode.slice(0, 12).padEnd(12)} ${course.courseName.slice(0, 32).padEnd(32)} ` +
        `${String(course.creditHours).padStart(2)}  ${String(course.score ?? "-").padStart(5)}  ` +
        `${String(course.letterGrade ?? "IP").padEnd(5)}  ${course.academicYear.slice(0, 9).padEnd(9)} ${course.semester.slice(0, 12)}`,
      ),
      "",
      "GPA = total (grade points x credit hours) / total graded credit hours.",
      "IP = course grade is pending.",
    ];
    const pdf = createPdf(rows);
    response
      .status(200)
      .type("application/pdf")
      .setHeader("Content-Disposition", 'attachment; filename="student-status.pdf"')
      .setHeader("Cache-Control", "no-store")
      .send(pdf);
  },
);

export default router;
