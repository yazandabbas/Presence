# PRES-030: Move Repository Tools To Secondary Panel

Status: DONE
Milestone: 06-ui-product-pass
Owner: unassigned
Size: M
Risk: Medium
Parallel-safe: no
Upstream interference: Medium
Depends on: PRES-028

## Goal

Move repository memory/admin tools out of the default evidence flow into a secondary panel, drawer, or tab inside the Presence evidence area.

## Why

Tools are important for power users, but they currently compete with the selected ticket evidence and make Presence feel like an admin dashboard. The default experience should emphasize attention and evidence first.

## Layer Boundary

Allowed:
- `apps/web/src/components/presence/PresenceDashboard.tsx`
- `apps/web/src/components/presence/PresenceGuidedViews.tsx`
- focused Presence component files
- focused web tests

Not allowed:
- Server API changes
- Contract changes
- Removing existing tools

## Clean Architecture Rule

Repository tools remain command surfaces over existing mutations. Moving them must not change persistence behavior or memory promotion semantics.

## Acceptance Criteria

- Tools remain accessible from the Presence page.
- Tools no longer appear as default content beneath every selected-ticket evidence panel.
- Capability rescan, supervisor handoff, knowledge page, and deterministic job flows keep existing behavior.
- The default selected-ticket evidence panel is simpler and focused on the selected work.
- Tests cover tools access and existing tool callbacks.

## Test Plan

Run focused dashboard/guided view tests and `bun typecheck`.

## Rollback

Restore `ToolsWorkspace` to its previous inline location.
