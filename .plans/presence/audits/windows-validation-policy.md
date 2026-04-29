# Windows Validation Policy

Presence is being developed on Windows while upstream T3 Code appears primarily optimized around macOS/Linux development and CI. The root `bun run test` command can become timing-sensitive on Windows because Turbo runs package test suites in parallel, and Bun/Vitest process startup, filesystem I/O, localhost polling, and React import/render tests are more expensive under load.

For Presence work, do not change upstream-owned tests or root scripts just to mask this behavior. Prefer a low-interference validation posture:

- Always run `bun fmt`, `bun lint`, and `bun typecheck`.
- Run changed-area focused tests.
- Run full package tests for touched packages, especially `apps/server`, `apps/web`, and `apps/desktop`.
- Attempt root `bun run test` when reasonable, but if it fails with timeouts, rerun the failing package or test in isolation before treating it as a product regression.
- Record timing-sensitive root failures in the task completion notes with the exact files and rerun results.

Only change shared test configuration if a failure is deterministic, reproducible in isolation, or also affects upstream-supported validation paths. Additive Windows-specific validation helpers are acceptable later, but they should stay optional and should not replace upstream scripts.
