# WorkHarbor

A local workspace for agent tasks, runs, costs, and approvals. Assign work, inspect the output, and keep decisions attached to the task that produced them.

WorkHarbor retains the existing orchestration engine and adds a distinct visual identity, an isolated local launcher, and a selected-file review packet workflow. Provider adapters are configured separately; opening the app does not require a paid API key.

## Local setup

Local startup, task editing, save-failure recovery, persistence after reload, and desktop/mobile resize checks have passed. The current UI build passes 6,318 assertions. All configured test projects are accounted for through recorded partitions and project runs, with 117 explicit applicability skips. See [verification](doc/workharbor-verification.md) for source identities, hosted checks and remaining limits.

The local launcher supports macOS and Linux from a regular clone or source archive. It rejects linked Git worktrees to avoid loading their separate instance configuration. Windows launcher support is not yet available. The source requires Node.js 24.11 or later, pnpm 9.15.4, and Rust for its native runner. Dependencies are pinned in `pnpm-lock.yaml` and `Cargo.lock`.

```sh
corepack pnpm install --frozen-lockfile
node scripts/workharbor-local.mjs start
```

The launcher uses loopback on port 3180 and keeps application data in `.workharbor/` beside the source. It disables first-party telemetry and announcements, ignores the working-directory `.env`, and does not inherit provider credentials or a database URL from the shell. Configure providers explicitly within this instance.

Scheduled agent runs are off by default. Manual task actions can still invoke configured agents. Use `--schedule` when deliberately enabling scheduled work; internal housekeeping still runs regardless of that flag.

```sh
node scripts/workharbor-local.mjs start --state-dir ./my-workspace --port 3188
node scripts/workharbor-local.mjs stop --state-dir ./my-workspace
```

The stop command targets development services for this checkout in the selected state directory. Application data remain on disk. Do not point this launcher at an existing Paperclip installation's state.

## Review selected files

The change-packet helper records the exact contents of explicitly selected files for review and can check whether those files have changed since capture. See [change packets](doc/workharbor-change-packets.md) for commands and limits. A packet does not automatically approve, publish, or deploy anything.

## Development and scope

The core supports company-scoped tasks, agent sessions, budgets, approvals, and persistent run history. Internal package names and API identifiers remain compatible with the base engine. Provider-specific features still require their own configuration and access.

[The adaptation plan](doc/plans/2026-09-27-workharbor-adaptation.md) records the implementation scope. Technical architecture and development references remain under `doc/`; descriptions of upstream hosted services are not WorkHarbor hosting offers.

## Source and maintenance

Based on Paperclip v2026.916.1 at `d554c4789ed3930f8a53ac9fdf6503b3187097da`. WorkHarbor changes the local launch defaults, presentation, onboarding exit path, and file-review tooling. The inherited engine and technical reference material remain available; upstream package publishing and hosted-deployment scripts are not WorkHarbor release instructions. This repository is distributed as source, not as an upstream npm package. WorkHarbor changes were developed and checked locally before publication; the initial repository snapshot is not a record of the engine’s development timeline.

## License

MIT licensed. [LICENSE](LICENSE) retains the engine copyright; WorkHarbor additions are copyright 2026 nazeeh111. Font and adapter notices remain with their assets.
