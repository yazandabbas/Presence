# PRES-020: Design Cockpit Attention Evidence Split

Status: DONE
Milestone: 06-ui-product-pass
Owner: Codex
Size: S
Risk: Low
Parallel-safe: yes
Upstream interference: Low

## Goal

Write a UI decision record for splitting Presence into cockpit, attention queue, and evidence panel.

## Why

Presence should not be a raw dashboard of everything. The default screen should answer what needs human attention and why.

## Layer Boundary

Allowed:
- `.plans/presence/decisions/`

Not allowed:
- UI code changes
- Contract changes

## Clean Architecture Rule

The UI may prioritize attention, but it must show evidence links and must not invent domain truth.

## Acceptance Criteria

- Decision defines responsibilities of cockpit, attention queue, and evidence panel.
- Decision maps current components to target structure.
- Decision lists view-model inputs and command outputs.
- Decision identifies first refactor tasks.

## Test Plan

No code tests required.

## Completion Notes

Accepted the cockpit, attention queue, and evidence panel split in `.plans/presence/decisions/2026-04-29-cockpit-attention-evidence-split.md`.

The decision defines each surface's responsibilities, maps the current components to the target shape, lists the view-model inputs and command outputs, and records compatibility constraints for keeping upstream T3 Code interference low.

Created follow-up implementation tasks:
- `PRES-026`: Extract Presence cockpit view model.
- `PRES-027`: Extract attention queue view model.
- `PRES-028`: Extract evidence panel shell.
- `PRES-029`: Extract ticket evidence sections.
- `PRES-030`: Move repository tools to secondary panel.

## Rollback

Delete decision record.
