# PRES-039: Add Presence Observability Surface

Status: DONE
Milestone: 04-runtime-observation
Owner: Codex
Size: L
Risk: Medium
Parallel-safe: no
Upstream interference: Medium
Depends on: PRES-038

## Goal

Expose Presence operation state in the product so a user or agent can see what is happening without spelunking SQLite, logs, or raw thread transcripts.

## Why

When Presence feels stuck, slow, duplicated, or unintelligent, the UI must answer what is currently running, what just happened, what is waiting, and where the failure occurred. Without that, we will debug blind and ship a system that looks mysterious under load.

## Layer Boundary

Allowed:
- `apps/web/src/components/presence/**`
- `apps/web/src/lib/**`
- `apps/server/src/presence/**`
- contract additions needed to expose read-only ledger snapshots
- focused tests

Not allowed:
- New drawer-heavy debugging UI
- Raw SQL display
- Leaking secrets, prompts, tokens, or full command output by default
- Turning the observability surface into a control policy engine

## Clean Architecture Rule

The UI reads summarized ledger state and links to evidence. It should not infer operation truth from raw rows that the server has not normalized.

## Acceptance Criteria

- Presence has a compact live operations view showing active operations, recent completed operations, failed operations, waiting reasons, durations, and affected ticket/attempt/thread links.
- The selected ticket/status panel can show a concise trace of why Presence believes the ticket is in its current state.
- Repo-brain projection activity is visible as one operation type, but the surface covers all Presence operations.
- High-volume details stay tucked behind explicit inspection affordances without recreating the old overwhelming evidence drawer.
- Failed operations have actionable summaries and stable IDs that can be referenced in follow-up tickets.
- Sensitive details are redacted or omitted by default.
- UI tests cover active, failed, skipped, and empty-state operation summaries.

## Test Plan

Run `bun fmt`, `bun lint`, `bun typecheck`, focused web tests, and the targeted server ledger read tests from PRES-038.

## Rollback

Remove the observability read endpoint, view models, UI components, and tests.
