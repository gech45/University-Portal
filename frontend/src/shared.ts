export type User = {
  id: number;
  username: string | null;
  email: string | null;
  fullName: string;
  role: "student" | "admin";
};

export type StudentCourse = {
  courseCode: string;
  courseName: string;
  creditHours: number;
  academicYear: string;
  semester: string;
  score: number | null;
  letterGrade: string | null;
};

export type StudentDashboard = {
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
};

export type StudentRoute = "home" | "academic-status" | "course-lists";

export const studentRoutes: Record<StudentRoute, string> = {
  home: "/home",
  "academic-status": "/academic-status",
  "course-lists": "/course-lists",
};

export function studentRouteFromPath(pathname: string): StudentRoute {
  if (pathname === studentRoutes["academic-status"]) {
    return "academic-status";
  }
  if (pathname === studentRoutes["course-lists"]) {
    return "course-lists";
  }
  return "home";
}

export type Department = {
  id: number;
  name: string;
  code: string;
  programYears: number | null;
};

export type AdminCourse = {
  id: number;
  code: string;
  name: string;
  creditHours: number;
  departmentId: number;
  departmentName: string;
  curriculum: Array<{
    studyYear: number;
    semester: string;
  }>;
};

export type AdminStudent = {
  id: number;
  fullName: string;
  studentNumber: string;
  departmentId: number | null;
  departmentName: string | null;
  studyYear: number | null;
  academicYear: string | null;
  semester: string | null;
  section: string | null;
};

export type AdminStudentRecord = AdminStudent & {
  enrollments: AdminEnrollment[];
};

export type AdminEnrollment = {
  id: number;
  studentUserId: number;
  studentName: string;
  studentNumber: string;
  courseCode: string;
  courseName: string;
  creditHours: number;
  academicYear: string;
  semester: string;
  status: "enrolled" | "dropped";
  score: number | null;
};

export type GradeReportCourse = {
  id: number;
  code: string;
  name: string;
  creditHours: number;
};

export type GradeReportCell = {
  courseId: number;
  enrollmentId: number | null;
  score: number | null;
  letterGrade: string | null;
};

export type GradeReportStudent = {
  studentUserId: number;
  fullName: string;
  studentNumber: string;
  grades: GradeReportCell[];
};

export type GradeReport = {
  courses: GradeReportCourse[];
  students: GradeReportStudent[];
};

export const semesters = ["Semester 1", "Semester 2"] as const;
export const studyYears = [
  "1st year",
  "2nd year",
  "3rd year",
  "4th year",
  "5th year",
  "6th year",
  "7th year",
] as const;

export type AdminOverview = {
  departments: Department[];
  courses: AdminCourse[];
  studentCount: number;
};

type ApiErrorBody = {
  error?: string;
};

export class ApiRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (typeof body.error === "string") {
      return body.error;
    }
  } catch {
    return `Request failed with status ${response.status}.`;
  }

  return `Request failed with status ${response.status}.`;
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new ApiRequestError(await readError(response), response.status);
  }

  return (await response.json()) as T;
}
