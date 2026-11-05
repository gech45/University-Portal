import assert from "node:assert/strict";
import test from "node:test";
import { calculateWeightedGpa, gradeForScore } from "./grading.js";

const gradeBoundaries: Array<[number, string, number]> = [
  [100, "A+", 4],
  [90, "A+", 4],
  [89, "A", 4],
  [85, "A", 4],
  [84, "A-", 3.75],
  [80, "A-", 3.75],
  [79, "B+", 3.5],
  [75, "B+", 3.5],
  [74, "B", 3],
  [70, "B", 3],
  [69, "B-", 2.75],
  [65, "B-", 2.75],
  [64, "C+", 2.5],
  [60, "C+", 2.5],
  [59, "C", 2],
  [55, "C", 2],
  [54, "D", 1],
  [50, "D", 1],
  [49, "F", 0],
  [0, "F", 0],
];

for (const [score, letterGrade, gradePoints] of gradeBoundaries) {
  test(`maps score ${score} to ${letterGrade} (${gradePoints})`, () => {
    assert.deepEqual(gradeForScore(score), { letterGrade, gradePoints });
  });
}

test("calculates quality points and GPA weighted by course credit hours", () => {
  const result = calculateWeightedGpa([
    { score: 76, creditHours: 4 },
    { score: 90, creditHours: 3 },
  ]);

  assert.equal(result.qualityPoints, 26);
  assert.equal(result.gradedCredits, 7);
  assert.ok(Math.abs((result.gpa ?? 0) - 26 / 7) < 1e-12);
});

test("excludes courses without a posted score from GPA", () => {
  const result = calculateWeightedGpa([
    { score: 76, creditHours: 4 },
    { score: null, creditHours: 3 },
  ]);

  assert.equal(result.gpa, 3.5);
  assert.equal(result.gradedCredits, 4);
  assert.equal(result.qualityPoints, 14);
});

test("returns no GPA when no course has a posted score", () => {
  assert.deepEqual(calculateWeightedGpa([{ score: null, creditHours: 4 }]), {
    gpa: null,
    gradedCredits: 0,
    qualityPoints: 0,
  });
});

test("rejects fractional scores and invalid credit hours", () => {
  assert.throws(() => gradeForScore(76.5), RangeError);
  assert.throws(
    () => calculateWeightedGpa([{ score: 76, creditHours: 0 }]),
    RangeError,
  );
});
