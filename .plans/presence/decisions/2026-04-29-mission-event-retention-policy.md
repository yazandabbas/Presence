# Mission Event Retention Policy

Presence mission events are durable operational evidence, not only UI timeline rows. The board snapshot may expose a bounded recent feed, but the backing table must stay append-only until physical pruning has a tombstone and provenance strategy.

The current safe policy is read-time retention. Board snapshots show the recent mission-event window and recent operation-ledger window so the UI stays fast and readable. Ticket mission briefings, board mission briefings, operation ledger rows, thread correlation, and repo-brain evidence remain durable and are not physically pruned by the snapshot window.

Automatic deletion is intentionally out of scope for this slice. Deleting mission events would free `(board_id, dedupe_key)` and allow replayed provider/runtime observations to recreate stale events unless a tombstone table preserves dedupe history. Repo-brain also records `source.missionEventId` in evidence provenance, so deleting cited events would make the memory layer harder to audit. Thread correlation can fall back to latest mission events by thread, which makes aggressive deletion risky for recovery.

Physical pruning can be added later only with an explicit migration and policy. That later policy should add mission-event tombstones, stop projecting low-value telemetry into repo-brain evidence or preserve provenance with stable archived summaries, protect current ticket and board mission state, protect active thread latest events, and prune only low-risk telemetry after both age and per-board count thresholds.

