# WorkHarbor adaptation

## Outcome

A locally hosted workspace for assigning agent tasks, inspecting their runs and outputs, and making review decisions. Retain the existing engine's task, company, approval, budget, and execution contracts while replacing the product's presentation. Base source: Paperclip tag v2026.916.1, commit d554c4789ed3930f8a53ac9fdf6503b3187097da. License and separately owned asset notices remain intact.

## Delivery slices

1. Establish a reproducible local baseline with pinned dependencies. Keep fresh state separate from existing installations. Disable first-party telemetry and announcements for local verification; do not run model providers or discover credentials.
2. Apply the WorkHarbor identity to the shell, first-party icons, metadata, onboarding, and visible product wording. Use neutral surfaces and teal accents through existing design tokens. Preserve external product names, protocol identifiers, packages, and persisted fields.
3. Provide a simple local launcher with explicit loopback binding and isolated state, with clear controls for scheduled work. Verify actual API and UI behavior against an empty local database before using any agent.
4. Assess revision-bound review as the first functional extension: a verdict must identify the exact content reviewed and become stale when that content changes. Integrate only after tracing the actual review/approval path; never imply that a human approval covers later changes. No automatic push, release, or deployment.
5. Document exact setup commands, verified behavior, licensing scope, and remaining checks. Replace inherited workflows that depend on upstream private infrastructure before any publication. Publish only after the relevant builds, functional checks, and a fresh review pass.

## Acceptance

The app starts with isolated local state and no default analytics traffic; core task/approval routes remain usable; the name, mark, colors, and entrypoint text agree; errors remain visible; built assets render on desktop and narrow screens. Existing safety and data-isolation checks relevant to touched code pass. Runtime provider authentication is never claimed verified without an actual permitted run. No fabricated agents, dates, productivity claims, or screenshots of untouched source presented as new work.

## Implemented review scope

The extension is a selected-file change packet with a separately recorded digest. It does not replace the native review engine or automatically invalidate UI decisions. A reviewer explicitly checks the packet and records the digest with their verdict. See `doc/workharbor-change-packets.md`.
