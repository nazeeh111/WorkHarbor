import assert from "node:assert/strict";
import test from "node:test";
import { checkLifecycleReport } from "./check-workharbor-lifecycle.mjs";

function report() {
  return {
    success: true, numTotalTests: 51, numPassedTests: 51,
    numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
    testResults: [
      ["heartbeat-stale-queue-invalidation.test.ts", 32],
      ["native-session-resumption.test.ts", 13],
      ["heartbeat-workspace-branch-containment.test.ts", 6],
    ].map(([name, count]) => ({
      name: `/checkout/server/src/__tests__/${name}`, status: "passed",
      assertionResults: Array.from({ length: count }, (_, i) => ({ fullName: `case ${i}`, status: "passed" })),
    })),
  };
}

test("accepts the complete passing lane", () => checkLifecycleReport(report()));
test("rejects green Vitest reports with skipped database suites", () => {
  const value = report();
  value.numPassedTests = 13;
  value.numPendingTests = 38;
  for (const index of [0, 2]) {
    value.testResults[index].status = "skipped";
    value.testResults[index].assertionResults.forEach((r) => { r.status = "pending"; });
  }
  assert.throws(() => checkLifecycleReport(value));
});
test("rejects missing, duplicate, failed, and inconsistent file results", () => {
  for (const mutate of [
    (r) => r.testResults.pop(),
    (r) => { r.testResults[2] = r.testResults[0]; },
    (r) => { r.testResults[0].assertionResults[0].status = "pending"; },
    (r) => { r.testResults[0].status = "failed"; },
    (r) => r.testResults[0].assertionResults.pop(),
    (r) => { r.success = false; },
  ]) {
    const value = report();
    mutate(value);
    assert.throws(() => checkLifecycleReport(value));
  }
});
