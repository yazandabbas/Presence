# PRES-002: Audit Presence Contract Surface

Status: DONE
Milestone: 01-contract-state-integrity
Owner: unassigned
Size: S
Risk: Low
Parallel-safe: yes
Upstream interference: Medium
Completed audit: `../../audits/PRES-002-presence-contract-surface.md`

## Goal

Create a contract audit for `packages/contracts/src/presence.ts`, grouping schemas into public API, internal compatibility, projection/read model, and future split candidates.

## Why

Presence contracts are broad. We need to know which shapes are stable public contracts before changing backend or UI behavior.

## Layer Boundary

Allowed:
- `.plans/presence/audits/`
- `packages/contracts/src/presence.ts` only if adding comments is explicitly necessary

Not allowed:
- Server implementation changes
- Web implementation changes
- RPC shape changes

## Clean Architecture Rule

Contracts remain schema-only. Do not add runtime logic, helpers, or UI-facing derivation to `packages/contracts`.

## Acceptance Criteria

- Audit lists every major Presence schema family.
- Audit identifies which schemas are safe to keep public.
- Audit identifies read-model split candidates from `BoardSnapshot`.
- Audit names any fields needing decoding defaults or compatibility wrappers.

## Test Plan

No code tests required unless comments or schemas change. If code changes occur, run `bun typecheck`.

## Rollback

Delete the audit or revert comment-only contract changes.
