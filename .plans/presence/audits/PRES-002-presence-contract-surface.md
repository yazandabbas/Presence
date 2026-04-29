# PRES-002: Presence Contract Surface Audit

## Summary

The current Presence contract surface is broad but mostly schema-only. Core records and RPC inputs are stable enough to keep public. `BoardSnapshot` is the largest concern: it is a wide read model that mixes persisted domain state, runtime state, projections, mission feed, controller state, knowledge pages, and compatibility previews.

## Public API

Stable enough to keep public:

- Branded IDs and core enums: `RepositoryId` through `MissionEventId`, ticket/attempt/workspace statuses, priorities, and provider-linked model fields.
- Core persisted board state: `RepositorySummary`, `BoardRecord`, `TicketRecord`, `TicketDependency`, `AttemptRecord`, `WorkspaceRecord`.
- Public RPC inputs/results for repository import/list, board snapshot, ticket CRUD, attempt/workspace/session lifecycle, capabilities, goal intake, human direction, controller mode, supervisor runs, and review decisions.
- WS method names and typed RPC registrations in `packages/contracts/src/rpc.ts`.
- IPC and web RPC surfaces in `packages/contracts/src/ipc.ts` and `apps/web/src/rpc/wsRpcClient.ts`.

Relevant files:
- `packages/contracts/src/presence.ts`
- `packages/contracts/src/rpc.ts`
- `packages/contracts/src/ipc.ts`
- `apps/web/src/rpc/wsRpcClient.ts`

## Internal Compatibility

Treat these as compatibility or implementation-facing rather than stable product contracts:

- `PresenceRpcError`: transport shape, not domain state.
- `ReviewEvidenceItem` decoding defaults: evolved-payload compatibility.
- `GoalIntakeRecord.updatedAt` defaulting to `1970-01-01T00:00:00.000Z`: migration sentinel, not stable domain meaning.
- `PresenceAgentReport` defaults: provider-tool compatibility padding.
- Native `presence.*` tool schemas: currently server-side in `PresenceToolBridge`, injected through orchestration `clientTools`, and not part of `presence.ts`.

Relevant files:
- `packages/contracts/src/presence.ts`
- `apps/server/src/presence/Layers/internal/PresenceToolBridge.ts`
- `apps/server/src/presence/Layers/internal/PresenceRuntimeSupport.ts`
- `packages/contracts/src/orchestration.ts`

## Projection / Read Model

`BoardSnapshot` is a broad read model, not one cohesive domain aggregate.

Current groups:

- Core: `repository`, `board`, `tickets`, `dependencies`.
- Execution: `attempts`, `workspaces`, `attemptSummaries`, `attemptOutcomes`.
- Review/merge: `findings`, `reviewArtifacts`, `reviewDecisions`, `mergeOperations`, `proposedFollowUps`.
- Knowledge/capability/jobs: `evidence`, `promotionCandidates`, `knowledgePages`, `jobs`, `capabilityScan`.
- Supervisor/control: `supervisorHandoff`, `supervisorRuns`, `goalIntakes`, `controllerState`.
- Projection/health/feed: `boardProjectionHealth`, `ticketProjectionHealth`, `hasStaleProjections`, `missionBriefing`, `ticketBriefings`, `missionEvents`.

Important temporary detail: `attemptSummaries.latestWorkerHandoff` can be a live synthetic preview with an ID like `handoff_preview_${attempt.id}` built during snapshot assembly. Do not treat it as persisted stable handoff identity.

Relevant files:
- `packages/contracts/src/presence.ts`
- `apps/server/src/presence/Layers/internal/PresenceBoardService.ts`

## Future Split Candidates

Highest-value future splits from `BoardSnapshot`:

- `BoardCoreSnapshot`: repository, board, tickets, dependencies.
- `TicketExecutionSnapshot`: attempts, workspaces, attempt summaries, attempt outcomes.
- `ReviewMergeSnapshot`: findings, review artifacts, review decisions, merge operations, follow-up proposals.
- `MissionControlSnapshot`: mission briefing, ticket briefings, mission events, controller state.
- `ProjectionHealthSnapshot`: projection health plus stale flag.
- `KnowledgeSnapshot`: evidence, promotion candidates, knowledge pages, deterministic jobs, capability scan.
- `SupervisorSnapshot`: supervisor handoff, supervisor runs, goal intakes.

## Stable Vs Temporary Fields

Stable:

- IDs.
- Status and priority enums.
- Core record timestamps.
- Ticket/attempt/workspace linkage.
- Current public WS API method names.

Temporary or should be wrapped:

- `resumeProtocol` and `DEFAULT_PRESENCE_RESUME_PROTOCOL`: prompt/runtime policy exported from contracts and consumed server-side.
- Mission/control additions with decoding defaults on `BoardSnapshot`: good compatibility pattern.
- Arrays and nullable additions without defaults: future break risk under cached/replayed/version-skewed snapshots.
- `PresenceHandoffRole`: exported but appears DB/internal rather than public RPC.

## Schema-Only Concerns

`packages/contracts/src/presence.ts` is mostly schema-only, but `DEFAULT_PRESENCE_RESUME_PROTOCOL` is runtime policy data in the contracts package. Move that default to server/shared runtime code later and keep only schema shape in contracts.

`Effect.succeed` defaults are acceptable as schema decoding behavior, but they should remain compatibility defaults, not UI or supervisor derivation.

## Commands Recorded By Auditor

```powershell
Get-Content -Raw .plans/presence/tasks/ready/PRES-002-audit-presence-contract-surface.md
Get-Content -Raw packages/contracts/src/presence.ts
Get-ChildItem ... | Select-String ... across apps and packages
git status --short
```

`rg` failed with Access denied in the auditor environment, so the auditor used PowerShell search and targeted line-numbered reads.

