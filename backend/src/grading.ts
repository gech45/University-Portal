export interface CourseGrade {
  score: number | null;
  creditHours: number;
}

export interface GradedCourse {
  letterGrade: string | null;
  gradePoints: number | null;
  qualityPoints: number | null;
}

const gradeBands = [
  { minimum: 90, maximum: 100, letter: "A+", points: 4 },
  { minimum: 85, maximum: 89, letter: "A", points: 4 },
  { minimum: 80, maximum: 84, letter: "A-", points: 3.75 },
  { minimum: 75, maximum: 79, letter: "B+", points: 3.5 },
  { minimum: 70, maximum: 74, letter: "B", points: 3 },
  { minimum: 65, maximum: 69, letter: "B-", points: 2.75 },
  { minimum: 60, maximum: 64, letter: "C+", points: 2.5 },
  { minimum: 55, maximum: 59, letter: "C", points: 2 },
  { minimum: 50, maximum: 54, letter: "D", points: 1 },
  { minimum: 0, maximum: 49, letter: "F", points: 0 },
] as const;

export function gradeForScore(score: number | null): Omit<GradedCourse, "qualityPoints"> {
  if (score === null) {
    return { letterGrade: null, gradePoints: null };
  }

  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new RangeError("Course scores must be whole numbers from 0 through 100.");
  }

  const band = gradeBands.find(
    (candidate) => score >= candidate.minimum && score <= candidate.maximum,
  );

  if (!band) {
    throw new RangeError(`No grade band is defined for score ${score}.`);
  }

  return { letterGrade: band.letter, gradePoints: band.points };
}

export function calculateWeightedGpa(courses: CourseGrade[]): {
  gpa: number | null;
  gradedCredits: number;
  qualityPoints: number;
} {
  let gradedCredits = 0;
  let qualityPoints = 0;

  for (const course of courses) {
    if (course.score === null) {
      continue;
    }

    if (!Number.isFinite(course.creditHours) || course.creditHours <= 0) {
      throw new RangeError("Course credit hours must be greater than zero.");
    }

    const { gradePoints } = gradeForScore(course.score);
    if (gradePoints === null) {
      continue;
    }

    gradedCredits += course.creditHours;
    qualityPoints += gradePoints * course.creditHours;
  }

  return {
    gpa: gradedCredits === 0 ? null : qualityPoints / gradedCredits,
    gradedCredits,
    qualityPoints,
  };
}
