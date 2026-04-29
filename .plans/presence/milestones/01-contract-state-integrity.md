# 01: Contract And State Integrity

## Goal

Make public Presence contracts and persistence shape boring, additive, and durable before expanding behavior.

## Why

The current `PresenceControlPlane` and `BoardSnapshot` expose too much at once. Strong contracts are needed before supervisor, UI, and memory work can safely iterate.

## Outcomes

- Public schemas have focused tests.
- Optional/additive fields decode safely.
- Migration behavior is idempotent.
- Future read models can be split without breaking existing callers.

## Backlog

- Add schema round-trip coverage for current Presence inputs and outputs.
- Audit `BoardSnapshot` fields into core, mission, controller, knowledge, and compatibility groups.
- Verify migrations `026` through `039` are append-only and cold-boot safe.
- Remove accidental churn in old migrations.
- Document public vs internal Presence APIs.

