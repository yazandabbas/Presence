# PRES-014: Worker Handoff Invariant Audit

## Summary

Worker handoffs currently carry useful continuity state, but the invariant surface is mostly structural: the contract requires arrays and IDs, the store persists JSON, and the supervisor consumes the latest handoff by attempt. The missing layer is receiver validation against current durable state before orchestration acts on the handoff.

Before PRES-016 unblocks, the receiver should treat worker handoffs as evidence-bearing claims about an attempt, not as authoritative state. Current tickets, attempts, workspaces, findings, evidence rows, thread state, changed files, and review artifacts must win when they disagree with handoff content.

## Current Surface

Contract fields are defined in `packages/contracts/src/presence.ts`:

- `WorkerHandoffRecord`: `id`, `attemptId`, `completedWork`, `currentHypothesis`, `changedFiles`, `testsRun`, `blockers`, `nextStep`, `openQuestions`, `retryCount`, `reasoningSource`, `reasoningUpdatedAt`, `confidence`, `evidenceIds`, `createdAt`.
- `PresenceSaveWorkerHandoffInput`: same content minus generated `id` and `createdAt`; `currentHypothesis`, `nextStep`, `openQuestions`, `retryCount`, `reasoningSource`, `reasoningUpdatedAt`, and `confidence` are optional or nullable.
- `confidence` is only `Schema.Number`; no domain bounds prevent negative, `NaN`-like transport edge cases, or values above `1`.
- `evidenceIds` are typed as IDs but are not guaranteed by the input schema to exist for the same attempt.

Persistence is in `presence_handoffs`:

- `handoff_id` is the primary durable identity.
- `attempt_id` references `presence_attempts`.
- `role = 'worker'` distinguishes worker handoffs from supervisor handoffs.
- `payload_json` carries the contract payload.
- `presence_attempts.last_worker_handoff_id` points at the newest saved worker handoff.

Runtime save behavior:

- `saveWorkerHandoff` inserts a new `presence_handoffs` row and updates the attempt summary, confidence, `last_worker_handoff_id`, and `updated_at` in one transaction.
- It writes a mission event with dedupe key `worker-handoff:${handoffId}` after the transaction.
- `readLatestWorkerHandoffForAttempt` selects by `attempt_id` and `role = 'worker'`, ordered by `created_at DESC`, independent of `last_worker_handoff_id`.
- `synthesizeWorkerHandoffFromThread` avoids saving when the synthesized payload is materially identical to the previous latest handoff.

Important compatibility detail from PRES-002: `attemptSummaries.latestWorkerHandoff` may be a synthetic preview during snapshot assembly, with an ID shaped like `handoff_preview_${attempt.id}`. That preview must never be treated as durable handoff identity.

## Required Handoff Content

The minimum durable worker handoff should include:

- Objective: the ticket title/description and acceptance checklist are not inside `WorkerHandoffRecord`; the receiver must join through `attemptId -> ticketId` and re-anchor to the current ticket. If a handoff is used outside that join context, it is incomplete.
- Changed files: `changedFiles` should be the worker's claimed affected surface. Empty is acceptable only when the work was research, diagnosis, planning, or blocked before edits.
- Commands: current field is `testsRun`; it should be interpreted as all validation commands that matter, not only tests. Receiver logic should warn when changed files exist but no validation command or explanation exists.
- Blockers: `blockers` should represent active blocking conditions, not historical friction. Receiver logic should reconcile it with open blocking findings and ticket status.
- Next step: `nextStep` should be non-null unless the attempt is accepted, merged, blocked, or has a blocker that clearly implies the next action.
- Confidence: should be bounded to `0 <= confidence <= 1` when present and treated as advisory only.
- Evidence: `evidenceIds` should point to persisted `presence_attempt_evidence` rows for the same attempt. Changed files can be evidence hints, but they are not durable evidence by themselves.

## Insufficient Current Fields

Current handoff fields are insufficient for durable receiver checks in these ways:

- No explicit objective snapshot. `attemptId` is enough to re-anchor, but the handoff does not prove which ticket objective the worker believed it was solving. Receiver must always load current ticket state.
- No parent handoff identity or sequence number. Duplicate prevention relies on payload comparison during synthesis and `created_at DESC` on read. Manual/API saves can still create multiple semantically identical durable handoffs.
- No explicit idempotency key. A retry of the same save request gets a fresh `handoffId`, fresh mission event, and new `last_worker_handoff_id`.
- No stable source thread/turn identity. `reasoningUpdatedAt` and `reasoningSource` say where reasoning came from in broad terms, but not which provider thread turn produced the handoff.
- No status-at-write fields. The handoff does not record attempt status, ticket status, workspace status, or current commit/worktree observation at save time, so staleness has to be inferred externally.
- `changedFiles` are free-form strings. Receiver must normalize paths and reject empty/absolute/out-of-workspace/suspicious paths before using them for review or merge decisions.
- `testsRun` are free-form strings. Receiver cannot distinguish passed, failed, skipped, or not applicable validation without supplemental evidence.
- `blockers` are free-form strings. Receiver cannot know whether they are current, resolved, repeated, or already promoted to findings/tickets without comparing against current findings and mission events.
- `confidence` is unbounded and lacks calibration semantics.
- `evidenceIds` are not cross-checked in the save input or read mapper against current attempt ownership.

## Durable Identity Invariants

Receiver code should require these identity invariants:

- A durable worker handoff ID must be a persisted `presence_handoffs.handoff_id`, not a projection preview ID.
- The handoff row must have `role = 'worker'`, non-null `attempt_id`, and a payload that decodes to `WorkerHandoffRecord`.
- `handoff.attemptId` must match the row `attempt_id`, the requested attempt, and the selected attempt under review.
- The attempt must still exist and belong to the ticket being acted on.
- `presence_attempts.last_worker_handoff_id`, when present, should point to the handoff the receiver is using. If the latest-by-created-at row and pointer disagree, emit a warning mission event and prefer the pointer only if the pointed row exists and belongs to the same attempt.
- Synthetic IDs, missing rows, wrong-role rows, and cross-attempt IDs must be rejected for orchestration decisions.

