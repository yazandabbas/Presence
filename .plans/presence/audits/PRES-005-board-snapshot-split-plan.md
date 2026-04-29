# PRES-005: Board Snapshot Split Plan

## Summary

`BoardSnapshot` should remain the compatibility response for `presence.getBoardSnapshot` while new read models are introduced behind it. The split should be additive first: define smaller schema-only read models, assemble them from the same source-of-truth tables and runtime readers, then compose the legacy `BoardSnapshot` from those models until all internal and UI consumers have migrated.

The important boundary is that these read models are projections for screens and workflows. They must not become domain aggregates, persistence owners, or mutation inputs.

## Current BoardSnapshot Consumer Map

### Contract and Transport

- `packages/contracts/src/presence.ts`: defines the wide `BoardSnapshot` schema.
- `packages/contracts/src/rpc.ts`: exposes `presence.getBoardSnapshot` over WebSocket with `BoardSnapshot` success.
- `packages/contracts/src/ipc.ts`: exposes the same shape to the IPC environment API.
- `apps/web/src/rpc/wsRpcClient.ts`, `apps/web/src/environmentApi.ts`, `apps/web/src/lib/presenceReactQuery.ts`: fetch and cache one whole-board query under `presenceQueryKeys.boardSnapshot`.

### Server Assembly and Runtime Readers

- `apps/server/src/presence/Layers/internal/PresenceBoardService.ts`: assembles the full snapshot in one method. It queries repository, board, tickets, dependencies, attempts, workspaces, handoffs, evidence, knowledge, jobs, reviews, merge operations, follow-ups, outcomes, supervisor runs, projection health, capability scans, goal intakes, mission state, and controller state.
- `PresenceBoardService.ts` also synthesizes `attemptSummaries.latestWorkerHandoff` from live thread state for in-progress or in-review attempts. Synthetic preview IDs can look like `handoff_preview_${attempt.id}` and must stay compatibility-only.
- `apps/server/src/presence/Layers/internal/PresenceRuntime.ts`: uses snapshots for human direction, controller mode changes, run-start guardrails, active runtime checks, and ticket membership checks.
- `apps/server/src/presence/Layers/internal/PresenceSupervisorRuntime.ts`: uses snapshots to choose scoped tickets, active attempts, blocked tickets, stable-run outcomes, and supervisor loop decisions.
- `apps/server/src/presence/Layers/internal/PresenceProjectionRuntime.ts`: uses snapshots to build supervisor/ticket projection text from tickets, ticket summaries, attempts, handoffs, findings, and projection state.
- `apps/server/src/presence/Layers/PresenceControllerService.ts`: reads snapshots for controller ticks and current board/runtime state.
- Server tests across board, attempt, projection, runtime, review/merge, supervisor, and integration layers assert against `getBoardSnapshot`.

### Web Consumers and Panels

- `apps/web/src/components/presence/PresenceDashboard.tsx`: owns the single whole-board query, selected repository/ticket state, invalidation, derived selected-ticket inputs, supervisor-run gating, active runtime checks from mission events, and mutation refreshes.
- `PresenceBriefingSurface`: consumes mission briefing, controller state, goal intakes, and board projection health.
- `WorkQueueSurface`: consumes tickets, ticket briefings, goal intakes, attempt summaries, ticket summaries, findings, review artifacts, merge operations, follow-ups, mission events, projection health, and capability scan-derived stage data.
- `HumanDirectionPanel`: consumes ticket briefing and selected attempt context.
- `PresenceLiveStatusPanel`: consumes ticket briefing, latest attempt, latest meaningful event, and ticket reason lines.
- `TicketWorkspace`: consumes the selected ticket plus attempt summaries, findings, follow-ups, review artifacts, merge operations, ticket summary, ticket projection health, capability scan, policy decisions, and ticket timeline derivations.
- `ToolsWorkspace` / `MemoryInspector`: consumes supervisor handoff inputs from local form state plus board knowledge pages.
- `ToolsWorkspace` / `OpsInspector`: consumes capability scan, jobs, and promotion candidates.
- `PresencePresentation.ts`: centralizes many UI derivations, but takes the full `BoardSnapshot` for ticket stage, primary action, reason lines, callouts, latest events, timelines, open findings, and retry labels.

## Proposed Read Models

### BoardCoreReadModel

Purpose: stable board identity and queue skeleton.

Fields:
- `repository`
- `board`
- `tickets`
- `dependencies`

Primary consumers:
- repository selection and board header context
- selected-ticket existence and default ticket selection in `PresenceDashboard`
- `WorkQueueSurface` row skeletons
- ticket membership checks in server workflows

Notes:
- This is the lowest-risk first split because it maps directly to persisted records.
- It should not include attempt status, runtime state, or derived ticket summaries.

### TicketDetailReadModel

Purpose: one ticket's execution, review, merge, and local continuity state.

