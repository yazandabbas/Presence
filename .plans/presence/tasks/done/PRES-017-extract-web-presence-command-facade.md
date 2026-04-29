# PRES-017: Extract Web Presence Command Facade

Status: DONE
Milestone: 06-ui-product-pass
Owner: Codex
Size: M
Risk: Medium
Parallel-safe: no
Upstream interference: Medium

## Goal

Create a web-local Presence command facade used by both the dashboard and command palette.

## Why

The dashboard and palette currently bypass each other and embed command behavior inline. This caused free-form control requests to become literal Presence tickets.

## Layer Boundary

Allowed:
- `apps/web/src/lib/presenceControl.ts`
- `apps/web/src/components/presence/*`
- `apps/web/src/components/PresenceCommandRegistry.tsx`
- `apps/web/src/components/CommandPalette.tsx` only for thin registration

Not allowed:
- Server contract changes
- Backend behavior changes
- Regex hardcoding as the command system

## Clean Architecture Rule

UI commands dispatch typed actions through one facade. Components render and invoke commands; they do not construct domain mutations ad hoc.

## Acceptance Criteria

- Command definitions include id, label, risk, enabled state, reason, and executor.
- Dashboard and palette can consume the same command definitions.
- Goal intake, run supervisor, human direction, and review decision have command entries.
- Risk confirmation is centralized.

## Test Plan

Add unit tests for command facade behavior. Run:
- `bun run --filter @t3tools/web test src/components/PresenceCommandRegistry.test.ts`
- relevant dashboard/command palette tests
- `bun typecheck`

## Completion Notes

Implemented as a web-local command facade, not a server contract change. Presence command definitions now carry risk, enabled state, disabled reason, confirmation text, search terms, and an executor. Command execution is centralized through `executePresenceCommandDefinition`, and command palette items keep the palette open while confirmation is pending or cancelled.

The command palette now builds theme, current-thread stop/archive, and plan-now goal commands from the shared Presence command registry instead of embedding those run bodies inline. The Presence dashboard routes goal submission, supervisor run, human direction, and review decision actions through the same command execution gate while leaving the existing React Query mutations in place.

Validation completed:
- `bun fmt` passed.
- `bun lint` passed with existing warnings and 0 errors.
- `bun typecheck` passed across the monorepo.
- Focused web command/dashboard/settings tests passed.
- Full `@t3tools/web` tests passed: 90 files, 917 tests.

Root `bun run test` was attempted and failed on `@t3tools/scripts` because `update-release-package-versions.test.ts` timed out at 5 seconds during the concurrent monorepo run. The exact file and full `@t3tools/scripts` package passed when rerun independently, matching the documented Windows/Turbo timing sensitivity rather than a Presence command regression.

## Rollback

Revert facade and consumers to previous inline mutations.