## Duplicate Prevention Invariants

The current system has partial duplicate prevention only for synthesized handoffs. PRES-016 should assume duplicate durable rows may already exist and define receiver behavior:

- If two worker handoffs for the same attempt have equivalent normalized payloads, the receiver should treat the newest durable one as a duplicate update, not as new progress.
- Equivalent payload comparison should ignore generated `id`, `createdAt`, and mission-event side effects, and should normalize array order only where order is not semantically meaningful.
- A duplicate handoff must not trigger another review, merge, restart, or promotion path by itself.
- A duplicate or stale handoff can create at most one warning mission event per stable dedupe key, such as `worker-handoff-duplicate:${attemptId}:${payloadHash}`.
- Manual saves should eventually get an idempotency key or content hash, but receiver checks should not depend on that future field.

## Malformed Handoff Invariants

Malformed handoffs should be classified, warned, and bypassed rather than repaired silently:

- Missing required arrays after decode defaulting: `completedWork`, `changedFiles`, `testsRun`, `blockers`, or `evidenceIds` defaulting to empty should be treated as compatibility fallback, not proof of valid agent state.
- Empty continuity: no `completedWork`, no `currentHypothesis`, no `changedFiles`, no `blockers`, and no `nextStep` means the handoff is unusable for review/merge.
- Contradictory state: blockers present while `nextStep` asks for approval/merge, or high confidence with no evidence and no validation.
- Invalid confidence: null is acceptable; non-null must be finite and within `[0, 1]`.
- Invalid paths: changed files should be repository-relative, normalized, unique, and inside the attempt workspace/repository scope.
- Invalid evidence: every `evidenceId` should exist, belong to the same attempt, and be relevant to either changed files, validation, blockers, or acceptance criteria.
- Stale reasoning: if `reasoningUpdatedAt` is older than newer evidence, review decisions, findings, or changed-file observations, mark the handoff stale and proceed from current state.

## Receiver Checks Before PRES-016 Unblocks

PRES-016 is scoped to supervisor handoff receiver checks, but it should also protect every place the supervisor accepts worker handoff facts:

- Re-anchor by ID: load current board, ticket, attempt, workspace, latest durable worker handoff, findings, evidence, review artifacts, and mission events before acting.
- Validate attempt linkage: active handoff attempt must belong to the current ticket and must have execution context before review, approval, merge, or retry.
- Validate durability: reject synthetic preview handoffs and handoffs not pointed to by current durable state.
- Validate freshness: compare handoff `createdAt` and `reasoningUpdatedAt` with newer findings, evidence, review artifacts, attempt outcomes, merge operations, and thread state.
- Validate changed files: normalize and compare claimed `changedFiles` with actual changed files/checkpoints when available; warn on drift.
- Validate evidence: require persisted same-attempt evidence or concrete review evidence before accepting or promoting work.
- Validate blocker consistency: if handoff blockers exist, ticket should not move to accepted/merge without explicit current resolution; if current blocking findings exist but handoff has no blockers, current findings win.
- Validate duplicate/stale handoffs: emit warning mission events with stable dedupe keys and continue from current state.
- Validate malformed content: refuse to launch review/merge from empty or contradictory handoffs; mark human/manual retry only when current state cannot decide safely.

## Proposed Tests Before Implementation

Focused tests should cover:

- Durable identity: latest worker handoff receiver rejects `handoff_preview_*`, wrong-role handoffs, missing rows, and cross-attempt handoffs.
- Pointer disagreement: `last_worker_handoff_id` disagrees with latest-by-created-at and creates one warning while choosing a deterministic source.
- Duplicate prevention: repeated identical manual saves do not cause duplicate review starts or duplicate warning/event loops.
- Malformed payload: empty continuity, invalid confidence, invalid changed-file paths, and missing same-attempt evidence are refused or warned.
- Stale handoff: newer finding/evidence/review artifact overrides old handoff claims.
- Blocker contradiction: handoff says no blockers while current blocking finding exists; supervisor proceeds from finding state.
- Changed-file drift: handoff claims files that no longer match actual changed files/checkpoints; review is blocked or warned until refreshed.
- Happy path: a valid latest durable handoff with same-attempt evidence, changed files, validation commands, no blockers, bounded confidence, and next step can proceed to review.

Run focused board/supervisor tests plus `bun typecheck` when implementation lands. This audit itself requires no code tests.

## Commands Recorded By Auditor

```powershell
Get-Content -Raw .plans/presence/tasks/ready/PRES-014-worker-handoff-invariant-audit.md
git status --short
Get-ChildItem -Recurse -File .plans\presence
Get-ChildItem ... | Select-String -Pattern 'handoff|worker|attempt|resume|confidence|blocker'
Get-Content targeted ranges from packages/contracts/src/presence.ts
Get-Content targeted ranges from apps/server/src/presence/Layers/internal/PresenceAttemptService.ts
Get-Content targeted ranges from apps/server/src/presence/Layers/internal/PresenceStore.ts
Get-Content targeted ranges from apps/server/src/presence/Layers/internal/PresenceBoardService.ts
Get-Content targeted ranges from apps/server/src/presence/Layers/internal/PresenceSupervisorRuntime.ts
Get-Content -Raw .plans/presence/tasks/blocked/PRES-016-supervisor-handoff-receiver-checks.md
```

`rg` failed with Access denied in this auditor environment, so PowerShell search and targeted reads were used.
