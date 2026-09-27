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

## Broad-suite attempt

`pnpm test:run` was attempted with isolated test state and no provider credentials. Its initial general-server lane did not finish within the bounded local run; the full inherited suite is **incomplete**, not reported as passing. The root command also schedules workspace groups and 147 serial server suites. GitHub CI covers the WorkHarbor helpers and five relevant UI test files, token rules, UI typechecking, and a UI build; it is not the full engine suite.

## Limits

This verifies local board and file-review workflows. Provider authentication, actual agent execution, hosted deployment, cross-company adversarial access, Windows operation, and production load were not tested. No claims of provider compatibility or security certification follow from the checks above. The launcher is for a regular clone or source archive on macOS/Linux; Linux runtime startup has not yet been exercised locally.

Change packets are a manual review aid. They cover only explicitly selected file bytes and do not automatically bind native approval decisions. No live credentials, paid APIs, external integrations, or sensors were used for verification.
