# PRES-040 Observability Smoke Checklist

Use this during a real Presence run after the server and web app start cleanly.

## Board Baseline

- The right-side Live Status panel shows an Operations section before ticket-specific evidence.
- The empty board state says no operations are recorded yet instead of showing stale legacy controls.
- Starting the supervisor or submitting a goal creates fresh operation rows without duplicating older rows.

## Normal Work

- A goal that becomes tickets produces goal-planning or controller operation evidence.
- A worker attempt produces a worker operation tied to the ticket, attempt, and thread when available.
- A review produces a review operation tied to the same ticket and attempt.
- Repo-brain projection appears as its own operation and does not drown out worker or review operations.

## Recovery And Failure

- Provider or auth failures appear as failed runtime operations with an actionable summary.
- Replay or reconnect does not create duplicate operations with the same dedupe key.
- Cleaning up or interrupting an active attempt leaves a terminal cancelled operation instead of a permanently running row.
- Skipped projection work appears as skipped, not failed.

## UI Reading Order

- With no ticket selected, the panel answers what Presence is doing at board scope.
- With a ticket selected, the panel shows a ticket trace first and keeps deep evidence behind explicit expansion.
- Failed operations show stable IDs and summaries that can be referenced in follow-up tickets.
- Sensitive details such as prompts, raw command output, tokens, and secret-like payloads are not visible by default.

## Manual Notes

Record any mismatch as a new Presence ticket with the operation ID, ticket ID, attempt ID, thread ID, and the visible summary.
