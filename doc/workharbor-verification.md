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

## 2026-09-30 dependency maintenance

Compatible dependency updates were checked in an isolated regular clone with Node 24.14.0, pnpm 9.15.4, a checksum-verified task-local Rust 1.97.1 toolchain, and disposable PostgreSQL state. They include Multer 2.4.0, gRPC JS 1.14.5, Cursor SDK 1.0.34, MDXEditor 4.2.5 and Svix 1.92.2, plus narrowly scoped compatible transitive fixes. Dependency installation kept scripts disabled. The bundled PostgreSQL library aliases were prepared locally without running its install hook. Existing user state and provider credentials were excluded.

Recursive typechecking and build passed (37.24 and 35.50 seconds), including the native runner, UI and CLI. Later changes were confined to excluded server test fixtures and this documentation; compiler/build inputs were compared explicitly before reusing those results. The UI token gates passed. Inherited Rust dead-code and UI bundle-size warnings remain.

The stable runner's **default selection is fully accounted for through supported partitions**. Its 15 projects select 1,721 source files: 1,716 passed and five were entirely skipped. The completed union reports **25,026 assertions passed, 117 skipped and no final assertion failures**. Discovery counts were compared with actual completed file rows, rather than treated as execution evidence.

| Selection | Selected files | Assertions passed | Assertions skipped |
| --- | ---: | ---: | ---: |
| General server, four shards and three discovery-supplement files | 652 | 12,365 | 89 |
| UI and CLI | 660 | 6,784 | 0 |
| Other workspace projects | 262 | 3,312 | 28 |
| Serialized server selection | 147 | 2,565 | 0 |

The existing `--mode`, `--group`, `--shard-index` and `--shard-count` options selected the partitions. The three source files omitted by sharded general discovery were run explicitly: `server/src/routes/setup-token-route.test.ts`, `server/src/services/openrouter-models.test.ts` and `server/scripts/verify-runner-vendor-dependencies.test.mjs`. Failed groups were completed through their project invocations and authoritative single-file serialized shards; every file left unreached by fail-fast behavior was subsequently executed. Completed results were reused only after comparing their source and configuration inputs. The corrected recovery file executed all 294 cases, with none skipped.

This does **not** turn earlier commands into passes. The initial broad attempt timed out after 1,800 seconds; a later flat `pnpm test:run` failed after its general lane. Another serialized attempt was interrupted after a held test transaction blocked cleanup. Its precise cause was not reproduced in standalone probes. The manual-lock fixture now fails on a five-second drain deadline and releases its lock unconditionally, without relaxing its held-lock assertions. This contains a possible fixture stall; it is not a proven production lifecycle fix. Two later unchanged route/CLI cases timed out while queues overlapped, then passed sequentially without edits or timeout increases. Concurrency or cold transformation is a possible explanation, not an established cause. A complete recovery run first reported 292 passed and two failed; narrowly corrected fixtures then passed all 294. No final flat-command exit-zero claim is made.

Other fixture corrections give mocked positive Codex agents explicitly synthetic per-agent readiness values, retain intentional missing-binding/native authority/sensitive-env refusals, use the actual Node interpreter for fake CLI programs, and test dynamically allocated ports. The test for unavailable workspace isolation uses a credential-free process adapter to reach the real workspace-isolation refusal; all trust-policy and no-dispatch assertions remain. Two dependency-free plugin fixtures temporarily permit their inspected local SDK-link helper and restore both script-policy environment settings. That helper can inspect excluded local plugins in the isolated checkout; it skips symlinked discovery directories and does not install dependencies or access the network. Dependency installs remain script-disabled.

The 89 general-server skips include existing platform, optional-fixture, SDK/tool and explicit live-provider exclusions, plus seven assertions for upstream deployment workflows absent from this local fork. The 28 workspace skips are Linux-only sandbox/inactivity cases, an opt-in Claude characterization, six remote Daytona cases, and local zstd/GNU-tar cases unavailable in the controlled test environment. Skips are not passing runtime proofs. Five configured adapter projects are absent from the stable default: Cursor Cloud, Cursor Local, Gemini Local, Kimi Local and Pi Local. Their complete project suites were not executed by this selection.

Separate bounded dependency evidence includes actual installed Cursor SDK constructor/request/response and an empty server-sent event stream through a controlled synthetic fetch transport, independent Svix cryptographic signature verification against an expected wire shape, and a real MDXEditor component harness. The editor rendered rich headings/lists and passed four checks: rich rendering, keyboard typing with parent Markdown updates, reference insertion preserving headings/bold, and refusal of keyboard/reference edits while read-only. That harness used the actual component/dependencies and MDX stylesheet, with an empty autocomplete context. It did not establish full-app global styling, API, images, mentions or every editor feature. No live Cursor/Svix/provider authentication is implied.

The recorded production-dependency audit retains one moderate entry: [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99), for esbuild 0.18.20 under `drizzle-kit -> @esbuild-kit/esm-loader -> @esbuild-kit/core-utils`. The advisory concerns esbuild's development-server `serve` feature. The inspected installed consumer uses transformation/loading and version checks; no `serve` call was observed there. This is a bounded source observation, not a universal non-exploitability claim. The entry remains documented pending a compatible parent route, rather than forcing a major child override. No security certification, remote-provider compatibility, Windows runtime or Linux/Docker sandbox proof follows from these checks.
