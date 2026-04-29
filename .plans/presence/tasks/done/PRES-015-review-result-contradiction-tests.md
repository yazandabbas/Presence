# PRES-015: Review Result Contradiction Tests

Status: DONE
Milestone: 05-agentic-loops
Owner: Codex
Size: M
Risk: Medium
Parallel-safe: yes
Upstream interference: Low

## Goal

Add tests proving contradictory review results are blocked instead of accepted.

## Why

Reviewer agents must not be allowed to mark work accepted while reporting blocking findings, missing evidence, or unchecked acceptance criteria.

## Layer Boundary

Allowed:
- `apps/server/src/presence/Layers/internal/PresenceSupervisorRuntime.test.ts`
- `apps/server/src/presence/Layers/internal/PresenceReviewMergeService.test.ts`
- implementation only if tests reveal a bug

Not allowed:
- UI changes
- Prompt-only fixes
- New review decision enum values

## Clean Architecture Rule

Review validity is a server-side gate. It cannot depend on the reviewer following prompt instructions perfectly.

## Acceptance Criteria

- Accept plus blocking finding is refused by the supervisor review gate.
- Accept without relevant validation evidence is refused by the supervisor review gate.
- Accept with unchecked review checklist assessment is refused before the decision can be applied.
- Refusal is routed through the existing review-failure blocker path with clear human-readable summary and rationale.

## Test Plan

Validated:
- `Push-Location apps\server; bun run test src/presence/Layers/internal/PresenceSupervisorRuntime.test.ts --testNamePattern "refuses accept review results"; Pop-Location`
- `Push-Location apps\server; bun run test src/presence/Layers/internal/PresenceSupervisorRuntime.test.ts; Pop-Location`
- `Push-Location apps\server; bun run typecheck; Pop-Location`
- `bun fmt`
- `bun lint`

## Rollback

Revert test and implementation changes.
