# PRES-016: Handoff Receiver Checks Plan

## Scope

PRES-016 should add receiver-side validation for supervisor handoffs before the supervisor loop trusts `activeAttemptIds`, `blockedTicketIds`, or handoff-derived continuity. The runtime must re-anchor to the current board snapshot and durable rows, then emit warning mission events for stale or contradictory handoff claims.

This plan is analysis only. Runtime code was not edited.

## Current Entry Points

- `apps/server/src/presence/Layers/internal/PresenceBoardService.ts`
  - `getBoardSnapshotInternal`: currently loads the latest supervisor handoff at lines 1003-1008 and worker handoffs at lines 1009-1016, then exposes synthetic live worker handoff previews in `attemptSummaries` at lines 1253-1276.
  - `saveSupervisorHandoff`: persists supervisor handoff payloads at lines 2010-2055 without checking whether `activeAttemptIds` or `blockedTicketIds` match current board state.
  - `ensurePromotionCandidateForAcceptedAttempt`: builds promotion truth from `workerHandoff.completedWork` and findings at lines 1628-1677, so any accepted work path must only pass a receiver-validated worker handoff here.
  - `evaluateSupervisorActionInternal`: already checks policy against current ticket, attempt context, findings, outcomes, and capability scan at lines 1679-1725. It is a good model for "current state wins", but it does not validate handoff payloads.

- `apps/server/src/presence/Layers/internal/PresenceSupervisorRuntime.ts`
  - `saveTerminalSupervisorHandoff`: derives active attempts and blocked tickets from fresh snapshots at lines 349-389. This path is mostly safe because it writes from current state.
  - `executeSupervisorRun`: saves loop handoffs from fresh snapshots at lines 706-771. This is another safe writer, but it does not validate any previous supervisor handoff before resuming.
  - Worker handoff receiver points before orchestration decisions:
    - Completed review reconciliation reads `latestWorkerHandoff` at lines 543-545, then uses it for validation evidence, mechanism checklist support, and promotion candidate creation at lines 561-601.
    - Normal ticket flow synthesizes/reads `latestWorkerHandoff` at lines 949-953, then passes it into review session start/restart/queue at lines 1043-1049, 1104-1111, and 1169-1178.
    - Review-result application uses `latestWorkerHandoff` again for validation checks and promotion at lines 1309-1384.
    - Request-changes continuation reads `refreshedHandoff` at lines 1393-1451.

- `apps/server/src/presence/Layers/internal/PresenceStore.ts`
  - `mapSupervisorHandoff`: decodes handoff payloads with empty-array fallbacks at lines 209-245. Empty arrays are compatibility fallbacks, not proof that no active attempts or blocked tickets exist.
  - `readLatestSupervisorHandoffForBoard`: selects latest supervisor row by `created_at DESC` at lines 994-1021.
  - `readLatestWorkerHandoffForAttempt`: selects latest worker row by `created_at DESC` at lines 1023-1049, independent of `presence_attempts.last_worker_handoff_id`.
  - `writeMissionEvent`: supports `INSERT OR IGNORE` dedupe by `(board_id, dedupe_key)` at lines 2505-2589. Receiver warnings should use this instead of creating findings unless human action is required.

## Receiver Checks To Add

Add a small receiver validation helper in `PresenceBoardService.ts`, then pass it into `PresenceSupervisorRuntime.ts` through the existing internal dependency seam. Keep the helper private to the presence internals unless another service immediately needs it.

Suggested helper shape:

```ts
type SupervisorHandoffReceiverCheck = Readonly<{
  handoff: SupervisorHandoffRecord;
  validActiveAttemptIds: ReadonlyArray<string>;
  staleActiveAttemptIds: ReadonlyArray<string>;
  validBlockedTicketIds: ReadonlyArray<string>;
  staleBlockedTicketIds: ReadonlyArray<string>;
  contradictoryBlockedTicketIds: ReadonlyArray<string>;
  warningDedupeKeys: ReadonlyArray<string>;
}>;
```