Fields:
- `ticket`
- ticket-scoped `dependencies`
- ticket-scoped `attempts`
- ticket-scoped `workspaces`
- ticket-scoped `attemptSummaries`
- ticket-scoped `ticketSummary`
- ticket-scoped `attemptOutcomes`
- ticket-scoped `findings`
- ticket-scoped `reviewArtifacts`
- ticket-scoped `reviewDecisions`
- ticket-scoped `mergeOperations`
- ticket-scoped `proposedFollowUps`
- ticket-scoped `evidence`

Primary consumers:
- `TicketWorkspace`
- `HumanDirectionPanel` selected attempt context
- `PresenceLiveStatusPanel`
- ticket stage, action, callout, and timeline derivations in `PresencePresentation.ts`
- supervisor runtime decisions for scoped tickets
- projection runtime ticket state files

Notes:
- Keep live synthesized worker handoff previews explicitly marked as non-persisted compatibility data, either via metadata or by keeping them inside a compatibility wrapper until a real live-attempt read model exists.
- Avoid using this model as a mutation input. Mutations should continue to accept command-shaped inputs such as `updateTicket`, `submitReviewDecision`, and `saveWorkerHandoff`.

### MissionFeedReadModel

Purpose: timeline and human-attention state.

Fields:
- `missionBriefing`
- `ticketBriefings`
- recent `missionEvents`
- `goalIntakes`
- optionally a small `activeRuntimeThreadIds` or `hasActiveRuntimeActivity` derived field after the compatibility phase

Primary consumers:
- `PresenceBriefingSurface`
- `WorkQueueSurface` last-update/waiting-on lines
- `HumanDirectionPanel`
- `PresenceLiveStatusPanel`
- `PresenceDashboard` run-supervisor gating and human-direction count
- runtime auto-continue checks after human direction

Notes:
- Keep event retention policy explicit. The current snapshot reads the most recent 50 mission events; a split endpoint should preserve or name that limit.
- Do not fold controller mode into the feed. Controller state changes may produce events, but the current controller state belongs in its own model.

### ControllerStateReadModel

Purpose: resident controller control-plane state.

Fields:
- `controllerState`
- latest relevant `supervisorRuns`
- possibly active thread/run guardrail summaries currently derived from mission events

Primary consumers:
- `PresenceBriefingSurface`
- `PresenceDashboard` run-supervisor availability
- `PresenceControllerService`
- `PresenceSupervisorRuntime`
- `setControllerMode`

Notes:
- Keep `supervisorHandoff` out of this model unless the consuming workflow only needs controller continuity. Supervisor memory belongs with knowledge/supervisor continuity, not live control state.
- If active runtime activity remains derived from mission events, document whether `ControllerStateReadModel` depends on `MissionFeedReadModel` or computes the same predicate server-side.

### ProjectionHealthReadModel

Purpose: repair/staleness visibility and projection maintenance.

Fields:
- `boardProjectionHealth`
- `ticketProjectionHealth`
- `hasStaleProjections`

Primary consumers:
- `ProjectionHealthIndicator`
- `PresenceBriefingSurface`
- `BoardColumn` / ticket projection badges
- ticket stage/callout derivations
- projection runtime repair tests

Notes:
- Keep health records read-only. Repairs should continue through explicit sync/repair commands.
- `hasStaleProjections` should remain derived from the two health collections, not stored as a separate source of truth.

### KnowledgeReadModel

Purpose: durable project memory, promotions, deterministic work, and repository capability context.

Fields:
- `supervisorHandoff`
- `knowledgePages`
- `promotionCandidates`
- `jobs`
- `capabilityScan`
- optionally board-scoped `evidence` that is not naturally ticket-local

Primary consumers:
- `ToolsWorkspace`
- `MemoryInspector`
- `OpsInspector`
- supervisor resume/projection workflows
- repository capability scan panels and ticket stage derivations

Notes:
- If `capabilityScan` is needed by both ticket detail and ops panels, keep it board-scoped here and pass it into ticket derivations as auxiliary context.
- Keep promotion acceptance/rejection command-shaped; do not let the read model imply write ownership.

## Compatibility Strategy

1. Keep `BoardSnapshot` public and keep `presence.getBoardSnapshot` returning the exact legacy shape during migration.
2. Add new schema-only read model types in contracts as additive exports. Do not remove or rename existing fields.
3. Add a server-side compatibility assembler that composes `BoardSnapshot` from the smaller read models. During the first phase, this can be a pure extraction/recomposition wrapper around the existing query result.
4. Preserve decoding defaults already used for mission/control additions. Any newly optional compatibility fields should decode to `null` or `[]`, not fail older cached/replayed payloads.
5. Preserve the current ordering semantics while consumers migrate:
   - tickets: `updated_at DESC, created_at DESC`
   - attempts: `created_at DESC`
   - mission events: recent events, currently limited to 50
   - supervisor runs, jobs, knowledge, reviews, merges, follow-ups: current descending update/create ordering
