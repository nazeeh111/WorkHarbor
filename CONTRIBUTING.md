# Contributing to WorkHarbor

Open an issue with a reproducible problem or a concrete proposal before making a large change. For a focused fix, include the input, expected behavior, observed behavior, and the smallest relevant check in the pull request.

Use Node 24.11 or newer and the pinned pnpm version. Follow [local setup](README.md#local-setup). Keep application state and credentials out of commits.

Preserve company isolation, single-assignee task semantics, budget controls, approval requirements, and activity logging. Changes to API or database contracts must update the corresponding shared types, server, and UI. Keep existing license notices.

For WorkHarbor's helpers:

```sh
node --test scripts/workharbor-local.test.mjs scripts/change-packet.test.mjs
```

For board changes, run `pnpm check:token-gates`, the relevant UI tests, `pnpm --filter @paperclipai/ui typecheck`, and `pnpm --filter @paperclipai/ui build`. Broader changes need the applicable package tests and builds. State unavailable checks and known failures explicitly.

The retained engine development documents describe a larger upstream system. This repository does not use its private deployment infrastructure or automated PR-review services. Do not use inherited release scripts to publish packages under upstream names.
