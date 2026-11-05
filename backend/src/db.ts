import mysql, { type RowDataPacket } from "mysql2/promise";
import bcrypt from "bcryptjs";

const databaseName = process.env.DB_NAME;

export const pool = mysql.createPool({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: databaseName,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: "utf8mb4",
});

export async function initializeDatabase(): Promise<void> {
  if (!databaseName) {
    throw new Error("DB_NAME is required. Configure the backend environment.");
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(100) NULL UNIQUE,
      email VARCHAR(254) NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      full_name VARCHAR(200) NOT NULL,
      role ENUM('student', 'admin') NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  const [userColumns] = await pool.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'`,
    [databaseName],
  );
  const columnNames = new Set(userColumns.map((column) => column.COLUMN_NAME));
  if (!columnNames.has("email")) {
    await pool.query("ALTER TABLE users ADD COLUMN email VARCHAR(254) NULL UNIQUE");
  }
  if (columnNames.has("username")) {
    await pool.query("ALTER TABLE users MODIFY username VARCHAR(100) NULL");
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash CHAR(64) NOT NULL PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX auth_sessions_expires_at (expires_at),
      CONSTRAINT auth_sessions_user_fk FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS departments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) NOT NULL UNIQUE,
      code VARCHAR(30) NOT NULL UNIQUE,
      program_years TINYINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  const [departmentColumns] = await pool.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'departments'`,
    [databaseName],
  );
  if (!departmentColumns.some((column) => column.COLUMN_NAME === "program_years")) {
    await pool.query("ALTER TABLE departments ADD COLUMN program_years TINYINT UNSIGNED NULL");
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_profiles (
      user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
      student_number VARCHAR(50) NOT NULL UNIQUE,
      department_id BIGINT UNSIGNED NULL,
      batch_year SMALLINT UNSIGNED NULL,
      study_year TINYINT UNSIGNED NULL,
      current_academic_year VARCHAR(20) NULL,
      current_semester VARCHAR(30) NULL,
      section VARCHAR(20) NULL,
      CONSTRAINT student_profiles_user_fk FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT student_profiles_department_fk FOREIGN KEY (department_id)
        REFERENCES departments(id) ON DELETE SET NULL
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS courses (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      department_id BIGINT UNSIGNED NOT NULL,
      code VARCHAR(30) NOT NULL,
      name VARCHAR(200) NOT NULL,
      credit_hours DECIMAL(4, 1) UNSIGNED NOT NULL,
      batch_year SMALLINT UNSIGNED NULL,
      study_year TINYINT UNSIGNED NULL,
      semester VARCHAR(30) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT courses_department_fk FOREIGN KEY (department_id)
        REFERENCES departments(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_enrollments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      student_user_id BIGINT UNSIGNED NOT NULL,
      course_id BIGINT UNSIGNED NOT NULL,
      academic_year VARCHAR(20) NOT NULL,
      semester VARCHAR(30) NOT NULL,
      status ENUM('enrolled', 'dropped') NOT NULL DEFAULT 'enrolled',
      score SMALLINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY enrollment_student_course_term
        (student_user_id, course_id, academic_year, semester),
      CONSTRAINT enrollments_student_fk FOREIGN KEY (student_user_id)
        REFERENCES student_profiles(user_id) ON DELETE CASCADE,
      CONSTRAINT enrollments_course_fk FOREIGN KEY (course_id)
        REFERENCES courses(id) ON DELETE RESTRICT,
      CONSTRAINT enrollments_score_check CHECK (score IS NULL OR score <= 100)
    ) ENGINE=InnoDB
  `);

  const [courseColumns] = await pool.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'courses'`,
    [databaseName],
  );
  const courseColumnNames = new Set(courseColumns.map((column) => column.COLUMN_NAME));
  if (!courseColumnNames.has("batch_year")) {
    await pool.query("ALTER TABLE courses ADD COLUMN batch_year SMALLINT UNSIGNED NULL");
  }
  if (!courseColumnNames.has("study_year")) {
    await pool.query("ALTER TABLE courses ADD COLUMN study_year TINYINT UNSIGNED NULL");
  }
  if (!courseColumnNames.has("semester")) {
    await pool.query("ALTER TABLE courses ADD COLUMN semester VARCHAR(30) NULL");
  }
  const [studentProfileColumns] = await pool.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'student_profiles'`,
    [databaseName],
  );
  const studentProfileColumnNames = new Set(
    studentProfileColumns.map((column) => column.COLUMN_NAME),
  );
  if (!studentProfileColumnNames.has("study_year")) {
    await pool.query("ALTER TABLE student_profiles ADD COLUMN study_year TINYINT UNSIGNED NULL");
  }
  if (!studentProfileColumnNames.has("current_academic_year")) {
    await pool.query("ALTER TABLE student_profiles ADD COLUMN current_academic_year VARCHAR(20) NULL");
  }
  if (!studentProfileColumnNames.has("current_semester")) {
    await pool.query("ALTER TABLE student_profiles ADD COLUMN current_semester VARCHAR(30) NULL");
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS department_curriculum (
      course_id BIGINT UNSIGNED NOT NULL,
      study_year TINYINT UNSIGNED NOT NULL,
      semester VARCHAR(30) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (course_id, study_year, semester),
      CONSTRAINT department_curriculum_course_fk FOREIGN KEY (course_id)
        REFERENCES courses(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
  await pool.query(`
    INSERT IGNORE INTO department_curriculum (course_id, study_year, semester)
    SELECT id, study_year, semester
    FROM courses
    WHERE study_year BETWEEN 1 AND 7
      AND semester IN ('Semester 1', 'Semester 2')
  `);
  await pool.query(`
    UPDATE student_profiles sp
    SET current_academic_year = (
          SELECT ce.academic_year
          FROM course_enrollments ce
          WHERE ce.student_user_id = sp.user_id AND ce.status = 'enrolled'
          ORDER BY ce.academic_year DESC,
                   CASE ce.semester WHEN 'Semester 2' THEN 2 ELSE 1 END DESC,
                   ce.id DESC
          LIMIT 1
        ),
        current_semester = (
          SELECT ce.semester
          FROM course_enrollments ce
          WHERE ce.student_user_id = sp.user_id AND ce.status = 'enrolled'
          ORDER BY ce.academic_year DESC,
                   CASE ce.semester WHEN 'Semester 2' THEN 2 ELSE 1 END DESC,
                   ce.id DESC
          LIMIT 1
        )
    WHERE sp.current_academic_year IS NULL
      AND sp.current_semester IS NULL
  `);
  await pool.query(`
    INSERT IGNORE INTO course_enrollments
      (student_user_id, course_id, academic_year, semester)
    SELECT sp.user_id, c.id, sp.current_academic_year, sp.current_semester
    FROM student_profiles sp
    JOIN courses c ON c.department_id = sp.department_id
    JOIN department_curriculum cc
      ON cc.course_id = c.id
      AND cc.study_year = sp.study_year
      AND cc.semester = sp.current_semester
    WHERE sp.current_academic_year IS NOT NULL
      AND sp.current_semester IN ('Semester 1', 'Semester 2')
  `);
  const [courseIndexes] = await pool.query<RowDataPacket[]>(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'courses'`,
    [databaseName],
  );
  const courseIndexNames = new Set(courseIndexes.map((index) => index.INDEX_NAME));
  if (!courseIndexNames.has("courses_department_id_idx")) {
    await pool.query("ALTER TABLE courses ADD INDEX courses_department_id_idx (department_id)");
  }
  if (courseIndexNames.has("courses_department_batch_study_term")) {
    await pool.query("ALTER TABLE courses DROP INDEX courses_department_batch_study_term");
  }
  if (courseIndexNames.has("courses_department_batch_term")) {
    await pool.query("ALTER TABLE courses DROP INDEX courses_department_batch_term");
  }
  if (courseIndexNames.has("courses_department_code")) {
    await pool.query("ALTER TABLE courses DROP INDEX courses_department_code");
  }
  const [enrollmentColumns] = await pool.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'course_enrollments'`,
    [databaseName],
  );
  if (!enrollmentColumns.some((column) => column.COLUMN_NAME === "status")) {
    await pool.query(
      "ALTER TABLE course_enrollments ADD COLUMN status ENUM('enrolled', 'dropped') NOT NULL DEFAULT 'enrolled'",
    );
  }

  await pool.query("UPDATE users SET username = NULL WHERE role = 'student'");
  await pool.query(`
    UPDATE users u
    JOIN student_profiles sp ON sp.user_id = u.id
    SET u.username = sp.student_number
    WHERE u.role = 'student'
  `);

  await pool.query("DELETE FROM auth_sessions WHERE expires_at <= NOW()");
  await createInitialAdmin();
}

async function createInitialAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const fullName = process.env.ADMIN_FULL_NAME?.trim();

  if (!email && !password && !fullName) {
    return;
  }

  if (!email || !password || !fullName) {
    throw new Error(
      "Set ADMIN_EMAIL, ADMIN_PASSWORD, and ADMIN_FULL_NAME together to create or configure the initial admin.",
    );
  }

  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new Error("ADMIN_EMAIL must be a valid email address.");
  }

  if (password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
    throw new Error("ADMIN_PASSWORD must contain at least 12 characters and no more than 72 bytes.");
  }

  const [rows] = await pool.execute<RowDataPacket[]>(
    "SELECT id, role FROM users WHERE email = ? LIMIT 1",
    [email],
  );

  if (rows.length > 0) {
    if (rows[0].role !== "admin") {
      throw new Error(
        "ADMIN_EMAIL is already assigned to a non-admin account. Choose a different email.",
      );
    }

    return;
  }

  const [legacyAdmins] = await pool.execute<RowDataPacket[]>(
    "SELECT id FROM users WHERE role = 'admin' AND email IS NULL",
  );
  if (legacyAdmins.length > 1) {
    throw new Error(
      "Multiple existing admin accounts have no email. Assign a unique email to each admin before starting the API.",
    );
  }

  if (legacyAdmins.length === 1) {
    await pool.execute("UPDATE users SET email = ? WHERE id = ?", [
      email,
      legacyAdmins[0].id,
    ]);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await pool.execute(
    "INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, 'admin')",
    [email, passwordHash, fullName],
  );
}
