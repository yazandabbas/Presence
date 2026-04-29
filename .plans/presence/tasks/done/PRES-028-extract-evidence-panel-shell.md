# PRES-028: Extract Evidence Panel Shell

Status: DONE
Milestone: 06-ui-product-pass
Owner: Codex
Size: M
Risk: Medium
Parallel-safe: no
Upstream interference: Medium
Depends on: PRES-020

## Goal

Split the selected-ticket right panel into a reusable Evidence Panel shell with live-status and human-direction modes.

## Why

`HumanDirectionPanel` and `PresenceLiveStatusPanel` are two states of the same product surface: explain the selected work and expose the evidence/commands needed to act. Keeping them separate duplicates layout and makes future evidence audit UI harder.

## Layer Boundary

Allowed:
- `apps/web/src/components/presence/PresenceDashboard.tsx`
- `apps/web/src/components/presence/PresenceGuidedViews.tsx`
- new focused Presence panel component files
- focused web tests

Not allowed:
- Server API changes
- Contract changes
- New command types unless exposed through the existing command facade

## Clean Architecture Rule

The shell controls layout and mode. It receives already-derived state and command callbacks; it does not perform domain mutations directly.

## Acceptance Criteria

- Evidence panel shell renders selected ticket title, status line, latest update, and child evidence content.
- Human-direction mode renders the direction actions in the same shell without losing technical details/tools.
- Live-status mode remains visually equivalent for selected and no-selected-ticket states.
- Dashboard right-panel branching is simpler than before.
- Tests cover live mode, direction mode, and no selected ticket.

## Test Plan

Run focused dashboard/guided view tests and `bun typecheck`.

## Completion Notes

Added a shared `EvidencePanelShell` in `apps/web/src/components/presence/PresenceGuidedViews.tsx` and rewired `HumanDirectionPanel` plus `PresenceLiveStatusPanel` through it.

The shell owns the right-panel header, status line, optional activity callout, latest meaningful update card, scroll body, primary mode content, and child evidence content. Direction mode now keeps technical details and tools inside the same evidence shell rather than rendering through a separate layout.

Fixed the right-panel evidence alignment while extracting the shell: when Presence prioritizes a human-needed ticket, the technical details now follow the actual right-panel ticket instead of the previously selected queue row.

Added focused guided view tests for live mode, direction mode, and no selected ticket.

Validation:
- `bun fmt`
- `bun lint`
- `bun typecheck`
- `bun run --filter @t3tools/web test -- PresenceGuidedViews.test.tsx PresenceDashboard.test.tsx`

## Rollback

Restore separate `HumanDirectionPanel` and `PresenceLiveStatusPanel` wiring.
