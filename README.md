# AIT Student Portal

React and TypeScript frontend with an Express and TypeScript API. MySQL stores
accounts, student profiles, departments, courses, enrollments, grades, and
revocable login sessions.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Run locally

```sh
npm install
npm run dev
```

The frontend runs at `http://localhost:5173` and the API at
`http://localhost:4000`. The frontend proxies `/api` requests to the API.

## Configure MySQL

1. Create the database in MySQL, for example:

   ```sql
   CREATE DATABASE ait_student_portal CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```

2. Copy `backend/.env.example` to `backend/.env` and set the database
   connection values.
3. Set `ADMIN_EMAIL`, `ADMIN_PASSWORD` (at least 12 characters), and
   `ADMIN_FULL_NAME` to create or configure the initial administrator.
   Passwords must be no more than 72 UTF-8 bytes. New admin accounts use email
   for sign-in; the password is not reset on later starts.
4. Run `npm run dev`. The API creates the required tables on startup.

The administrator workspace can create and edit departments, courses, student
profiles, course enrollments, and grades, and can reset student passwords.
Password resets revoke that student's existing sessions. Student passwords are
never displayed or stored in plain text. Student records are searched by name;
the overview loads only the total student count, and detailed profile,
enrollment, and grade records are fetched only for a selected student.
Administrators can use the section semester grade sheet to select a department,
study year, section, academic year, and semester. It groups mapped courses into
separate modules and lists the section's students vertically under each course;
changed scores across the sheet can be saved together. Scores are whole numbers
from 0 to 100. Letter grades are derived from scores, and the student's
cumulative GPA includes saved grades under the existing grading rules.
Individual student enrollment remains available, including for
transferred students. For cohort transitions, administrators select a
department, source study year and semester, destination study year and
semester. Only students in that department and source study term are moved;
their current academic year remains unchanged, and the new courses follow the
department's destination curriculum without section-level distinctions.
Students in the
department's final year, Semester 2 are not moved because that term is for
graduation. Existing grades and dropped enrollments are preserved. Lecturer
accounts and lecturer login are not enabled.
Departments define a program duration of 1–7 years. Student enrollment selects
a study year within the department's duration, current academic year, and
semester. The student is assigned courses mapped to that department, study
year, and semester for the selected academic year. Section does not affect
course assignment, so students in different sections share the same eligible
courses. The current academic year and semester are saved on the student
profile. Missing eligible enrollments are synchronized when a student profile
or course mapping changes and during database initialization; existing grade
and dropped-enrollment records are preserved. Staff can advance a student's
year in the student edit form. When adding a course, staff select its
department, study year, and semester; the year choices are limited to that
department's program duration. Staff can still deliberately drop or restore
enrollments. Existing departments need
their program duration configured before enrollment; valid legacy course
year/semester mappings are migrated into the department curriculum.
When upgrading a database with one existing admin account, the configured
`ADMIN_EMAIL` is attached to that account. If there are multiple older admin
accounts without emails, assign distinct emails to them before starting the
upgraded API.

Before using real student records, deploy behind HTTPS, replace all example
credentials with unique secrets, and restrict database access to the application.

## Current portal behavior

- Students sign in using username and password. Administrators use the
  separate staff sign-in page at `/admin/login` with email and password; there
  is no public admin sign-in button on the student login page.
- Successful staff sign-in opens `/admin`. The frontend host must serve the
  single-page app for these paths. The URL is not an access control; the API
  enforces the administrator role on every administrative endpoint.
- Passwords are stored as bcrypt hashes; login sessions use an HttpOnly cookie
  and are stored in MySQL.
- After student sign-in, the student portal provides Home, Academic status, and
  Course lists routes. The home route welcomes the student; academic status
  shows semester GPA, academic-year CGPA, cumulative GPA, and a downloadable PDF
  grade report. Course lists show all courses taken by the signed-in student
  and their letter grades. The administrator's full course catalog is hidden
  until searched by course name or code. Student endpoints expose only the
  signed-in student's records;
  administrative records are not available to student accounts.
- Course scores are whole numbers from 0 to 100. The current scale is A+ 90–100
  (4.0), A 85–89 (4.0), A− 80–84 (3.75), B+ 75–79 (3.5), B 70–74 (3.0),
  B− 65–69 (2.75), C+ 60–64 (2.5), C 55–59 (2.0), D 50–54 (1.0), and F
  below 50 (0.0).
- GPA is the sum of (grade points × course credit hours) divided by the total
  credit hours for graded courses. Courses without a score are excluded.
- Formal academic standing rules are undecided. GPA metrics are calculated from
  the grade scale above; courses without a score are listed as in progress and
  excluded from GPA calculations.

## Validate

```sh
npm run typecheck
npm run build
npm test
```
