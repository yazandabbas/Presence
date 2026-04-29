# 05: Agentic Loops And Handoffs

## Goal

Make worker, reviewer, and supervisor agent loops bounded, typed, and recoverable.

## Why

The agent sessions can be disposable only if every role writes durable, structured handoff state and never relies on a single long context window.

## Outcomes

- Worker handoffs include objective, changed files, commands, blockers, next step, confidence, and evidence links.
- Reviewer results include decision, checklist, findings, changed files reviewed, and validation evidence.
- Supervisor handoffs include scoped priorities, current run, stage, blocked tickets, recent decisions, and next board actions.
- Malformed or missing reports become explicit blockers, not silent success.

## Backlog

- Define handoff packet invariants.
- Tighten report parsing around tool bridge first.
- Add receiver sanity checks for handoffs.
- Add review-result contradiction tests.
- Add prompt fixtures for worker/reviewer/supervisor roles.