6. Treat synthetic `latestWorkerHandoff` previews as legacy view data. Do not expose preview IDs as persisted handoff identity in new command paths.
7. Keep React Query invalidation broad at first. New query keys can fan out from one invalidation helper per board until mutation-specific invalidation is proven safe.
8. Only after all first-party consumers stop requiring the wide shape should `BoardSnapshot` become a deprecated compatibility wrapper.

## Migration Order

1. Create pure web selectors over the existing `BoardSnapshot` that return the proposed read model shapes. This is migration-free and gives UI components narrower props without transport churn.
2. Move `PresencePresentation.ts` derivations to accept the narrowest model they actually need. Start with `ProjectionHealthReadModel`, `MissionFeedReadModel`, and ticket-scoped slices because those remove the most accidental coupling.
3. Split `PresenceDashboard` local derivations into named selectors: selected ticket detail, mission feed summary, controller gating, knowledge tools state, and projection health.
4. Add contract read model schemas as additive exports. Keep them schema-only and avoid runtime policy constants.
5. Add server read-model assemblers internally, initially sourced from the same data as `getBoardSnapshotInternal`.
6. Introduce optional internal control-plane methods for the narrow models. Server runtimes should migrate before public web transport, because they are easier to test and have fewer compatibility clients.
7. Add web query options for narrow read models behind the existing dashboard. Keep the wide snapshot query available until all panels have narrow replacements.
8. Change `presence.getBoardSnapshot` implementation to compose from the new assemblers. This is the point where the compatibility wrapper becomes the legacy API, not the primary architecture.
9. Mark `BoardSnapshot` as compatibility/deprecated in comments and documentation only after every internal runtime and UI panel has moved to narrow models.

## Migration-Free First Steps

- Add selector/helper names in docs or tests before changing transport: `selectBoardCore`, `selectTicketDetail`, `selectMissionFeed`, `selectControllerState`, `selectProjectionHealth`, and `selectKnowledge`.
- Move repeated ticket lookups in `PresenceDashboard`, `PresenceGuidedViews.tsx`, and `PresencePresentation.ts` behind selector functions that still accept `BoardSnapshot`.
- Add focused tests for selector outputs using existing `BoardSnapshot` fixtures.
- Document the synthetic handoff preview rule beside selector tests so future code does not persist preview IDs.
- Keep the current RPC method, query key, and invalidation behavior untouched during the first PR.

## Tests Needed When Implementing

No code tests are required for this PRES-005 planning task. When the split is implemented, add or preserve:

- Contract decode tests for every new read model, including defaulted optional fields for compatibility.
- A `BoardSnapshot` compatibility test proving composition from read models produces the legacy shape and preserves existing field ordering.
- Selector tests for web derivations currently in `PresencePresentation.ts`.
- Dashboard integration tests covering repository selection, selected ticket fallback, human-direction panel selection, run-supervisor gating, and broad invalidation after mutations.
- Server assembler tests for each read model, especially ticket-scoped filtering and board-scoped capability scan/knowledge fields.
- Synthetic worker handoff tests proving preview IDs are not treated as persisted handoff IDs and do not leak into write paths.
- Projection/runtime tests proving projection health and mission feed splits still support repair, auto-continue, and active-runtime guardrails.
- Use `bun run test`, not `bun test`, for test execution.
- Before marking implementation complete, run `bun fmt`, `bun lint`, and `bun typecheck`.

## Upstream-Interference Notes

- The current worktree has many modified Presence, orchestration, provider, contract, and web files, plus untracked `.plans/presence/` content. PRES-005 should avoid runtime edits and only add this audit plan.
- Recent upstream work appears to include resident controller state, mission runtime, observation, and broad contract changes. Those changes overlap directly with `controllerState`, `missionBriefing`, `ticketBriefings`, and `missionEvents`, so implementation should be rebased or refreshed immediately before adding schemas.
- `PRES-002` identified `BoardSnapshot` as a compatibility-heavy read model and flagged `DEFAULT_PRESENCE_RESUME_PROTOCOL` as runtime policy in contracts. Do not expand that pattern when adding new read models.
- The split should expect concurrent changes to `PresenceBoardService.ts`, `PresenceRuntime.ts`, `PresenceSupervisorRuntime.ts`, `PresenceProjectionRuntime.ts`, `PresenceDashboard.tsx`, `PresenceGuidedViews.tsx`, and `PresencePresentation.ts`. Prefer additive helpers and small migration PRs to reduce conflict pressure.
- Because `.plans/presence/` is currently untracked as a directory in `git status`, confirm ownership before staging or committing planning files.

## Key Recommendations

- Start with selector-level narrow models over the existing snapshot. It delivers immediate coupling reduction without breaking transport.
- Make `BoardSnapshot` a composed compatibility wrapper, not the architecture center.
- Split mission feed and controller state separately; event history and current control-plane state change at different rates and serve different consumers.
- Keep capability scan board-scoped and pass it into ticket derivations as auxiliary context.
- Treat live worker handoff previews as ephemeral UI/runtime hints. Never promote `handoff_preview_*` IDs to persisted identity.
