# 00: Baseline And Scope

## Goal

Freeze the current Presence behavior as a known baseline before more implementation work. The team should be able to describe the happy path, the top failure paths, and the exact seams where Presence touches T3 Code.

## Why

Presence already has a large surface. Without a baseline, future work will keep mixing product fixes, architecture changes, reliability patches, and UI redesigns in one stream.

## Outcomes

- Current happy path is documented from repo import to merge approval.
- Known broken or immature flows are listed without trying to fix them.
- Current upstream interference hotspots are listed.
- A minimal smoke checklist exists for manual app runs.

## Backlog

- Document current Presence happy path.
- Document current stale/stuck board failure modes.
- Record current upstream fork delta and conflict hotspots.
- Record current validation command status.
- Capture a small screenshot-driven manual smoke checklist.

