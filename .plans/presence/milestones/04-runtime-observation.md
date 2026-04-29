# 04: Runtime Observation And Mission Events

## Goal

Make mission events the product-visible truth for runtime activity.

## Why

Presence should not infer operational state from raw provider logs or UI-only projection guesses. Runtime observation must produce compact, deduped, correlated evidence.

## Outcomes

- Provider/runtime activity is correlated to board, ticket, attempt, supervisor run, and thread.
- Reconnect/replay does not duplicate mission events.
- Provider account/auth failures become human-actionable blockers.
- Tool bridge reports are preferred over assistant text blocks where available.

## Backlog

- Done: add Presence operation ledger.
- Done: add Presence observability surface.
- Done: add Presence observability regression suite.
- Done: canonicalize runtime correlation keys.
- Done: add replay/dedupe tests for observation.
- Done: harden provider runtime ingestion idempotence.
- Done: promote provider-unavailable events into mission state.
- Done: add mission-event retention and pruning decision record.
- Next: keep assistant block parsing as fallback only.
