# PRES-045: Mission Event Retention Policy

Status: Done

## Goal

Keep Presence observability fast and bounded without deleting the durable mission evidence needed for recovery, repo-brain provenance, and later audit.

## Implementation

Recorded the retention decision in `.plans/presence/decisions/2026-04-29-mission-event-retention-policy.md`. The chosen near-term policy is read-time retention: board snapshots stay bounded, while mission events and operation ledger rows remain durable.

Added a clamp to mission-event recent reads so callers cannot accidentally request an unbounded board timeline. This mirrors the existing operation-ledger read clamp and keeps the store boundary predictable.

Added regression coverage proving that board snapshots expose only the recent mission-event and operation-ledger windows while durable backing rows remain present. The test also verifies that ticket mission briefings continue to point at their latest mission state even when that event has fallen outside the board-level recent feed.

## Notes

Physical deletion is intentionally deferred. It needs mission-event dedupe tombstones and a repo-brain provenance strategy first; otherwise reconnect/replay could recreate pruned events and memory evidence could cite deleted source rows.

