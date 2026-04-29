# PRES-035: Add Structured Repo-Brain Retrieval

Status: READY
Milestone: 07-repo-brain
Owner: unassigned
Size: L
Risk: High
Parallel-safe: no
Upstream interference: Medium
Depends on: PRES-033

## Goal

Add structured repo-brain retrieval over compiled memory and timeline evidence using filters and full-text search before any vector search.

## Why

Presence needs memory recall, but retrieval must cite provenance and respect trust, status, scope, and freshness. Weak or stale snippets must not be laundered into supervisor context.

## Layer Boundary

Allowed:
- server repo-brain retrieval service
- API contracts if required
- focused tests

Not allowed:
- Embeddings or vector search
- Silent supervisor prompt injection
- UI changes
- Replacing source event reads

## Clean Architecture Rule

Retrieval returns cited context. It does not decide action, ticket state, review state, merge readiness, or promotion status.

## Acceptance Criteria

- Retrieval supports filters for repository, scope, kind, status, confidence, trust mode, source file, ticket, attempt, and time range.
- Default retrieval excludes candidate, rejected, stale, disputed, and historical records unless explicitly requested.
- Every result includes provenance citations and invalidation status.
- `deny` trust mode returns no prompt-eligible memory.
- `read_only` permits accepted memory reads but no write paths.
- Retrieval uses structured filters and FTS before vector search.

## Test Plan

Run `bun fmt`, `bun lint`, `bun typecheck`, and focused retrieval tests with `bun run --filter t3 test -- <targeted repo-brain retrieval tests>`.

## Rollback

Remove the retrieval service, API additions, and tests.