Concrete checks:

- Active attempts:
  - For each `handoff.activeAttemptIds`, find a current `AttemptRecord` in the latest snapshot.
  - Warn if the attempt is missing.
  - Warn if the attempt's `ticketId` is outside the current supervisor run scope when a run scope is available.
  - Warn if the attempt status is terminal: `accepted`, `merged`, or `rejected`.
  - Treat only current non-terminal attempts as usable. Do not restart, review, or continue work just because a stale active ID appears in the handoff.

- Blocked tickets:
  - For each `handoff.blockedTicketIds`, find a current ticket in the latest snapshot.
  - Warn if the ticket is missing.
  - Warn if the ticket is no longer `blocked` and has no open blocking finding. This is a stale blocked claim.
  - If a ticket is currently `blocked` or has an open blocking finding but is missing from `handoff.blockedTicketIds`, current state wins. The supervisor should still treat it as blocked and emit a warning that the handoff omitted a current blocker.
  - If a ticket is marked blocked by handoff but current state is actionable (`todo`, `in_progress`, `in_review`) and no open blocking finding exists, the supervisor should proceed from current state.

- Current run and stage:
  - If `handoff.currentRunId` is non-null but no current running run with that ID exists, warn and ignore it.
  - If `handoff.stage` conflicts with the persisted `SupervisorRunRecord.stage`, warn and use the persisted run.

- Synthetic worker handoffs:
  - The receiver must not validate `handoff_preview_${attempt.id}` as durable worker handoff identity.
  - Before review, merge, acceptance promotion, or request-changes continuation, use only a handoff returned by `readLatestWorkerHandoffForAttempt` or a newly saved result from `synthesizeWorkerHandoffFromThread`. If the code keeps accepting synthetic previews from `getBoardSnapshotInternal`, add an explicit `!id.startsWith("handoff_preview_")` guard before orchestration decisions.

- Worker handoff consistency at supervisor decision points:
  - `latestWorkerHandoff.attemptId` must equal `activeAttempt.id` or the review event attempt ID.
  - `activeAttempt.ticketId` must equal the current ticket under evaluation.
  - If the current ticket has open blocking findings, blockers in the handoff are advisory; current findings block acceptance and promotion.
  - If the handoff has blockers but current ticket/findings show no blocker, warn and continue from current ticket state.
  - If `reasoningUpdatedAt` or `createdAt` predates newer open findings, review artifacts, merge operations, or attempt outcomes for that attempt, warn and avoid launching new review solely from the stale handoff.

## Warning Mission Events

Use `deps.writeMissionEvent` directly from `PresenceSupervisorRuntime.ts` or a BoardService helper. Prefer:

- `kind`: `runtime_warning`
- `severity`: `warning`
- `retryBehavior`: `not_applicable`
- `dedupeKey` examples:
  - `supervisor-handoff-stale-active-attempt:${handoff.id}:${attemptId}`
  - `supervisor-handoff-stale-blocked-ticket:${handoff.id}:${ticketId}`
  - `supervisor-handoff-omitted-current-blocker:${handoff.id}:${ticketId}`
  - `supervisor-handoff-run-mismatch:${handoff.id}:${run.id}`
  - `worker-handoff-stale-for-review:${attemptId}:${workerHandoff.id}`
  - `worker-handoff-preview-rejected:${attemptId}`

Warnings should be side effects only. They must not make stale handoff text authoritative.

## Test Cases

Add focused tests in `apps/server/src/presence/Layers/internal/PresenceSupervisorRuntime.test.ts` for runtime receiver behavior, and one or two snapshot-focused tests in `PresenceBoardService.test.ts` only if the helper lives there.

Runtime tests:

- Stale active attempt ID:
  - Seed a supervisor handoff with `activeAttemptIds` containing an attempt that is now `accepted` or `merged`.
  - Start/execute a supervisor run.
  - Assert a `runtime_warning` mission event with a stable `supervisor-handoff-stale-active-attempt:*` dedupe key.
  - Assert the supervisor does not start review or continuation from that terminal attempt.

