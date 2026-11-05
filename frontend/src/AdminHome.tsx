import { useEffect, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import {
  readError,
  requestJson,
  semesters,
  studyYears,
  type AdminOverview,
  type AdminStudent,
  type AdminStudentRecord,
  type GradeReport,
  type GradeReportCell,
} from "./shared";

function GradeSheet({
  report,
  scores,
  onScoreChange,
  onSave,
  isSaving,
}: {
  report: GradeReport;
  scores: Record<number, string>;
  onScoreChange: (enrollmentId: number, score: string) => void;
  onSave: () => void;
  isSaving: boolean;
}) {
  if (report.students.length === 0 || report.courses.length === 0) {
    return (
      <p className="empty-state">
        No students or courses were found for this section and semester.
      </p>
    );
  }

  return (
    <div className="grade-sheet-section">
      <div className="grade-sheet-heading">
        <div>
          <h3>Section grade sheet</h3>
          <p>Open a course to enter scores for its students. Save all course changes together.</p>
        </div>
        <span>{report.students.length} students · {report.courses.length} courses</span>
      </div>
      <div className="grade-course-modules">
        {report.courses.map((course, index) => {
          const studentGrades = report.students.map((student) => ({
            student,
            grade: student.grades.find((entry) => entry.courseId === course.id),
          }));
          const enrolledCount = studentGrades.filter(
            ({ grade }) => grade?.enrollmentId !== null && grade?.enrollmentId !== undefined,
          ).length;

          return (
            <details className="grade-course-module" key={course.id} open={index === 0}>
              <summary>
                <span className="grade-course-title">
                  <strong>{course.code} · {course.name}</strong>
                  <small>{course.creditHours} credits</small>
                </span>
                <span className="grade-course-count">
                  {enrolledCount} of {report.students.length} students
                </span>
              </summary>
              <div className="grade-student-list">
                {studentGrades.map(({ student, grade }) => {
                  if (grade?.enrollmentId === null || grade?.enrollmentId === undefined) {
                    return (
                      <div className="grade-student-row is-unenrolled" key={student.studentUserId}>
                        <div className="grade-student-name">
                          <strong>{student.fullName}</strong>
                          <small>{student.studentNumber}</small>
                        </div>
                        <span className="grade-sheet-missing">Not enrolled</span>
                      </div>
                    );
                  }
                  const enrollmentId = grade.enrollmentId;

                  return (
                    <div className="grade-student-row" key={student.studentUserId}>
                      <div className="grade-student-name">
                        <strong>{student.fullName}</strong>
                        <small>{student.studentNumber}</small>
                      </div>
                      <label className="grade-score-field">
                        <span>Score</span>
                        <input
                          aria-label={`${student.fullName}, ${course.code} score`}
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                          placeholder="—"
                          value={scores[enrollmentId] ?? ""}
                          onChange={(event) =>
                            onScoreChange(enrollmentId, event.target.value)
                          }
                        />
                      </label>
                      <span className="grade-sheet-letter">
                        {grade.letterGrade ? `Grade ${grade.letterGrade}` : "Pending"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
      <button
        className="admin-submit"
        disabled={isSaving}
        onClick={onSave}
        type="button"
      >
        {isSaving ? "Saving grades…" : "Save all grades"}
      </button>
    </div>
  );
}

export default function AdminHome() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [courseDepartmentId, setCourseDepartmentId] = useState("");
  const [courseStudyYear, setCourseStudyYear] = useState("");
  const [courseSearch, setCourseSearch] = useState("");
  const [studentDepartmentId, setStudentDepartmentId] = useState("");
  const [studentStudyYear, setStudentStudyYear] = useState("");
  const [studentSearchName, setStudentSearchName] = useState("");
  const [studentSearchResults, setStudentSearchResults] = useState<AdminStudent[]>([]);
  const [isSearchingStudents, setIsSearchingStudents] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<AdminStudentRecord | null>(null);
  const [isLoadingStudent, setIsLoadingStudent] = useState(false);
  const [gradeDepartmentId, setGradeDepartmentId] = useState("");
  const [gradeStudyYear, setGradeStudyYear] = useState("");
  const [gradeSection, setGradeSection] = useState("");
  const [gradeAcademicYear, setGradeAcademicYear] = useState("");
  const [gradeSemester, setGradeSemester] = useState("");
  const [gradeReport, setGradeReport] = useState<GradeReport | null>(null);
  const [gradeScores, setGradeScores] = useState<Record<number, string>>({});
  const [isLoadingGradeReport, setIsLoadingGradeReport] = useState(false);
  const [isSavingGradeReport, setIsSavingGradeReport] = useState(false);
  const [isBulkEnrolling, setIsBulkEnrolling] = useState(false);
  const [bulkDepartmentId, setBulkDepartmentId] = useState("");
  const [bulkFromStudyYear, setBulkFromStudyYear] = useState("");
  const [bulkFromSemester, setBulkFromSemester] = useState("");
  const [bulkToStudyYear, setBulkToStudyYear] = useState("");
  const [bulkToSemester, setBulkToSemester] = useState("");

  useEffect(() => {
    const loadOverview = async () => {
      setIsLoading(true);
      try {
        const result = await requestJson<AdminOverview>("/api/admin/overview");
        setOverview(result);
        setLoadError("");
      } catch (error) {
        setLoadError(
          error instanceof Error ? error.message : "Unable to load administrator data.",
        );
      } finally {
        setIsLoading(false);
      }
    };

    void loadOverview();
  }, [refreshKey]);

  useEffect(() => {
    if (selectedStudentId === null) {
      setSelectedStudent(null);
      return;
    }

    let isCurrent = true;
    setIsLoadingStudent(true);
    void requestJson<AdminStudentRecord>(`/api/admin/students/${selectedStudentId}`)
      .then((student) => {
        if (isCurrent) {
          setSelectedStudent(student);
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setSelectedStudent(null);
          setNotice(error instanceof Error ? error.message : "Unable to load the student record.");
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoadingStudent(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [selectedStudentId, refreshKey]);

  const submitForm = async (
    event: FormEvent<HTMLFormElement>,
    path: string,
    makeBody: (formData: FormData) => Record<string, unknown>,
    method: "POST" | "PATCH" | "DELETE" = "POST",
  ) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setNotice("");
    try {
      const response = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeBody(formData)),
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const result = response.status === 204
        ? null
        : (await response.json()) as { message?: unknown };
      form.reset();
      if (path === "/api/admin/courses") {
        setCourseDepartmentId("");
        setCourseStudyYear("");
      }
      if (path === "/api/admin/students") {
        setStudentDepartmentId("");
        setStudentStudyYear("");
      }
      setNotice(typeof result?.message === "string" ? result.message : "Changes saved.");
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save changes.");
    }
  };

  const deleteRecord = async (
    event: MouseEvent<HTMLButtonElement>,
    path: string,
    label: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (!window.confirm(`Delete this ${label}? This action cannot be undone.`)) {
      return;
    }

    setNotice("");
    try {
      const response = await fetch(path, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await readError(response));
      }

      if (label === "department") {
        setCourseDepartmentId("");
        setCourseStudyYear("");
        setStudentDepartmentId("");
        setStudentStudyYear("");
        setGradeDepartmentId("");
        setGradeStudyYear("");
        setGradeReport(null);
        setGradeScores({});
      } else {
        setGradeReport(null);
        setGradeScores({});
      }
      setNotice(`${label[0].toUpperCase()}${label.slice(1)} deleted.`);
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `Unable to delete the ${label}.`);
    }
  };

  const selectDepartments = () =>
    overview?.departments.map((department) => (
      <option key={department.id} value={department.id}>
        {department.name} ({department.code}) · {department.programYears
          ? `${department.programYears}-year program`
          : "duration not configured"}
      </option>
    ));

  const searchStudents = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = studentSearchName.trim();
    if (name.length < 2) {
      setNotice("Enter at least 2 characters of the student's name.");
      return;
    }

    setIsSearchingStudents(true);
    setStudentSearchResults([]);
    setSelectedStudentId(null);
    setSelectedStudent(null);
    try {
      const result = await requestJson<{ students: AdminStudent[] }>(
        `/api/admin/students/search?name=${encodeURIComponent(name)}`,
      );
      setStudentSearchResults(result.students);
      setNotice(
        result.students.length === 0
          ? "No students matched that name."
          : `Found ${result.students.length} matching students.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to search students.");
    } finally {
      setIsSearchingStudents(false);
    }
  };

  const bulkEnrollStudents = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !bulkDepartmentId ||
      !bulkFromStudyYear ||
      !bulkFromSemester ||
      !bulkToStudyYear ||
      !bulkToSemester
    ) {
      setNotice("Select the department, source study term, and destination study term.");
      return;
    }

    const departmentName = overview?.departments.find(
      (department) => department.id === Number(bulkDepartmentId),
    )?.name ?? "selected department";
    const confirmed = window.confirm(
      `Move students in ${departmentName} from study year ${bulkFromStudyYear}, ${bulkFromSemester} ` +
      `to study year ${bulkToStudyYear}, ${bulkToSemester}? ` +
      "Only students in the selected department and source term will be moved. Their current academic year will stay unchanged; section will not be used.",
    );
    if (!confirmed) {
      return;
    }

    setIsBulkEnrolling(true);
    setNotice("");
    try {
      const result = await requestJson<{ message: string }>("/api/admin/enrollments/bulk", {
        method: "POST",
        body: JSON.stringify({
          departmentId: Number(bulkDepartmentId),
          fromStudyYear: Number(bulkFromStudyYear),
          fromSemester: bulkFromSemester,
          toStudyYear: Number(bulkToStudyYear),
          toSemester: bulkToSemester,
        }),
      });
      setNotice(result.message);
      setBulkFromStudyYear(bulkToStudyYear);
      setBulkFromSemester(bulkToSemester);
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to bulk enroll students.");
    } finally {
      setIsBulkEnrolling(false);
    }
  };

  const gradeDepartment = overview?.departments.find(
    (department) => department.id === Number(gradeDepartmentId),
  );
  const gradeCourses = overview?.courses.filter(
    (course) =>
      course.departmentId === Number(gradeDepartmentId) &&
      course.curriculum.some((entry) => entry.studyYear === Number(gradeStudyYear)),
  ) ?? [];
  const gradeSemesters = [...new Set(gradeCourses.flatMap((course) =>
    course.curriculum
      .filter((entry) => entry.studyYear === Number(gradeStudyYear))
      .map((entry) => entry.semester),
  ))];
  const loadGradeReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoadingGradeReport(true);
    setNotice("");
    const query = new URLSearchParams({
      departmentId: gradeDepartmentId,
      studyYear: gradeStudyYear,
      section: gradeSection,
      academicYear: gradeAcademicYear.trim(),
      semester: gradeSemester,
    });
    try {
      const result = await requestJson<GradeReport>(
        `/api/admin/grade-report?${query.toString()}`,
      );
      setGradeReport(result);
      setGradeScores(Object.fromEntries(
        result.students.flatMap((student) => student.grades)
          .filter((grade): grade is GradeReportCell & { enrollmentId: number } =>
            grade.enrollmentId !== null,
          )
          .map((grade) => [grade.enrollmentId, grade.score === null ? "" : String(grade.score)]),
      ));
      setNotice(
        result.students.length === 0 || result.courses.length === 0
          ? "No students or mapped courses were found for this section and semester."
          : `Loaded ${result.students.length} students and ${result.courses.length} courses for this section.`,
      );
    } catch (error) {
      setGradeReport(null);
      setNotice(error instanceof Error ? error.message : "Unable to load the grade report.");
    } finally {
      setIsLoadingGradeReport(false);
    }
  };

  const saveGradeSheet = async () => {
    if (!gradeReport) {
      return;
    }

    const grades = gradeReport.students.flatMap((student) => student.grades)
      .filter((grade): grade is GradeReportCell & { enrollmentId: number } =>
        grade.enrollmentId !== null,
      )
      .map((grade) => {
        const rawScore = gradeScores[grade.enrollmentId] ?? "";
        return {
          enrollmentId: grade.enrollmentId,
          score: rawScore.trim() === "" ? null : Number(rawScore),
          isChanged: rawScore !== (grade.score === null ? "" : String(grade.score)),
        };
      })
      .filter((grade) => grade.isChanged)
      .map(({ enrollmentId, score }) => ({ enrollmentId, score }));
    if (grades.length === 0) {
      setNotice("There are no grade changes to save.");
      return;
    }
    if (!gradeReport.students.length) {
      setNotice("There are no active course enrollments in this section to grade.");
      return;
    }
    if (grades.some(({ score }) =>
      score !== null && (!Number.isInteger(score) || score < 0 || score > 100),
    )) {
      setNotice("Course scores must be whole numbers from 0 to 100.");
      return;
    }

    setIsSavingGradeReport(true);
    setNotice("");
    try {
      const result = await requestJson<{
        message: string;
        grades: Array<{ enrollmentId: number; score: number | null; letterGrade: string | null }>;
      }>("/api/admin/grade-report/scores", {
        method: "PATCH",
        body: JSON.stringify({
          departmentId: Number(gradeDepartmentId),
          studyYear: Number(gradeStudyYear),
          section: gradeSection,
          academicYear: gradeAcademicYear.trim(),
          semester: gradeSemester,
          grades,
        }),
      });
      const savedGrades = new Map(result.grades.map((grade) => [grade.enrollmentId, grade]));
      setGradeReport((current) => current && ({
        ...current,
        students: current.students.map((student) => ({
          ...student,
          grades: student.grades.map((grade) => {
            if (grade.enrollmentId === null) {
              return grade;
            }
            const saved = savedGrades.get(grade.enrollmentId);
            return saved
              ? { ...grade, score: saved.score, letterGrade: saved.letterGrade }
              : grade;
          }),
        })),
      }));
      setNotice(result.message);
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save the grade sheet.");
    } finally {
      setIsSavingGradeReport(false);
    }
  };

  if (isLoading && !overview) {
    return <p className="loading-message">Loading administrator workspace…</p>;
  }

  if (!overview) {
    return (
      <section className="message-panel">
        <p className="eyebrow">ADMINISTRATOR</p>
        <h1>Admin workspace unavailable.</h1>
        <p role="alert">{loadError}</p>
      </section>
    );
  }

  const selectedCourseDepartment = overview.departments.find(
    (department) => department.id === Number(courseDepartmentId),
  );
  const selectedStudentDepartment = overview.departments.find(
    (department) => department.id === Number(studentDepartmentId),
  );
  const selectedBulkDepartment = overview.departments.find(
    (department) => department.id === Number(bulkDepartmentId),
  );
  const bulkFromSemesters = semesters.filter((semester) =>
    overview.courses.some((course) =>
      course.departmentId === Number(bulkDepartmentId) &&
      course.curriculum.some((entry) =>
        entry.studyYear === Number(bulkFromStudyYear) && entry.semester === semester,
      ),
    ),
  );
  const bulkToSemesters = semesters.filter((semester) =>
    overview.courses.some((course) =>
      course.departmentId === Number(bulkDepartmentId) &&
      course.curriculum.some((entry) =>
        entry.studyYear === Number(bulkToStudyYear) && entry.semester === semester,
      ),
    ),
  );
  const normalizedCourseSearch = courseSearch.trim().toLocaleLowerCase();
  const filteredCourses = normalizedCourseSearch.length < 2
    ? []
    : overview.courses.filter((course) =>
        `${course.code} ${course.name}`.toLocaleLowerCase().includes(normalizedCourseSearch),
      );
  return (
    <section className="admin-dashboard">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">ADMINISTRATION</p>
          <h1>Portal management</h1>
          <p className="intro">Manage the academic records used by student accounts.</p>
        </div>
      </div>

      <div className="admin-counts">
        <SummaryCard label="Departments" value={String(overview.departments.length)} detail="Academic units" accent="blue" />
        <SummaryCard label="Courses" value={String(overview.courses.length)} detail="Course catalog" accent="green" />
        <SummaryCard label="Students" value={String(overview.studentCount)} detail="Student accounts" accent="gold" />
      </div>

      {notice && <p className="admin-notice" role="status">{notice}</p>}
      {loadError && <p className="global-error" role="alert">{loadError}</p>}

      <AdminPanel
        title="Section semester grade sheet"
        description="Choose a department, study year, section, and semester to load all students and courses for that section. Enter scores in the sheet and save them together."
      >
        <form onSubmit={loadGradeReport}>
          <label className="field-label" htmlFor="grade-department">Department</label>
          <select
            id="grade-department"
            required
            value={gradeDepartmentId}
            onChange={(event) => {
              setGradeDepartmentId(event.target.value);
              setGradeStudyYear("");
              setGradeSection("");
              setGradeSemester("");
              setGradeReport(null);
              setGradeScores({});
            }}
          >
            <option value="" disabled>Select a department</option>
            {selectDepartments()}
          </select>
          <div className="field-pair">
            <div>
              <label className="field-label" htmlFor="grade-study-year">Year of study</label>
              <select
                id="grade-study-year"
                required
                value={gradeStudyYear}
                disabled={!gradeDepartment?.programYears}
                onChange={(event) => {
                  setGradeStudyYear(event.target.value);
                  setGradeSection("");
                  setGradeSemester("");
                  setGradeReport(null);
                  setGradeScores({});
                }}
              >
                <option value="" disabled>Select year</option>
                {studyYears.slice(0, gradeDepartment?.programYears ?? 0)
                  .map((year, index) => <option key={year} value={index + 1}>{year}</option>)}
              </select>
            </div>
          </div>
          <div className="field-pair">
            <div>
              <label className="field-label" htmlFor="grade-section">Section</label>
              <input
                id="grade-section"
                type="text"
                required
                maxLength={20}
                placeholder="A"
                value={gradeSection}
                onChange={(event) => {
                  setGradeSection(event.target.value);
                  setGradeReport(null);
                }}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="grade-academic-year">Academic year</label>
              <input
                id="grade-academic-year"
                required
                maxLength={20}
                placeholder="2025/2026"
                value={gradeAcademicYear}
                onChange={(event) => {
                  setGradeAcademicYear(event.target.value);
                  setGradeReport(null);
                }}
              />
            </div>
          </div>
          <label className="field-label" htmlFor="grade-semester">Semester</label>
          <select
            id="grade-semester"
            required
            value={gradeSemester}
            disabled={gradeSemesters.length === 0}
            onChange={(event) => {
              setGradeSemester(event.target.value);
              setGradeReport(null);
              setGradeScores({});
            }}
          >
            <option value="" disabled>Select semester</option>
            {semesters.filter((semester) => gradeSemesters.includes(semester))
              .map((semester) => <option key={semester}>{semester}</option>)}
          </select>
          <button
            className="admin-submit"
            type="submit"
            disabled={isLoadingGradeReport}
          >
            {isLoadingGradeReport ? "Loading report…" : "Load grade report"}
          </button>
        </form>

        {gradeReport && (
          <GradeSheet
            report={gradeReport}
            scores={gradeScores}
            onScoreChange={(enrollmentId, score) =>
              setGradeScores((current) => ({ ...current, [enrollmentId]: score }))
            }
            onSave={() => void saveGradeSheet()}
            isSaving={isSavingGradeReport}
          />
        )}
      </AdminPanel>

      <div className="admin-forms">
        <AdminPanel title="Add department" description="Set the department's program duration; new students start in 1st year.">
          <form onSubmit={(event) => submitForm(event, "/api/admin/departments", (form) => ({
            name: form.get("name"),
            code: form.get("code"),
            programYears: Number(form.get("programYears")),
          }))}>
            <label className="field-label" htmlFor="department-name">Department name</label>
            <input id="department-name" name="name" required maxLength={150} placeholder="Computer Science" />
            <label className="field-label" htmlFor="department-code">Department code</label>
            <input id="department-code" name="code" required maxLength={30} placeholder="CS" />
            <label className="field-label" htmlFor="department-program-years">Program duration</label>
            <select id="department-program-years" name="programYears" required defaultValue="">
              <option value="" disabled>Select program duration</option>
              {studyYears.map((year, index) => <option key={year} value={index + 1}>{year}</option>)}
            </select>
            <button className="admin-submit" type="submit">Add department</button>
          </form>
        </AdminPanel>

        <AdminPanel title="Add course" description="Choose the department, study year, and semester for this course.">
          <form onSubmit={(event) => submitForm(event, "/api/admin/courses", (form) => ({
            departmentId: Number(form.get("departmentId")),
            code: form.get("code"),
            name: form.get("name"),
            creditHours: Number(form.get("creditHours")),
            studyYear: Number(form.get("studyYear")),
            semester: form.get("semester"),
          }))}>
            <label className="field-label" htmlFor="course-department">Department</label>
            <select
              id="course-department"
              name="departmentId"
              required
              value={courseDepartmentId}
              onChange={(event) => {
                setCourseDepartmentId(event.target.value);
                setCourseStudyYear("");
              }}
            >
              <option value="" disabled>Select a department</option>
              {selectDepartments()}
            </select>
            <div className="field-pair">
              <div>
                <label className="field-label" htmlFor="course-study-year">Year of study</label>
                <select
                  id="course-study-year"
                  name="studyYear"
                  required
                  value={courseStudyYear}
                  onChange={(event) => setCourseStudyYear(event.target.value)}
                  disabled={!selectedCourseDepartment?.programYears}
                >
                  <option value="" disabled>
                    {selectedCourseDepartment?.programYears
                      ? "Select year of study"
                      : selectedCourseDepartment
                        ? "Configure program duration first"
                        : "Select a department first"}
                  </option>
                  {studyYears.slice(0, selectedCourseDepartment?.programYears ?? 0)
                    .map((year, index) => <option key={year} value={index + 1}>{year}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="course-semester">Semester</label>
                <select id="course-semester" name="semester" required defaultValue="">
                  <option value="" disabled>Select semester</option>
                  {semesters.map((semester) => <option key={semester}>{semester}</option>)}
                </select>
              </div>
            </div>
            <label className="field-label" htmlFor="course-code">Course code</label>
            <input id="course-code" name="code" required maxLength={30} placeholder="CS201" />
            <label className="field-label" htmlFor="course-name">Course name</label>
            <input id="course-name" name="name" required maxLength={200} placeholder="Computer Architecture" />
            <label className="field-label" htmlFor="course-credits">Credit hours</label>
            <input id="course-credits" name="creditHours" type="number" min="0.1" max="999.9" step="0.1" required />
            <button className="admin-submit" disabled={overview.departments.length === 0} type="submit">Add course</button>
          </form>
        </AdminPanel>

        <AdminPanel title="Enroll a student" description="Create a student account and assign courses for their department, study year, current academic year, and semester.">
          <form onSubmit={(event) => submitForm(event, "/api/admin/students", (form) => ({
            password: form.get("password"),
            fullName: form.get("fullName"),
            studentNumber: form.get("studentNumber"),
            departmentId: Number(form.get("departmentId")),
            studyYear: Number(form.get("studyYear")),
            section: form.get("section"),
            academicYear: form.get("academicYear"),
            semester: form.get("semester"),
          }))}>
            <label className="field-label" htmlFor="student-name">Student full name</label>
            <input id="student-name" name="fullName" required maxLength={200} />
            <label className="field-label" htmlFor="student-number">Student ID (also used to sign in)</label>
            <input id="student-number" name="studentNumber" required maxLength={50} />
            <label className="field-label" htmlFor="student-password">Temporary password (12+ characters, up to 72)</label>
            <input id="student-password" name="password" type="password" minLength={12} maxLength={72} required autoComplete="new-password" />
            <label className="field-label" htmlFor="student-department">Department</label>
            <select
              id="student-department"
              name="departmentId"
              required
              value={studentDepartmentId}
              onChange={(event) => {
                setStudentDepartmentId(event.target.value);
                setStudentStudyYear("");
              }}
            >
              <option value="" disabled>Select a department</option>
              {selectDepartments()}
            </select>
            <div className="field-pair">
              <div>
                <label className="field-label" htmlFor="student-study-year">Study year</label>
                <select
                  id="student-study-year"
                  name="studyYear"
                  required
                  value={studentStudyYear}
                  onChange={(event) => setStudentStudyYear(event.target.value)}
                  disabled={!selectedStudentDepartment?.programYears}
                >
                  <option value="" disabled>
                    {selectedStudentDepartment?.programYears
                      ? "Select study year"
                      : selectedStudentDepartment
                        ? "Configure program duration first"
                        : "Select a department first"}
                  </option>
                  {studyYears.slice(0, selectedStudentDepartment?.programYears ?? 0)
                    .map((year, index) => <option key={year} value={index + 1}>{year}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="student-section">Section</label>
                <input id="student-section" name="section" required maxLength={20} placeholder="A" />
              </div>
            </div>
            <div className="field-pair">
              <div>
                <label className="field-label" htmlFor="student-academic-year">Current academic year</label>
                <input id="student-academic-year" name="academicYear" required maxLength={20} placeholder="2025/2026" />
              </div>
              <div>
                <label className="field-label" htmlFor="student-semester">Starting semester</label>
                <select id="student-semester" name="semester" required defaultValue="">
                  <option value="" disabled>Select semester</option>
                  {semesters.map((semester) => <option key={semester}>{semester}</option>)}
                </select>
              </div>
            </div>
            <button className="admin-submit" disabled={overview.departments.length === 0} type="submit">Create student</button>
          </form>
        </AdminPanel>

        <AdminPanel
          title="Bulk transfer a study cohort"
          description="Select one department and move students from a source study year and semester to a destination study year and semester. Courses are assigned from that department's destination curriculum."
        >
          <form onSubmit={bulkEnrollStudents}>
            <label className="field-label" htmlFor="bulk-department">Department</label>
            <select
              id="bulk-department"
              required
              value={bulkDepartmentId}
              onChange={(event) => {
                setBulkDepartmentId(event.target.value);
                setBulkFromStudyYear("");
                setBulkFromSemester("");
                setBulkToStudyYear("");
                setBulkToSemester("");
              }}
            >
              <option value="" disabled>Select a department</option>
              {selectDepartments()}
            </select>
            <div className="bulk-term-group">
              <p className="bulk-term-title">Current study term</p>
              <div className="field-pair">
                <div>
                  <label className="field-label" htmlFor="bulk-from-study-year">Current year of study</label>
                  <select
                    id="bulk-from-study-year"
                    required
                    value={bulkFromStudyYear}
                    disabled={!selectedBulkDepartment?.programYears}
                    onChange={(event) => {
                      setBulkFromStudyYear(event.target.value);
                      setBulkFromSemester("");
                    }}
                  >
                    <option value="" disabled>Select year</option>
                    {studyYears.slice(0, selectedBulkDepartment?.programYears ?? 0)
                      .map((year, index) => <option key={year} value={index + 1}>{year}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="bulk-from-semester">Current semester</label>
                  <select
                    id="bulk-from-semester"
                    required
                    value={bulkFromSemester}
                    disabled={!bulkFromSemesters.length}
                    onChange={(event) => setBulkFromSemester(event.target.value)}
                  >
                    <option value="" disabled>Select semester</option>
                    {bulkFromSemesters.map((semester) => <option key={semester}>{semester}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="bulk-term-group">
              <p className="bulk-term-title">Destination study term</p>
              <div className="field-pair">
                <div>
                  <label className="field-label" htmlFor="bulk-to-study-year">Next year of study</label>
                  <select
                    id="bulk-to-study-year"
                    required
                    value={bulkToStudyYear}
                    disabled={!selectedBulkDepartment?.programYears}
                    onChange={(event) => {
                      setBulkToStudyYear(event.target.value);
                      setBulkToSemester("");
                    }}
                  >
                    <option value="" disabled>Select year</option>
                    {studyYears.slice(0, selectedBulkDepartment?.programYears ?? 0)
                      .map((year, index) => <option key={year} value={index + 1}>{year}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="bulk-to-semester">Next semester</label>
                  <select
                    id="bulk-to-semester"
                    required
                    value={bulkToSemester}
                    disabled={!bulkToSemesters.length}
                    onChange={(event) => setBulkToSemester(event.target.value)}
                  >
                    <option value="" disabled>Select semester</option>
                    {bulkToSemesters.map((semester) => <option key={semester}>{semester}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <p className="bulk-enrollment-note">
              Example: move first-year, Semester 1 students to first-year, Semester 2. Only the selected department and current study term are included. Student academic years stay unchanged, section is ignored, and existing grades and dropped enrollments are preserved. Students in the final year, Semester 2 are ready for graduation.
            </p>
            <button className="admin-submit" disabled={isBulkEnrolling} type="submit">
              {isBulkEnrolling ? "Transferring students…" : "Transfer assigned students"}
            </button>
          </form>
        </AdminPanel>

      </div>

      <section className="admin-list-section">
        <div className="section-heading"><div><p className="eyebrow">RECORDS</p><h2>Departments</h2></div></div>
        <div className="admin-record-list">
          {overview.departments.map((department) => (
            <details className="admin-record" key={department.id}>
              <summary><strong>{department.name}</strong><span>{department.code} · {department.programYears ? `${department.programYears}-year program` : "Program duration not configured"}</span><span className="record-actions"><span className="record-action">Edit</span><button className="record-delete-button" type="button" onClick={(event) => void deleteRecord(event, `/api/admin/departments/${department.id}`, "department")}>Delete</button></span></summary>
              <form className="record-edit-form" onSubmit={(event) => submitForm(event, `/api/admin/departments/${department.id}`, (form) => ({
                name: form.get("name"),
                code: form.get("code"),
                programYears: Number(form.get("programYears")),
              }), "PATCH")}>
                <label className="field-label" htmlFor={`department-name-${department.id}`}>Name</label>
                <input id={`department-name-${department.id}`} name="name" required maxLength={150} defaultValue={department.name} />
                <label className="field-label" htmlFor={`department-code-${department.id}`}>Code</label>
                <input id={`department-code-${department.id}`} name="code" required maxLength={30} defaultValue={department.code} />
                <label className="field-label" htmlFor={`department-program-years-${department.id}`}>Program duration</label>
                <select id={`department-program-years-${department.id}`} name="programYears" required defaultValue={department.programYears ?? ""}>
                  <option value="" disabled>Select program duration</option>
                  {studyYears.map((year, index) => <option key={year} value={index + 1}>{year}</option>)}
                </select>
                <button className="admin-submit" type="submit">Save department</button>
              </form>
            </details>
          ))}
          {overview.departments.length === 0 && <p className="empty-state">No departments added.</p>}
        </div>
      </section>

      <section className="admin-list-section">
        <div className="section-heading"><div><p className="eyebrow">RECORDS</p><h2>Courses</h2></div></div>
        <div className="catalog-search">
          <label className="field-label" htmlFor="catalog-course-search">Search courses by name or code</label>
          <input
            id="catalog-course-search"
            type="search"
            minLength={2}
            maxLength={200}
            placeholder="Type at least 2 characters"
            value={courseSearch}
            onChange={(event) => setCourseSearch(event.target.value)}
          />
          {normalizedCourseSearch.length >= 2 && (
            <p className="course-search-count">
              {filteredCourses.length} matching {filteredCourses.length === 1 ? "course" : "courses"}
            </p>
          )}
        </div>
        <div className="admin-record-list">
          {filteredCourses.map((course) => (
            <details className="admin-record" key={course.id}>
              <summary><strong>{course.code} · {course.name}</strong><span>{course.departmentName} · {course.creditHours} credits · {course.curriculum.length > 0
                ? course.curriculum.map((entry) => `${studyYears[entry.studyYear - 1]} ${entry.semester}`).join(", ")
                : "Not assigned to curriculum"}</span><span className="record-actions"><span className="record-action">Edit</span><button className="record-delete-button" type="button" onClick={(event) => void deleteRecord(event, `/api/admin/courses/${course.id}`, "course")}>Delete</button></span></summary>
              <form
                className="record-edit-form"
                onSubmit={(event) => submitForm(event, `/api/admin/courses/${course.id}`, (form) => {
                  const studyYearValues = form.getAll("studyYear");
                  const semesterValues = form.getAll("semester");
                  return {
                    departmentId: Number(form.get("departmentId")),
                    code: form.get("code"),
                    name: form.get("name"),
                    creditHours: Number(form.get("creditHours")),
                    curriculum: studyYearValues.map((studyYear, index) => ({
                      studyYear: Number(studyYear),
                      semester: semesterValues[index],
                    })),
                  };
                }, "PATCH")}
              >
                <label className="field-label" htmlFor={`course-department-${course.id}`}>Department</label>
                <select id={`course-department-${course.id}`} name="departmentId" defaultValue={course.departmentId} required>
                  {selectDepartments()}
                </select>
                <label className="field-label" htmlFor={`course-code-${course.id}`}>Code</label>
                <input id={`course-code-${course.id}`} name="code" required maxLength={30} defaultValue={course.code} />
                <label className="field-label" htmlFor={`course-name-${course.id}`}>Name</label>
                <input id={`course-name-${course.id}`} name="name" required maxLength={200} defaultValue={course.name} />
                <label className="field-label" htmlFor={`course-credits-${course.id}`}>Credit hours</label>
                <input id={`course-credits-${course.id}`} name="creditHours" type="number" min="0.1" max="999.9" step="0.1" required defaultValue={course.creditHours} />
                {(course.curriculum.length > 0 ? course.curriculum : [null]).map((entry, index) => (
                  <div key={entry ? `${entry.studyYear}-${entry.semester}` : "new-mapping"}>
                    <div className="field-pair">
                      <div>
                        <label className="field-label" htmlFor={`course-study-year-${course.id}-${index}`}>Year of study</label>
                        <select
                          id={`course-study-year-${course.id}-${index}`}
                          name="studyYear"
                          required
                          defaultValue={entry?.studyYear ?? ""}
                        >
                          {!entry && <option value="" disabled>Select year of study</option>}
                          {studyYears.slice(0, overview.departments.find(
                            (department) => department.id === course.departmentId,
                          )?.programYears ?? 0).map((year, yearIndex) => (
                            <option key={year} value={yearIndex + 1}>{year}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="field-label" htmlFor={`course-semester-${course.id}-${index}`}>Semester</label>
                        <select
                          id={`course-semester-${course.id}-${index}`}
                          name="semester"
                          required
                          defaultValue={entry?.semester ?? ""}
                        >
                          {!entry && <option value="" disabled>Select semester</option>}
                          {semesters.map((semester) => <option key={semester}>{semester}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
                <button className="admin-submit" type="submit">Save course</button>
              </form>
              {course.curriculum.map((entry) => (
                <div key={`remove-${entry.studyYear}-${entry.semester}`}>
                  <form
                    className="record-edit-form"
                    onSubmit={(event) => submitForm(
                      event,
                      `/api/admin/curriculum/${course.id}/${entry.studyYear}/${encodeURIComponent(entry.semester)}`,
                      () => ({}),
                      "DELETE",
                    )}
                  >
                    <button className="admin-submit" type="submit">Remove curriculum mapping</button>
                  </form>
                </div>
              ))}
            </details>
          ))}
          {normalizedCourseSearch.length < 2 && (
            <p className="empty-state">Enter at least 2 characters to search the course catalog.</p>
          )}
          {normalizedCourseSearch.length >= 2 && filteredCourses.length === 0 && (
            <p className="empty-state">No courses matched that name or code.</p>
          )}
        </div>
      </section>

      <section className="admin-list-section">
        <div className="section-heading"><div><p className="eyebrow">RECORDS</p><h2>Find a student</h2></div></div>
        <form className="student-search-form" onSubmit={searchStudents}>
          <label className="field-label" htmlFor="student-search-name">Search by student name</label>
          <div className="student-search-controls">
            <input
              id="student-search-name"
              type="search"
              minLength={2}
              maxLength={200}
              required
              placeholder="Enter at least 2 characters"
              value={studentSearchName}
              onChange={(event) => setStudentSearchName(event.target.value)}
            />
            <button className="admin-submit" type="submit" disabled={isSearchingStudents}>
              {isSearchingStudents ? "Searching…" : "Search students"}
            </button>
          </div>
        </form>
        {studentSearchResults.length > 0 && (
          <div className="student-search-results" aria-label="Student search results">
            {studentSearchResults.map((student) => (
              <button
                className={`student-search-result${selectedStudentId === student.id ? " is-selected" : ""}`}
                key={student.id}
                type="button"
                onClick={() => setSelectedStudentId(student.id)}
              >
                <strong>{student.fullName}</strong>
                <span>{student.studentNumber} · {student.departmentName ?? "No department"} · {student.studyYear ? studyYears[student.studyYear - 1] : "Study year not assigned"} · Section {student.section ?? "Not assigned"}</span>
              </button>
            ))}
            {studentSearchResults.length === 20 && (
              <p className="empty-state">Showing the first 20 matches. Refine the name to find a specific student.</p>
            )}
          </div>
        )}

        {isLoadingStudent && <p className="loading-message">Loading student record…</p>}
        {selectedStudent && (
          <>
            <div className="section-heading student-record-heading">
              <div>
                <p className="eyebrow">STUDENT RECORD</p>
                <h2>{selectedStudent.fullName}</h2>
                <p className="intro">
                  {selectedStudent.studentNumber} · {selectedStudent.departmentName ?? "No department"} · {selectedStudent.studyYear ? studyYears[selectedStudent.studyYear - 1] : "Study year not assigned"} · Section {selectedStudent.section ?? "Not assigned"} · {selectedStudent.academicYear ?? "Academic year not set"}, {selectedStudent.semester ?? "Semester not set"}
                </p>
              </div>
            </div>
            <div className="student-admin-actions">
              <form className="record-edit-form" onSubmit={(event) => submitForm(event, `/api/admin/students/${selectedStudent.id}`, (form) => ({
                  fullName: form.get("fullName"),
                  studentNumber: form.get("studentNumber"),
                  departmentId: Number(form.get("departmentId")),
                  studyYear: Number(form.get("studyYear")),
                  academicYear: form.get("academicYear"),
                  semester: form.get("semester"),
                  section: form.get("section"),
                }), "PATCH")}>
                  <h3>Edit profile</h3>
                  <label className="field-label" htmlFor={`student-name-${selectedStudent.id}`}>Full name</label>
                  <input id={`student-name-${selectedStudent.id}`} name="fullName" required maxLength={200} defaultValue={selectedStudent.fullName} />
                  <label className="field-label" htmlFor={`student-number-${selectedStudent.id}`}>Student ID (also used to sign in)</label>
                  <input id={`student-number-${selectedStudent.id}`} name="studentNumber" required maxLength={50} defaultValue={selectedStudent.studentNumber} />
                  <label className="field-label" htmlFor={`student-department-${selectedStudent.id}`}>Department</label>
                  <select id={`student-department-${selectedStudent.id}`} name="departmentId" defaultValue={selectedStudent.departmentId ?? ""} required>
                    <option value="" disabled>Select a department</option>
                    {selectDepartments()}
                  </select>
                  <label className="field-label" htmlFor={`student-study-year-${selectedStudent.id}`}>Year of study</label>
                  <select id={`student-study-year-${selectedStudent.id}`} name="studyYear" defaultValue={selectedStudent.studyYear ?? ""} required>
                    <option value="" disabled>Select year of study</option>
                    {studyYears.map((year, index) => <option key={year} value={index + 1}>{year}</option>)}
                  </select>
                  <div className="field-pair">
                    <div>
                      <label className="field-label" htmlFor={`student-academic-year-${selectedStudent.id}`}>Current academic year</label>
                      <input
                        id={`student-academic-year-${selectedStudent.id}`}
                        name="academicYear"
                        required
                        maxLength={20}
                        placeholder="2026/2027"
                        defaultValue={selectedStudent.academicYear ?? ""}
                      />
                    </div>
                    <div>
                      <label className="field-label" htmlFor={`student-semester-${selectedStudent.id}`}>Current semester</label>
                      <select
                        id={`student-semester-${selectedStudent.id}`}
                        name="semester"
                        required
                        defaultValue={selectedStudent.semester ?? ""}
                      >
                        <option value="" disabled>Select semester</option>
                        {semesters.map((semester) => <option key={semester}>{semester}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="field-pair">
                    <div>
                      <label className="field-label" htmlFor={`student-section-${selectedStudent.id}`}>Section</label>
                      <input id={`student-section-${selectedStudent.id}`} name="section" required maxLength={20} defaultValue={selectedStudent.section ?? ""} />
                    </div>
                  </div>
                  <button className="admin-submit" type="submit">Save profile</button>
                </form>
                <form className="record-edit-form" onSubmit={(event) => submitForm(event, `/api/admin/students/${selectedStudent.id}/password`, (form) => ({
                  password: form.get("password"),
                }), "PATCH")}>
                  <h3>Reset password</h3>
                  <label className="field-label" htmlFor={`student-password-${selectedStudent.id}`}>New temporary password (12+ characters, up to 72)</label>
                  <input id={`student-password-${selectedStudent.id}`} name="password" type="password" minLength={12} maxLength={72} required autoComplete="new-password" />
                  <button className="admin-submit" type="submit">Reset password</button>
                </form>
            </div>
            <section className="student-enrollment-section">
              <div className="section-heading">
                <div><p className="eyebrow">ACADEMIC RECORDS</p><h2>Grades & enrollments</h2></div>
              </div>
              <div className="admin-record-list">
                {selectedStudent.enrollments.map((enrollment) => (
                  <div className="admin-record grade-record" key={enrollment.id}>
                    <div className="grade-record-title">
                      <strong>{enrollment.courseCode} · {enrollment.courseName}</strong>
                      <span>{enrollment.creditHours} credits · {enrollment.academicYear}, {enrollment.semester} · {enrollment.status}</span>
                    </div>
                    <div className="grade-record-actions">
                      <form className="score-form" onSubmit={(event) => submitForm(event, `/api/admin/enrollments/${enrollment.id}/score`, (form) => {
                  const rawScore = form.get("score");
                  return { score: rawScore === "" ? null : Number(rawScore) };
                }, "PATCH")}>
                  <label className="field-label" htmlFor={`score-${enrollment.id}`}>Score (0–100)</label>
                  <input id={`score-${enrollment.id}`} name="score" type="number" min="0" max="100" step="1" defaultValue={enrollment.score ?? ""} placeholder="Pending" />
                  <button className="admin-submit" type="submit">Save grade</button>
                      </form>
                      <form className="status-form" onSubmit={(event) => submitForm(event, `/api/admin/enrollments/${enrollment.id}/status`, (form) => ({
                  status: form.get("status"),
                }), "PATCH")}>
                  <label className="field-label" htmlFor={`status-${enrollment.id}`}>Enrollment</label>
                  <select id={`status-${enrollment.id}`} name="status" defaultValue={enrollment.status}>
                    <option value="enrolled">Enrolled</option>
                    <option value="dropped">Dropped</option>
                  </select>
                  <button className="admin-submit" type="submit">Save status</button>
                      </form>
                    </div>
                  </div>
                ))}
                {selectedStudent.enrollments.length === 0 && (
                  <p className="empty-state">No course enrollments recorded for this student.</p>
                )}
              </div>
            </section>
          </>
        )}
      </section>
    </section>
  );
}

function AdminPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="admin-panel">
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </section>
  );
}

export function SummaryCard({
  label,
  value,
  detail,
  accent,
}: {
  label: string;
  value: string;
  detail: string;
  accent: "blue" | "gold" | "green";
}) {
  return (
    <article className={`summary-card summary-card--${accent}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
