# PRES-034: Add Git-Backed Markdown Repo-Brain Projection

Status: READY
Milestone: 07-repo-brain
Owner: unassigned
Size: L
Risk: High
Parallel-safe: no
Upstream interference: Medium
Depends on: PRES-033

## Goal

Emit reviewable repo-brain markdown pages that render compiled truth plus append-only timeline evidence.

## Why

The repo brain should be human-readable, diffable, and editable. Database rows and indexes are retrieval projections; the markdown page is the durable knowledge artifact.

## Layer Boundary

Allowed:
- new focused server module under `apps/server/src/presence/`
- git/path safety helpers if needed
- focused server tests

Not allowed:
- Reading markdown as orchestration truth
- Vector search
- Supervisor prompt injection
- Broad git manager refactors
- UI changes

## Clean Architecture Rule

Markdown is a repo-brain projection and human review surface. It must not become the canonical source for tickets, attempts, reviews, findings, or merge policy.

## Acceptance Criteria

- Markdown output is deterministic for the same compiled memory and evidence timeline.
- Front matter includes id, kind, scope, status, confidence, trust mode, timestamps, and invalidation rules.
- Body separates compiled truth from append-only evidence timeline.
- Contradictory, stale, disputed, and historical evidence can be rendered visibly.
- Writes are path-contained to the configured repo-brain location.
- Writes are atomic or otherwise safe on interruption.
- Dirty-worktree behavior is explicit and tested.

## Test Plan

Run `bun fmt`, `bun lint`, `bun typecheck`, and focused markdown projection tests with `bun run --filter t3 test -- <targeted markdown repo-brain tests>`.

## Rollback

Remove the markdown projection module and tests.
