# PRES-012: Observation Correlation Audit

## Scope

Audited current `PresenceObservationService` correlation without editing runtime code.

Primary files inspected:

- `apps/server/src/presence/Layers/PresenceObservationService.ts`
- `apps/server/src/presence/Layers/internal/PresenceStore.ts`
- `apps/server/src/presence/Layers/internal/PresenceToolBridge.ts`
- `apps/server/src/persistence/Migrations/030_PresenceSupervisorRuns.ts`
- `apps/server/src/persistence/Migrations/038_PresenceMissionRuntime.ts`
- `packages/contracts/src/providerRuntime.ts`
- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/presence.ts`

## Current Correlation Flow

`PresenceObservationService` subscribes to two streams:

- Provider runtime stream: `providerService.streamEvents`
- Orchestration domain stream: `orchestrationEngine.streamDomainEvents`

Provider runtime events are correlated by `event.threadId`. If the thread has no Presence correlation, the event is ignored. Native Presence tool reports are checked before generic runtime event drafting.

Orchestration domain events are only considered when `event.aggregateKind === "thread"`. They are correlated by `String(event.aggregateId)`. Non-thread aggregate events are ignored.

Both paths write compact mission events through `writeMissionEvent`, which persists a durable record and dedupes with the database uniqueness constraint `UNIQUE (board_id, dedupe_key)`.

## Correlation Keys Currently Used

### Provider Runtime Event Keys

- `ProviderRuntimeEvent.threadId`
  - Main lookup key into `readPresenceThreadCorrelation`.
  - Also persisted as `presence_mission_events.thread_id`.
  - Used in native tool dedupe keys.
- `ProviderRuntimeEvent.eventId`
  - Used for generic runtime mission-event dedupe: `runtime:${event.eventId}`.
- `ProviderRuntimeEvent.createdAt`
  - Used as mission-event `createdAt`.
- `ProviderRuntimeEvent.type`
  - Selects event-to-mission mapping.
- `ProviderRuntimeEvent.payload`
  - Used for summaries/details, retry classification, and tool-call extraction.
- `ProviderRuntimeEvent.turnId`
  - Present in the contract but not used by observation dedupe/correlation.
- `ProviderRuntimeEvent.itemId`
  - Used only as a fallback native tool-call identity.
- `ProviderRuntimeEvent.requestId`
  - Used only as a fallback native tool-call identity.
- `ProviderRuntimeEvent.providerRefs.providerRequestId`
  - Used only as a fallback native tool-call identity.
- `ProviderRuntimeEvent.providerRefs.providerItemId`
  - Used only as a fallback native tool-call identity.
- `ProviderRuntimeEvent.raw.payload`
  - Searched as a fallback when extracting Presence tool calls.

### Orchestration Domain Event Keys

- `OrchestrationEvent.aggregateKind`
  - Must be `"thread"` or observation ignores the event.
- `OrchestrationEvent.aggregateId`
  - Converted to string and used as the thread correlation lookup key.
  - Persisted as mission-event `threadId`.
- `OrchestrationEvent.eventId`
  - Used for domain mission-event dedupe: `domain:${event.eventId}`.
- `OrchestrationEvent.occurredAt`
  - Used as mission-event `createdAt`.
- `OrchestrationEvent.type`
  - Selects event-to-mission mapping.
- `OrchestrationEvent.payload`
  - Used for summaries/details.
- `OrchestrationEvent.commandId`
  - Not used by observation.
- `OrchestrationEvent.causationEventId`
  - Not used by observation.
- `OrchestrationEvent.correlationId`
  - Not used by observation.
- `OrchestrationEvent.metadata`
  - Not used by observation.

### Presence Thread Lookup Keys

`readPresenceThreadCorrelation(threadId)` tries these sources in order:

1. Worker attempt:
   - `presence_attempts.thread_id = threadId`
   - Joins `presence_tickets` to derive `boardId`.
   - Returns role `worker`, `boardId`, `ticketId`, `attemptId`.
2. Review artifact:
   - `presence_review_artifacts.thread_id = threadId`
   - Joins `presence_tickets` to derive `boardId`.
   - Orders by `artifacts.created_at DESC`.
   - Returns role `review`, `boardId`, `ticketId`, `attemptId`, `reviewArtifactId`.
3. Existing mission event fallback:
   - `presence_mission_events.thread_id = threadId`
   - Orders by `created_at DESC`.
   - Returns the latest mission event's `boardId`, `ticketId`, `attemptId`, `reviewArtifactId`, `supervisorRunId`.
   - Infers role from `kind.startsWith("review")`, `threadId.startsWith("presence_review_thread")`, and `supervisorRunId`.
4. Supervisor run fallback:
   - `presence_supervisor_runs.active_thread_ids_json LIKE %threadId%`
   - Orders by `updated_at DESC`.
   - Returns role `supervisor`, `boardId`, `currentTicketId`, `supervisorRunId`.

### Mission Event Persistence Keys

- `boardId`
  - Required.
  - Scopes mission-event dedupe.
- `ticketId`
  - Optional mission target.
- `attemptId`
  - Optional worker/attempt target.
- `reviewArtifactId`
  - Optional review target.
- `supervisorRunId`
  - Optional supervisor target.
- `threadId`
  - Optional runtime/orchestration source thread.
- `dedupeKey`
  - Required.
  - Unique with `boardId`.

### Native Tool Report Keys

Tool extraction currently scans only `request.opened` and `item.completed`.

Tool name candidates:

- Direct string fields: `toolName`, `tool`, `name`, `title`
- Nested fields up to depth 3: `input`, `args`, `arguments`, `parameters`, `state`, `payload`, `item`

Tool input candidates:

- Direct nested record: `input`, `args`, `arguments`, `parameters`, `toolInput`
- Nested under `state`: `input`, `args`, `arguments`, `parameters`
- Otherwise the candidate record itself

Tool call identity candidates, in order:

1. Payload fields: `toolUseId`, `toolUseID`, `callId`, `callID`, `id`, `requestId`, `providerRequestId`
2. Nested `state` identity using the same fields
3. `event.providerRefs.providerRequestId`
4. `event.providerRefs.providerItemId`
5. `event.requestId`
6. `event.itemId`
7. Fallback: `payload-${hashString(stableStringify(call.input))}`

Tool report dedupe keys:

- Valid tool report: `presence-tool:${event.threadId}:${call.toolName}:${toolCallIdentity(call)}`
- Malformed tool report: `presence-tool-malformed:${event.threadId}:${toolName}:${callId ?? reasonHash}`

## Stable Keys

- `boardId` plus `dedupeKey` is the durable mission-event idempotency boundary.
- Orchestration `eventId` should be stable because orchestration events are append-only persisted events.
- Orchestration thread `aggregateId` is a stable thread key for domain events.
- `presence_attempts.thread_id` is a direct worker-thread claim, although no uniqueness constraint was found on this column.
- `presence_review_artifacts.thread_id` is a direct review-thread claim, but it allows multiple artifacts per thread and resolves by newest `created_at`.
- Native tool `callId` is stable when supplied by the provider/tool lifecycle.

## Unstable Or Ambiguous Keys

- `presence_supervisor_runs.active_thread_ids_json LIKE %threadId%`
  - This can false-match substrings, depends on JSON formatting, and cannot prove array membership.
  - Safer replacement: normalized table or JSON membership query for `(supervisor_run_id, thread_id)`, with an index.
- Existing mission event fallback in `readPresenceThreadCorrelation`
  - This is self-referential: new observation correlation may inherit stale or already-misclassified mission-event context.
  - Role inference from `kind.startsWith("review")` and thread id prefix is a heuristic, not a stable domain claim.
  - Safer replacement: explicit durable thread claim table keyed by `thread_id`, `board_id`, `role`, and target ids.
- Provider runtime `event.eventId`
  - Good only if provider runtime replay preserves the same event id. If a reconnect/replay path regenerates runtime events with new ids, generic runtime mission events duplicate.
  - Safer replacement for generic runtime dedupe: `boardId + threadId + type + stable source id`, where stable source id is `eventId` when durable, else `turnId`, `requestId`, `itemId`, provider refs, or a normalized payload hash.
- Native tool fallback identity `payload-${hash(stableStringify(input))}`
  - Stable across identical payloads, but can collapse two intentional repeated reports with identical input on the same thread and tool name.
  - Safer replacement: prefer durable provider tool call ids; only use payload hash with event/turn context when duplicate intentional reports must be preserved.
- Native tool extraction from `raw.payload`, `title`, and `detail`
  - These are provider-shape dependent and may change between adapters.
  - Safer replacement: a normalized provider runtime tool-call envelope emitted by ingestion.
- Review artifact correlation by newest `created_at`
  - If multiple review artifacts share a thread or timestamps tie/skew, the latest artifact may not be the one that produced the event.
  - Safer replacement: one review-thread claim per thread or a unique `thread_id` constraint where domain rules allow it.
- Worker attempt correlation by `presence_attempts.thread_id LIMIT 1`
  - No ordering or uniqueness constraint was observed for `thread_id`.
  - Safer replacement: unique partial or full index on non-null `presence_attempts.thread_id`, if one thread must belong to one attempt.
- Mission event selection by `ORDER BY created_at DESC`
  - Timestamps are not a strict sequence. Equal timestamps can produce nondeterministic latest records.
  - Safer replacement: order by a monotonic mission event sequence or `created_at DESC, mission_event_id DESC` at minimum.

## Replay And Dedupe Gaps

- Observation subscribes to live provider/domain streams. It does not visibly replay missed historical provider/domain events into mission events on service start. If the process is down while runtime events occur, observation may miss mission evidence unless upstream streams replay into these subscribers.
- Generic runtime dedupe uses only `runtime:${event.eventId}`. This handles duplicate delivery of the same runtime event only if `eventId` is stable across reconnect/replay.
- Domain dedupe uses `domain:${event.eventId}`. This is likely stable for persisted orchestration replay, but observation does not currently use `commandId`, `correlationId`, or stream version as a fallback.
- Tool report dedupe is stronger than generic runtime dedupe when provider call ids exist. Without call ids, identical reports on the same thread/tool collapse by payload hash.
- `INSERT OR IGNORE` prevents duplicate mission records, but `writeMissionEvent` always refreshes ticket and board mission state from the selected persisted row. Replayed old events can still trigger projection refresh work, even when no new mission event is inserted.
- The fallback from `presence_mission_events.thread_id` means a replayed event can continue correlating after direct attempt/review/supervisor claims disappear. This is resilient for history, but unsafe if a thread id is ever reused or a stale fallback outlives the authoritative claim.
- Supervisor correlation via JSON `LIKE` can misattribute runtime events during replay when one thread id is a substring of another active thread id.
- Provider and domain streams can both emit conceptually similar turn/approval evidence. Their dedupe namespaces (`runtime:` and `domain:`) are independent, so equivalent facts from both streams can produce two mission events.

## First Hardening Task

Create a durable Presence thread-correlation registry and make observation read it before all heuristic fallbacks.

Proposed task:

- Add a `presence_thread_correlations` table or equivalent store API keyed by `thread_id`.
- Persist `board_id`, `role`, `ticket_id`, `attempt_id`, `review_artifact_id`, `supervisor_run_id`, `source`, `created_at`, `updated_at`.
- Populate it when worker attempts attach threads, review sessions create/attach threads, and supervisor runs set active thread ids.
- Enforce one authoritative active correlation per `thread_id`.
- Update `readPresenceThreadCorrelation` to use this registry first, then keep current fallbacks temporarily for migration/backfill only.
- Add replay tests proving provider/domain duplicate delivery writes at most one mission event per stable source event and that supervisor thread lookup does not false-match substrings.

This should happen before changing individual event dedupe formulas, because stable source-to-Presence ownership is the foundation for safe dedupe keys.

## Notes

No runtime code or tests were changed for this audit.
