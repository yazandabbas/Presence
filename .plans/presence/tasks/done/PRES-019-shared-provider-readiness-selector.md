# PRES-019: Shared Provider Readiness Selector

Status: DONE
Milestone: 06-ui-product-pass
Owner: Codex
Size: S
Risk: Low
Parallel-safe: yes
Upstream interference: Low

## Goal

Move Presence harness provider readiness logic into one shared web selector/helper.

## Why

Dashboard and settings currently duplicate readiness/display rules. Drift here makes Presence appear unavailable or ready inconsistently.

## Layer Boundary

Allowed:
- `apps/web/src/lib/providerReadiness.ts` or similar
- `apps/web/src/components/presence/PresenceDashboard.tsx`
- `apps/web/src/components/settings/SettingsPanels.tsx`
- focused tests if helper behavior is non-trivial

Not allowed:
- Server settings changes
- Provider runtime changes

## Clean Architecture Rule

Provider readiness display belongs in a web selector. Actual provider capability remains server/runtime-owned.

## Acceptance Criteria

- One helper determines whether a provider is ready for Presence harness use.
- Dashboard and settings use the helper.
- No behavior change except removing duplication.
- Warning/unauthenticated providers are handled consistently.

## Test Plan

Run relevant web tests and `bun typecheck`.

## Completion Notes

Added `apps/web/src/lib/providerReadiness.ts` with the shared Presence harness readiness predicate and selected-provider availability resolver. Presence dashboard state now reaches this through `usePresenceBoard`, and Settings uses the same predicate for the Presence harness dropdown.

The readiness rule is unchanged: a Presence harness provider must be enabled, installed, `ready`, not explicitly unauthenticated, and have at least one model.

Validation completed:
- `bun fmt` passed.
- `bun lint` passed with existing warnings and 0 errors.
- `bun typecheck` passed across the monorepo.
- Focused provider readiness and settings tests passed.
- Full `@t3tools/web` tests passed: 90 files, 917 tests.

## Rollback

Revert helper extraction.
