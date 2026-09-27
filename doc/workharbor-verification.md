# WorkHarbor verification

Verified locally on 2026-09-27 with Node 24.14.0, pnpm 9.15.4, pinned Rust 1.97.1, and the bundled PostgreSQL 18.1 on macOS arm64.

## Completed checks

- The isolated launcher started an empty instance on loopback with scheduling disabled. The health endpoint became ready after database migrations.
- A disposable company and unassigned task were created through the API. Editing and reading back the task succeeded. The task persisted after a clean stop and restart. No agents or providers were configured or invoked.
- Chrome rendered the dashboard and task detail. The onboarding wizard's **Explore workspace first** action opened the workspace without creating an agent. At 390 × 844, the task title, description, composer, and mobile navigation fit the visible page.
- Four launcher tests passed, covering isolated environment construction, matching start/stop state, malformed options, and rejection of unsupported Windows and linked-worktree startup.
- Seven change-packet tests passed. Independent review reproduced and closed a credential-path filter gap for `.npmrc`, `.pypirc`, and `.docker/config.json` using disposable Git fixtures.
- Relevant onboarding and account-menu tests passed (21 tests after the final interaction/link changes). UI typechecking passed.
- Full `pnpm -r typecheck` and `pnpm build` passed, including the server, native runner, UI, and CLI. The sandbox initially blocked a temporary IPC socket used by `tsx`; typechecking passed when run with the required local process access. Build warnings included inherited Rust dead-code and UI bundle-size warnings.

## Broad-suite attempt and focused diagnosis

`pnpm test:run` was attempted with isolated test state and no provider credentials. Its initial general-server lane was stopped after about 12 minutes; the full inherited suite is **incomplete**, not reported as passing. The root command also schedules workspace groups and 147 serial server suites.

Before interruption, the run reported 17 failures across five server files. Focused diagnosis produced these results:

| File | Focused result | Finding |
| --- | --- | --- |
| `execution-workspaces-service` | 66/66 passed | Passed alone with no source edit. The original run overlapped a build; the cause was not established. |
| `claude-local-execute` | 28/28 passed | The isolated test environment's `CLAUDE_CONFIG_DIR` overrode the fixture's temporary HOME. Removing that extra override fixed the test, with no source edit. |
| `heartbeat-stale-queue-invalidation` | 32/32 passed | Added an explicitly fake per-agent key to the mocked Codex fixture. |
| `native-session-resumption` | 13/13 passed | Added an explicitly fake per-agent key to the mocked Codex fixture. |
| `heartbeat-workspace-branch-containment` | 6/6 passed | Added an explicitly fake per-agent key to the mocked Codex fixture. |

The three Codex fixtures previously reached credential preflight before their mocked adapters. The fake per-agent key satisfies that preflight before it inspects credential files; adapter execution and native backends remain mocked. Local checks use disposable HOME, PAPERCLIP_HOME, and CODEX_HOME paths, a controlled environment, and PAPERCLIP_DISABLE_CWD_ENV_FILE=true because imported configuration can otherwise load local settings. Production authentication and all original behavior assertions remain unchanged. A host-level dummy key did not satisfy this per-agent requirement and was not retained as the solution.

GitHub [CI run 36335183112](https://github.com/nazeeh111/WorkHarbor/actions/runs/36335183112) passed on `716391fe3fb4ccccc7fe7153b2a446ba039e5e00`: 53 UI tests, 14 helper tests, token rules, UI typechecking/build, and all 51 lifecycle tests (32 + 13 + 6) on Linux. The lifecycle job prepared embedded PostgreSQL and checked the JSON report for exactly those tests, all passed with none skipped. The same 51 tests and 14 helpers also passed locally during the final review. Independent review found the earlier standalone database probe could allow later probes to skip suites; the report gate now rejects that result. This targeted workflow is not full engine verification.

The earlier full build and recursive typecheck evidence is reused: application/runtime source and dependencies have not changed since that check. Subsequent changes are test fixtures, the CI/report gate, and documentation. The source release includes those changes; no old source archive is reused.

## Limits

This verifies local board and file-review workflows. Provider authentication, actual agent execution, hosted deployment, cross-company adversarial access, Windows operation, and production load were not tested. No claims of provider compatibility or security certification follow from the checks above. The launcher is for a regular clone or source archive on macOS/Linux; Linux runtime startup has not yet been exercised locally.

Change packets are a manual review aid. They cover only explicitly selected file bytes and do not automatically bind native approval decisions. No live credentials, paid APIs, external integrations, or sensors were used for verification.