- Cross-scope active attempt ID:
  - Seed two scoped tickets and one foreign ticket on the same board.
  - Save a handoff whose `activeAttemptIds` includes the foreign attempt.
  - Assert a warning and verify actionable tickets are chosen from `run.scopeTicketIds`, not the handoff.

- Stale blocked ticket ID:
  - Save handoff with `blockedTicketIds` containing a ticket now `in_progress` and no open blocking finding.
  - Assert warning.
  - Assert the ticket remains actionable and can create/reuse an attempt.

- Omitted current blocker:
  - Save handoff with no blocked IDs.
  - Seed a ticket with status `blocked` or an open blocking finding.
  - Assert warning and verify the supervisor does not treat the ticket as actionable.

- Handoff current run mismatch:
  - Save handoff with `currentRunId` pointing to a completed or unrelated run.
  - Start a new run.
  - Assert warning and verify persisted `SupervisorRunRecord` remains the source of stage/scope truth.

- Worker handoff attempt mismatch:
  - Unit-test the receiver helper if possible, or seed a wrong/cross-attempt latest handoff row manually.
  - Assert review is not started with that worker handoff and a warning is emitted.

- Worker handoff stale versus current blocker:
  - Save a worker handoff with no blockers.
  - Create a newer open blocking finding for the same ticket/attempt.
  - Assert accept/promotion paths use the current finding and do not promote `completedWork`.

- Synthetic preview rejection:
  - Use a running/in-review attempt whose snapshot summary has `handoff_preview_*`.
  - Assert the runtime does not treat that preview ID as durable handoff evidence for review/merge decisions.

BoardService tests, if helper is placed there:

- `saveSupervisorHandoff` can still persist old handoff shapes, but `validateSupervisorHandoffAgainstSnapshot` classifies stale active attempts and blocked tickets deterministically.
- `getBoardSnapshotInternal` may expose synthetic worker previews for display, but receiver validation marks `handoff_preview_*` as non-durable.

Run commands after implementation:

```powershell
bun run test apps/server/src/presence/Layers/internal/PresenceSupervisorRuntime.test.ts
bun run test apps/server/src/presence/Layers/internal/PresenceBoardService.test.ts
bun fmt
bun lint
bun typecheck
```

Do not run `bun test`.

## Minimal Implementation Sequence

1. Add a pure helper in `PresenceBoardService.ts` or a nearby internal module owned by the allowed layer that validates a `SupervisorHandoffRecord` against a fresh `BoardSnapshot` and optional current `SupervisorRunRecord`.
2. Expose the helper through `PresenceBoardServiceInternals` only if `PresenceSupervisorRuntime.ts` needs to call it. Keep contracts unchanged.
3. In `executeSupervisorRun`, read the latest supervisor handoff from the fresh snapshot at the beginning of each loop iteration, validate it against the same snapshot/run, emit deduped `runtime_warning` mission events, and discard stale handoff claims.
4. Add a local worker handoff guard in `PresenceSupervisorRuntime.ts` at the three receiver points before review start/restart/queue, completed-review reconciliation, and review-result application.
5. Make all decisions continue from `snapshot.tickets`, `snapshot.attempts`, `snapshot.findings`, `snapshot.reviewArtifacts`, `snapshot.mergeOperations`, and persisted `SupervisorRunRecord`; never from handoff arrays alone.
6. Add focused tests in the order above, starting with stale active attempt and stale blocked ticket because they directly cover the PRES-016 acceptance criteria.
7. Run the focused test files, then `bun fmt`, `bun lint`, and `bun typecheck`.

## Key Recommendation

Treat supervisor and worker handoffs as continuity hints. The receiver should validate them, warn once per stable mismatch, and then operate from the current durable board state. The most important implementation detail is to put checks immediately before orchestration uses handoff-derived data: review kickoff, review reconciliation, acceptance promotion, request-changes continuation, and run resume.
