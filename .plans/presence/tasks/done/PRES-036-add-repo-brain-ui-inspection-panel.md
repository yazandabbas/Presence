# PRES-036: Add Repo-Brain UI Inspection Panel

Status: DONE
Milestone: 07-repo-brain
Owner: unassigned
Size: M
Risk: Medium
Parallel-safe: no
Upstream interference: Medium
Depends on: PRES-033, PRES-035

## Goal

Add a Presence UI surface for inspecting repo-brain compiled truth, timeline evidence, provenance links, status, confidence, trust mode, and invalidation reasons.

## Why

Humans need to see why Presence believes something before trusting it. The UI should make memory inspectable without exposing raw implementation machinery by default.

## Layer Boundary

Allowed:
- `apps/web/src/components/presence/**`
- `apps/web/src/lib/presenceReactQuery.ts`
- focused web tests

Not allowed:
- New promotion/edit actions unless PRES-033 exposes stable APIs
- Server projection changes
- Retrieval ranking changes
- Broad dashboard rewrites

## Clean Architecture Rule

The UI renders server-owned repo-brain state and dispatches explicit commands. It must not infer promotion, invalidation, briefing eligibility, or memory truth locally.

## Acceptance Criteria

- Empty, denied, read-only, stale, disputed, and source-heavy states render clearly.
- Compiled truth and evidence timeline are visually separated.
- Every displayed memory can reveal source ticket, attempt, review artifact, file, command/test, timestamp, confidence, and invalidation rule when available.
- Stale, disputed, rejected, and historical records are labeled so they cannot be mistaken for active truth.
- The default Presence screen remains focused on current work; repo-brain inspection is secondary.

## Test Plan

Run `bun fmt`, `bun lint`, `bun typecheck`, and focused web tests with `bun run --filter @t3tools/web test -- <targeted repo-brain UI tests>`.

## Rollback

Remove the repo-brain inspection UI and tests.

## Completion Notes

Implemented in `Surface repo brain state in Presence`. The board snapshot now exposes repo-brain memory, evidence, candidates, and reviews, and the Presence right rail includes a focused inspection panel backed by a view model with empty, ticket-filtered, and projection-failure coverage.
