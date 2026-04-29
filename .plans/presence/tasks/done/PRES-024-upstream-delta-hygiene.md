# PRES-024: Upstream Delta Hygiene

Status: DONE
Milestone: 08-release-readiness
Owner: unassigned
Size: S
Risk: Low
Parallel-safe: yes
Upstream interference: High
Completed audit: `../../audits/PRES-024-upstream-delta-hygiene.md`

## Goal

Document and reduce current fork-interference hotspots before more Presence implementation work lands.

## Why

Presence should remain easy to keep in sync with `pingdotgg/t3code`. Broad changes to RPC, settings, websocket lifecycle, and command palette increase merge cost.

## Layer Boundary

Allowed:
- `.plans/presence/audits/`
- git metadata inspection

Not allowed:
- Merge/cherry-pick
- Code edits
- Reverts

## Clean Architecture Rule

Shared upstream files should contain thin registration hooks only. Presence-specific behavior should live behind Presence modules/adapters.

## Acceptance Criteria

- Audit lists current upstream commits ahead of local base.
- Audit lists dirty files outside Presence-owned directories.
- Audit classifies hotspots: websocket/RPC, provider contracts, settings, command palette, scripts/tests.
- Audit recommends split commits or isolation tasks.

## Test Plan

No code tests required. Run `git status --short` and include summary in the audit.

## Rollback

Delete audit file.
