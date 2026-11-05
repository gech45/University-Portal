import { useEffect, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import AdminHome, { SummaryCard } from "./AdminHome";
import {
  ApiRequestError,
  readError,
  requestJson,
  studentRouteFromPath,
  studentRoutes,
  type StudentCourse,
  type StudentDashboard,
  type StudentRoute,
  type User,
} from "./shared";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [apiError, setApiError] = useState("");
  const isAdminLogin = window.location.pathname.startsWith("/admin");

  useEffect(() => {
    const restoreSession = async () => {
      try {
        const result = await requestJson<{ user: User }>("/api/auth/me");
        const studentPath = window.location.pathname;
        const destination = result.user.role === "admin"
          ? "/admin"
          : Object.values(studentRoutes).includes(studentPath)
            ? studentPath
            : "/home";
        if (window.location.pathname !== destination) {
          window.history.replaceState(null, "", destination);
        }
        setUser(result.user);
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) {
          setUser(null);
        } else {
          setApiError("The portal could not connect to its server. Please try again later.");
        }
      } finally {
        setIsCheckingSession(false);
      }
    };

    void restoreSession();
  }, []);

  const signOut = async () => {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        throw new Error(await readError(response));
      }

      window.history.replaceState(null, "", user?.role === "admin" ? "/admin/login" : "/");
      setUser(null);
      setApiError("");
    } catch (error) {
      setApiError(
        error instanceof Error ? error.message : "Unable to sign out. Please try again.",
      );
    }
  };

  if (isCheckingSession) {
    return <PageFrame><p className="loading-message">Loading your portal…</p></PageFrame>;
  }

  if (user?.role === "admin") {
    return (
      <PageFrame user={user} onSignOut={signOut} notice={apiError}>
        <AdminHome />
      </PageFrame>
    );
  }

  if (user) {
    return (
      <PageFrame user={user} onSignOut={signOut} notice={apiError}>
        <StudentHome user={user} />
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <LoginForm
        loginType={isAdminLogin ? "admin" : "student"}
        apiError={apiError}
        onSignedIn={(signedInUser) => {
          window.history.replaceState(
            null,
            "",
            signedInUser.role === "admin" ? "/admin" : studentRoutes.home,
          );
          setApiError("");
          setUser(signedInUser);
        }}
      />
    </PageFrame>
  );
}

function PageFrame({
  children,
  user,
  onSignOut,
  notice,
}: {
  children: ReactNode;
  user?: User;
  onSignOut?: () => void;
  notice?: string;
}) {
  return (
    <main className="page">
      <header className="topbar">
        <a className="brand" href="/" aria-label="AIT Student Portal home">
          <span className="brand-mark">A</span>
          <span>AIT <span className="brand-light">Student Portal</span></span>
        </a>
        {user && onSignOut ? (
          <div className="account-actions">
            <span className="account-name">{user.fullName}</span>
            <button className="sign-out-button" onClick={onSignOut} type="button">
              Sign out
            </button>
          </div>
        ) : (
          <span className="secure-label"><span className="secure-dot" /> SECURE PORTAL</span>
        )}
      </header>
      {notice && <p className="global-error" role="alert">{notice}</p>}
      {children}
      <footer className="footer">
        <span>AIT Student Portal</span>
        <span>Academic services</span>
      </footer>
    </main>
  );
}

