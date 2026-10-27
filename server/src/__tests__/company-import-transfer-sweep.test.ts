import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

// Run the production sweep body with mocked filesystem and ledger calls.
// No application import, DB, real spool or actual deletion occurs.
const source = readFileSync(new URL("../services/company-import-transfers.ts", import.meta.url), "utf8");
const boundary = source.indexOf("export async function sweepAbandonedImportTransferSpools(");
if (boundary < 0) throw new Error("Missing import spool sweep source boundary");
const executable = stripTypeScriptTypes(source.slice(boundary).replace(/^export\s+/, "") +
  "\nthis.sweep = sweepAbandonedImportTransferSpools;", { mode: "strip" });
const RUN = "11111111-1111-4111-8111-111111111111";
const ROOT = "/synthetic/import-spool";
const NOW = new Date("2026-01-01T00:00:00Z");
const databaseError = new Error("synthetic-ledger-read-failure");
const claimError = new Error("synthetic-claim-failure");
const removalError = new Error("synthetic-removal-failure");

type Scenario = {
  name: string; status?: string; old?: boolean; lookupError?: boolean;
  statError?: boolean; directoryError?: boolean; invalidId?: boolean;
  notDirectory?: boolean; claim?: boolean; claimError?: boolean;
  removalError?: boolean; removed: number; expectedError?: Error;
};
const scenarios: Scenario[] = [
  { name: "failed ledger read, old directory: preserve and report", old: true, lookupError: true, removed: 0, expectedError: databaseError },
  { name: "failed ledger read, fresh directory: preserve and report", lookupError: true, removed: 0, expectedError: databaseError },
  { name: "confirmed old orphan: remove", old: true, removed: 1 },
  { name: "confirmed fresh orphan: keep", removed: 0 },
  { name: "orphan stat failure: keep", old: true, statError: true, removed: 0 },
  { name: "idle open run claimed for cancellation: remove", status: "running", claim: true, removed: 1 },
  { name: "recently resumed open run, old directory: keep", status: "running", old: true, removed: 0 },
  { name: "applying run, old directory: keep", status: "applying", old: true, removed: 0 },
  { name: "failed retryable run, old directory: keep", status: "failed", old: true, removed: 0 },
  { name: "completed run: collect leftover immediately", status: "completed", removed: 1 },
  { name: "cancelled run: collect leftover immediately", status: "cancelled", removed: 1 },
  { name: "malformed run id: skip", invalidId: true, removed: 0 },
  { name: "non-directory: skip", notDirectory: true, removed: 0 },
  { name: "directory read failure: preserve", directoryError: true, removed: 0 },
  { name: "cancellation claim failure: preserve and report", status: "running", old: true, claimError: true, removed: 0, expectedError: claimError },
  { name: "orphan removal failure: report", old: true, removalError: true, removed: 1, expectedError: removalError },
];

describe("import spool sweep preserves data when ledger state is uncertain", () => {
  for (const scenario of scenarios) {
    it(scenario.name, async () => {
      const fs = {
        readdir: vi.fn(async () => {
          if (scenario.directoryError) throw new Error("synthetic-readdir-failure");
          return [{ name: scenario.invalidId ? "../escape" : RUN, isDirectory: () => !scenario.notDirectory }];
        }),
        stat: vi.fn(async () => {
          if (scenario.statError) throw new Error("synthetic-stat-failure");
          return { mtimeMs: NOW.getTime() - (scenario.old ? 2000 : 100) };
        }),
        rm: vi.fn(async () => { if (scenario.removalError) throw removalError; }),
      };
      const ledger = {
        getRun: vi.fn(async () => {
          if (scenario.lookupError) throw databaseError;
          return scenario.status ? { id: RUN, status: scenario.status } : null;
        }),
        cancelIfIdle: vi.fn(async () => {
          if (scenario.claimError) throw claimError;
          return scenario.claim === true;
        }),
      };
      const db = { synthetic: true };
      const context = vm.createContext({
        fs, path, companyTransferRunService: ledger, IMPORT_TRANSFER_SPOOL_MAX_AGE_MS: 1000,
        isImportTransferRunId: (value: string) => value === RUN,
      });
      vm.runInContext(executable, context, { timeout: 1000 });
      let result: { swept: number } | undefined;
      let error: unknown;
      try { result = await context.sweep(db, ROOT, { now: NOW, maxAgeMs: 1000 }); }
      catch (caught) { error = caught; }
      expect(fs.rm).toHaveBeenCalledTimes(scenario.removed);
      if (scenario.removed) expect(fs.rm).toHaveBeenCalledWith(path.join(ROOT, RUN), { recursive: true, force: true });
      if (scenario.expectedError) {
        expect(error).toBe(scenario.expectedError);
        expect(result).toBeUndefined();
      } else {
        expect(error).toBeUndefined();
        expect(result).toEqual({ swept: scenario.removed });
      }
      const skipped = scenario.invalidId || scenario.notDirectory || scenario.directoryError;
      expect(ledger.getRun).toHaveBeenCalledTimes(skipped ? 0 : 1);
      if (!skipped) expect(ledger.getRun).toHaveBeenCalledWith(db, RUN);
      if (scenario.lookupError || skipped) {
        expect(fs.stat).not.toHaveBeenCalled();
        expect(ledger.cancelIfIdle).not.toHaveBeenCalled();
      } else if (scenario.status && !["completed", "cancelled"].includes(scenario.status)) {
        expect(fs.stat).not.toHaveBeenCalled();
        expect(ledger.cancelIfIdle).toHaveBeenCalledWith(db, RUN, new Date(NOW.getTime() - 1000), expect.any(String));
      } else {
        expect(ledger.cancelIfIdle).not.toHaveBeenCalled();
        expect(fs.stat).toHaveBeenCalledTimes(scenario.status ? 0 : 1);
      }
    });
  }
});
