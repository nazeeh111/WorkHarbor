import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Deliberately explicit: changing this lane's scope requires updating its gate.
const expected = new Map([
  ["heartbeat-stale-queue-invalidation.test.ts", 32],
  ["native-session-resumption.test.ts", 13],
  ["heartbeat-workspace-branch-containment.test.ts", 6],
]);

export function checkLifecycleReport(report) {
  assert.equal(report.success, true, "Vitest did not report success");
  assert.equal(report.numTotalTests, 51, "Expected 51 lifecycle tests");
  assert.equal(report.numPassedTests, 51, "All 51 lifecycle tests must pass");
  assert.equal(report.numFailedTests, 0, "Failed lifecycle tests");
  assert.equal(report.numPendingTests, 0, "Skipped lifecycle tests");
  assert.equal(report.numTodoTests, 0, "Unimplemented lifecycle tests");
  assert.equal(report.testResults?.length, expected.size, "Expected exactly three test files");
  const seen = new Set();
  for (const suite of report.testResults) {
    const name = suite.name.replaceAll("\\", "/").split("/").at(-1);
    assert(expected.has(name) && !seen.has(name), `Unexpected or duplicate file: ${name}`);
    seen.add(name);
    assert.equal(suite.status, "passed", `${name} did not pass`);
    assert.equal(suite.assertionResults?.length, expected.get(name), `${name}: wrong test count`);
    for (const result of suite.assertionResults) {
      assert.equal(result.status, "passed", `${name}: ${result.fullName} did not pass`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 3, "Usage: node scripts/check-workharbor-lifecycle.mjs report.json");
  checkLifecycleReport(JSON.parse(readFileSync(process.argv[2], "utf8")));
  console.log("Verified all 51 lifecycle tests passed across three files; none skipped.");
}