function LoginForm({
  loginType,
  apiError,
  onSignedIn,
}: {
  loginType: "student" | "admin";
  apiError: string;
  onSignedIn: (user: User) => void;
}) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const isAdmin = loginType === "admin";
      const result = await requestJson<{ user: User }>(
        isAdmin ? "/api/auth/admin/login" : "/api/auth/student/login",
        {
          method: "POST",
          body: JSON.stringify(isAdmin ? { email, password } : { username, password }),
        },
      );
      onSignedIn(result.user);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to sign in. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="login-layout">
      <div className="login-intro">
        <p className="eyebrow">ACADEMIC SERVICES</p>
        <h1>
          {loginType === "admin"
            ? <>Manage academic records,<br />securely.</>
            : <>Your academic results,<br />in one place.</>}
        </h1>
        <p className="intro">
          {loginType === "admin"
            ? "Authorized staff can manage university academic records."
            : "Sign in to securely view your own grade and academic status."}
        </p>
        <div className="privacy-note">
          <span className="privacy-icon" aria-hidden="true">✓</span>
          <p>
            {loginType === "admin"
              ? "Administrative actions require an authorized staff account."
              : "Students can only access their own academic results."}
          </p>
        </div>
      </div>

      <form className="login-card" onSubmit={submit}>
        <div className="login-card-heading">
          <p className="eyebrow">{loginType === "admin" ? "STAFF ACCESS" : "STUDENT ACCESS"}</p>
          <h2>Welcome back</h2>
          <p>
            {loginType === "admin"
              ? "Sign in with your authorized staff email and password."
              : "Sign in with your student ID and password provided by your administrator."}
          </p>
        </div>
        {loginType === "admin" ? (
          <>
            <label className="field-label" htmlFor="admin-email">Staff email</label>
            <input
              autoComplete="username"
              id="admin-email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Enter your staff email"
              required
              type="email"
              value={email}
            />
          </>
        ) : (
          <>
            <label className="field-label" htmlFor="student-username">Student ID</label>
            <input
              autoComplete="username"
              id="student-username"
              name="username"
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Enter your student ID"
              required
              value={username}
            />
          </>
        )}
        <label className="field-label" htmlFor="password">Password</label>
        <input
          autoComplete="current-password"
          id="password"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Enter your password"
          required
          type="password"
          value={password}
        />
        {(error || apiError) && (
          <p className="form-error" role="alert">{error || apiError}</p>
        )}
        <button className="submit-button" disabled={isSubmitting} type="submit">
          {isSubmitting ? "Signing in…" : "Sign in"}
          {!isSubmitting && <span aria-hidden="true">→</span>}
        </button>
        <p className="login-help">
          {loginType === "admin"
            ? <>Authorized staff only. <a href="/">Student sign in</a></>
            : "Use your unique student ID to sign in. Contact your administrator if you need help."}
        </p>
      </form>
    </section>
  );
}

