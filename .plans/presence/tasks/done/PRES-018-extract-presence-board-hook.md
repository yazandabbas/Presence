# PRES-018: Extract Presence Board Hook

Status: DONE
Milestone: 06-ui-product-pass
Owner: Codex
Size: M
Risk: Medium
Parallel-safe: yes
Upstream interference: Low

## Goal

Extract board/repository query and invalidation behavior from `PresenceDashboard` into a web-local hook.

## Why

The dashboard currently owns data loading, mutation invalidation, provider readiness, navigation, and presentation concerns in one component.

## Layer Boundary

Allowed:
- `apps/web/src/lib/presenceReactQuery.ts`
- `apps/web/src/lib/presenceBoard.ts`
- `apps/web/src/components/presence/PresenceDashboard.tsx`
- focused web tests

Not allowed:
- Server API changes
- UI redesign
- Domain state derivation beyond query/invalidation state

## Clean Architecture Rule

Hooks may orchestrate client data fetching and invalidation. They must not decide ticket lifecycle or supervisor policy.

## Acceptance Criteria

- `usePresenceBoard` wraps repository list, selected repo, board snapshot, capabilities, and invalidation.
- Dashboard mutation handlers no longer duplicate invalidation keys.
- Existing behavior remains unchanged.
- Tests cover hook result shape or dashboard behavior.

## Test Plan

Run focused web tests for Presence dashboard and `bun typecheck`.

## Completion Notes

Extracted `usePresenceBoard` into `apps/web/src/lib/presenceBoard.ts`. The hook now owns Presence repository loading, selected repository state, board snapshot loading, selected ticket state, selected ticket derivations, policy queries, capability scan query, active Presence runtime detection, and shared invalidation.

The dashboard keeps its local drafts, mutation side effects, navigation, toasts, and JSX structure. This keeps the change narrow and avoids server/API churn while removing the largest query/derivation block from the component.

Validation completed:
- `bun fmt` passed.
- `bun lint` passed with existing warnings and 0 errors.
- `bun typecheck` passed across the monorepo.
- Focused dashboard tests passed.
- Full `@t3tools/web` tests passed: 90 files, 917 tests.

## Rollback

Inline the hook behavior back into dashboard and remove new hook file.
