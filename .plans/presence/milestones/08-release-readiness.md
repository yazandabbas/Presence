# 08: Release Readiness And Evaluation

## Goal

Prove Presence is useful and safe before treating it as product-ready.

## Why

Agentic systems fail quietly unless evaluated through trajectories, recovery drills, and human-action gates.

## Outcomes

- Small end-to-end suite covers happy path and top failure paths.
- Manual smoke checklist exists.
- Metrics track stale memory, duplicate work, blocked runs, review failures, and recovery success.
- Feature defaults are conservative.

## Backlog

- Add Presence observability regression suite.
- Add continuity regression harness from `.plans/presence/audits/PRES-023-continuity-regression-scenarios.md`.
- Add failure injection scenarios.
- Add stale-board cleanup tool.
- Document release checklist.
- Add product-risk audit.
