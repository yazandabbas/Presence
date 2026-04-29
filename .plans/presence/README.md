# Presence Implementation Program

This folder tracks the Presence rebuild and hardening work as a living implementation program. Presence should become a continuity kernel and mission-control layer for coding agents, not another opaque agent harness.

The plan is intentionally staged. Keep only the next dependency-ready work in `tasks/ready/`; move stale work back into milestone notes instead of letting a giant task pile rot.

## Product Thesis

Presence keeps agent work organized, continuous, inspectable, recoverable, and moving.

It should make the user feel like an administrator or governor of repository-level agent work. The system may plan, coordinate, execute, review, recover, and remember, but every meaningful claim and action must be backed by durable state and evidence.

## Architecture Rules

1. Contracts are schema-only.
2. Server services own domain decisions.
3. UI renders view models and dispatches commands; it does not invent state transitions.
4. Mission events are append-only evidence.
5. Projections are derived, repairable, and never the source of truth.
6. Handoffs are typed state transfers, not prose-only summaries.
7. Supervisor execution is persisted step by step.
8. Repo memory is a reviewed projection from evidence, never orchestration truth.
9. Provider-specific behavior stays behind provider adapters or the Presence tool bridge.
10. Shared upstream files get thin hooks only.
11. Every autonomous action has a policy reason.
12. Every task must leave the system easier to test or operate.

## Milestones

| Milestone | Focus | File |
| --- | --- | --- |
| 00 | Baseline and scope | `milestones/00-baseline-and-scope.md` |
| 01 | Contract and state integrity | `milestones/01-contract-state-integrity.md` |
| 02 | Store invariants and idempotency | `milestones/02-store-invariants.md` |
| 03 | Resident controller stepper | `milestones/03-resident-controller.md` |
| 04 | Runtime observation and mission events | `milestones/04-runtime-observation.md` |
| 05 | Agentic loops and handoffs | `milestones/05-agentic-loops.md` |
| 06 | Frontend command facade and cockpit | `milestones/06-ui-product-pass.md` |
| 07 | Repo brain and memory projection | `milestones/07-repo-brain.md` |
| 08 | Release readiness and evaluation | `milestones/08-release-readiness.md` |

## Task Lifecycle

Tasks move through:

`ready -> in-progress -> done`

Use `blocked/` only when a task has a real external dependency. If a task stays blocked or stale, rewrite it or return it to the milestone backlog.

## Task Requirements

Every task must include:

- narrow goal
- architectural reason
- allowed and forbidden files/layers
- clean architecture rule
- acceptance criteria
- test plan
- rollback note
- upstream interference risk
- parallel safety

No task is done until the relevant focused tests pass. Milestone completion requires:

- `bun fmt`
- `bun lint`
- `bun typecheck`
- `bun run test`

Do not run `bun test`.