function StudentHome({ user }: { user: User }) {
  const [dashboard, setDashboard] = useState<StudentDashboard | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [route, setRoute] = useState<StudentRoute>(() =>
    studentRouteFromPath(window.location.pathname),
  );
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  useEffect(() => {
    const handlePopState = () => setRoute(studentRouteFromPath(window.location.pathname));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const result = await requestJson<StudentDashboard>("/api/student/dashboard");
        setDashboard(result);
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load your academic information.",
        );
      } finally {
        setIsLoading(false);
      }
    };

    void loadDashboard();
  }, [user.id]);

  const navigate = (event: MouseEvent<HTMLAnchorElement>, destination: StudentRoute) => {
    event.preventDefault();
    window.history.pushState(null, "", studentRoutes[destination]);
    setRoute(destination);
    setDownloadError("");
  };

  const downloadStatus = async () => {
    setIsDownloading(true);
    setDownloadError("");
    try {
      const response = await fetch("/api/student/status.pdf");
      if (!response.ok) {
        throw new ApiRequestError(await readError(response), response.status);
      }

      const pdf = await response.blob();
      const url = URL.createObjectURL(pdf);
      const link = document.createElement("a");
      link.href = url;
      link.download = "student-status.pdf";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (requestError) {
      setDownloadError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to download your status report.",
      );
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <>
      <nav className="student-nav" aria-label="Student navigation">
        {([
          ["home", "Home"],
          ["academic-status", "Academic status"],
          ["course-lists", "Course lists"],
        ] as const).map(([destination, label]) => (
          <a
            aria-current={route === destination ? "page" : undefined}
            className={route === destination ? "student-nav-link is-active" : "student-nav-link"}
            href={studentRoutes[destination]}
            key={destination}
            onClick={(event) => navigate(event, destination)}
          >
            {label}
          </a>
        ))}
      </nav>
      <section className="dashboard student-dashboard">
        {route === "home" && (
          <div className="dashboard-heading">
            <div>
              <p className="eyebrow">STUDENT HOME</p>
              <h1>Welcome, {user.fullName.split(" ")[0]}.</h1>
              <p className="intro">Your student portal is ready. View your academic status or browse the courses you have taken.</p>
            </div>
          </div>
        )}

        {route === "academic-status" && (
          <>
            <div className="dashboard-heading">
              <div>
                <p className="eyebrow">MY ACADEMIC RESULTS</p>
                <h1>Academic status</h1>
                <p className="intro">Your semester, academic-year, and cumulative grade point averages.</p>
              </div>
              <button
                className="download-button"
                disabled={isDownloading || !dashboard}
                onClick={() => void downloadStatus()}
                type="button"
              >
                {isDownloading ? "Preparing PDF…" : "PDF status"}
              </button>
            </div>
            {downloadError && <p className="form-error" role="alert">{downloadError}</p>}
            {isLoading ? (
              <p className="loading-message">Loading your academic information…</p>
            ) : dashboard ? (
              <>
                <div className="profile-strip student-profile">
                  <div><span>Student ID</span><strong>{dashboard.student.studentNumber}</strong></div>
                  <div><span>Academic year</span><strong>{dashboard.student.academicYear ?? "Not set"}</strong></div>
                  <div><span>Semester</span><strong>{dashboard.student.semester ?? "Not set"}</strong></div>
                  <div><span>Department</span><strong>{dashboard.student.department ?? "Not assigned"}</strong></div>
                  <div><span>Year of study</span><strong>{dashboard.student.studyYear ? `${dashboard.student.studyYear}${dashboard.student.studyYear === 1 ? "st" : dashboard.student.studyYear === 2 ? "nd" : dashboard.student.studyYear === 3 ? "rd" : "th"} year` : "Not assigned"}</strong></div>
                </div>
                <div className="summary-grid student-gpa-grid">
                  <SummaryCard
                    label="Semester GPA"
                    value={dashboard.semesterGpa === null ? "—" : dashboard.semesterGpa.toFixed(2)}
                    detail={`${dashboard.student.semester ?? "Current semester"} grade average`}
                    accent="blue"
                  />
                  <SummaryCard
                    label="Academic year CGPA"
                    value={dashboard.academicYearGpa === null ? "—" : dashboard.academicYearGpa.toFixed(2)}
                    detail={`${dashboard.student.academicYear ?? "Current academic year"} total`}
                    accent="gold"
                  />
                  <SummaryCard
                    label="Cumulative GPA"
                    value={dashboard.gpa === null ? "—" : dashboard.gpa.toFixed(2)}
                    detail="Across all graded courses"
                    accent="green"
                  />
                </div>
                <p className="gpa-note">
                  GPA = total (grade points × course credit hours) ÷ total graded credit hours.
                </p>
              </>
            ) : (
              <p className="empty-state" role="alert">{error || "Unable to load your academic information."}</p>
            )}
          </>
        )}

        {route === "course-lists" && (
          isLoading ? (
            <p className="loading-message">Loading your course list…</p>
          ) : dashboard ? (
            <StudentCourseList courses={dashboard.courses} />
          ) : (
            <p className="empty-state" role="alert">{error || "Unable to load your course list."}</p>
          )
        )}
      </section>
    </>
  );
}

function StudentCourseList({ courses }: { courses: StudentCourse[] }) {
  return (
    <section className="student-course-list">
      <div className="section-heading student-course-heading">
        <div>
          <p className="eyebrow">ACADEMIC RECORDS</p>
          <h2>Courses taken</h2>
        </div>
        <span className="course-count">{courses.length} courses</span>
      </div>
      {courses.length > 0 ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Course</th>
                <th>Credit</th>
                <th>Score</th>
                <th>Letter grade</th>
                <th>Academic year</th>
                <th>Semester</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((course) => (
                <tr key={`${course.courseCode}-${course.academicYear}-${course.semester}`}>
                  <td>
                    <strong>{course.courseCode}</strong>
                    <span className="course-name">{course.courseName}</span>
                  </td>
                  <td>{course.creditHours}</td>
                  <td>{course.score ?? "Pending"}</td>
                  <td>
                    <span className={course.letterGrade ? "grade-badge" : "grade-badge grade-badge--pending"}>
                      {course.letterGrade ?? "In progress"}
                    </span>
                  </td>
                  <td>{course.academicYear}</td>
                  <td>{course.semester}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-state">No courses have been recorded for your account yet.</p>
      )}
    </section>
  );
}
