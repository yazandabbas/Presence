# PRES-001: Current Presence Baseline

## Summary

Current Presence state is server-owned. The contract surface is defined in `packages/contracts/src/presence.ts`, RPC methods are registered in `packages/contracts/src/rpc.ts`, and WebSocket handlers delegate to `PresenceControlPlane` in `apps/server/src/ws.ts`. The React app reads snapshots and sends commands through `apps/web/src/environmentApi.ts` and `apps/web/src/lib/presenceReactQuery.ts`; it is not the domain source of truth.

## Happy Path

### Repository Import

`presence.importRepository` reuses an existing repo by `workspaceRoot`, creates an orchestration project if needed, inserts `presence_repositories` and `presence_boards`, scans capabilities, and best-effort syncs the board projection.

Relevant files:
- `apps/server/src/presence/Layers/internal/PresenceBoardService.ts`
- `apps/server/src/persistence/Migrations/026_PresenceDomain.ts`

### Goal Intake And Planning

The dashboard currently submits `planNow: true`. The server records a queued intake, optionally flips it to planning, and materializes tickets through `materializeGoalIntakePlan`. Planning reads repo capability context, creates tickets, marks the intake planned, and syncs ticket/board projections. The resident controller can also process queued goals and writes `goal_planning`, `goal_planned`, or `goal_blocked` mission events.

Relevant files:
- `apps/web/src/components/presence/PresenceDashboard.tsx`
- `apps/server/src/presence/Layers/internal/PresenceBoardService.ts`
- `apps/server/src/presence/Layers/PresenceControllerService.ts`

### Worker Attempt

`createAttempt` enforces ticket status and one active attempt, creates an attempt plus workspace, assigns the ticket, and syncs projection. `startAttemptSession` prepares the worktree, chooses a provider/model from Presence settings, existing attempt, repo default, or provider default, creates or recovers a thread, dispatches `thread.create`, then starts the worker turn.

Relevant files:
- `apps/server/src/presence/Layers/internal/PresenceAttemptService.ts`

### Review

The supervisor loop creates attempts, starts workers, waits for handoffs, starts review sessions, reads structured review output or tool-bridge results, and applies review decisions. Review thread creation and turn queueing live in review/merge service. Agentic review artifact columns were added in migration `033`.

Relevant files:
- `apps/server/src/presence/Layers/internal/PresenceSupervisorRuntime.ts`
- `apps/server/src/presence/Layers/internal/PresenceReviewMergeService.ts`
- `apps/server/src/persistence/Migrations/033_PresenceAgenticReviewArtifacts.ts`

### Merge Approval And Cleanup

Human `merge_approved` flows through `submitReviewDecision`, then `handleMergeApprovedDecision` performs policy checks, persists a durable merge operation, applies git merge, marks attempt `merged`, marks ticket `done`, writes outcome/artifact, and cleans up worktree/thread resources. Merge durability is backed by migration `035`.

Relevant files:
- `apps/server/src/presence/Layers/internal/PresenceReviewMergeService.ts`
- `apps/server/src/presence/Layers/internal/PresenceAttemptService.ts`
- `apps/server/src/persistence/Migrations/035_PresenceMergeOperations.ts`

## Known Failure Paths

### Stale Projection

Projection health is tracked by migration `031`, with version/lease fields in migration `032`. Failed projection writes mark scopes `stale`, preserve desired/projected versions, store error details, and schedule retry. Snapshots expose `hasStaleProjections`, and the UI shows projection warnings.

Relevant files:
- `apps/server/src/persistence/Migrations/031_PresenceProjectionHealth.ts`
- `apps/server/src/persistence/Migrations/032_PresenceProjectionScopeVersions.ts`
- `apps/server/src/presence/Layers/internal/PresenceProjectionRuntime.ts`
- `apps/server/src/presence/Layers/internal/PresenceBoardService.ts`
- `apps/web/src/components/presence/PresenceGuidedViews.tsx`

### Duplicate Review

Running supervisor runs are unique per board and active attempts are unique per ticket via migration `034`. `startSupervisorRun` returns the existing same-scope run or rejects different scopes. If a review thread exists but no turn starts, Presence retries on the same review thread before blocking, explicitly to avoid duplicate review threads.

Relevant files:
- `apps/server/src/persistence/Migrations/034_PresenceConcurrencyInvariants.ts`
- `apps/server/src/presence/Layers/internal/PresenceSupervisorRuntime.ts`

### Provider Unavailable

The resident controller classifies provider readiness and sets controller status `harness_unavailable` with a `provider_unavailable` mission event. Runtime exits are ingested as `provider_unavailable` or `runtime_error`.

Relevant files:
- `apps/server/src/presence/Layers/PresenceControllerService.ts`
- `apps/server/src/presence/Layers/PresenceObservationService.ts`

### Malformed Review Result

Reviewer results must be structured. Missing or invalid review output, inconsistent accept-with-blockers, or accept without validation evidence blocks the ticket through review failure paths. Malformed native `presence.submit_review_result` payloads become `review_failed` mission reports.

Relevant files:
- `apps/server/src/presence/Layers/internal/PresenceSupervisorRuntime.ts`
- `apps/server/src/presence/Layers/internal/PresenceReviewMergeService.ts`
- `apps/server/src/presence/Layers/internal/PresenceToolBridge.ts`

### Stuck Controller

Controller state is durable in migration `039`. The controller starts with the orchestration reactor, sweeps boards every two seconds, skips paused boards, and updates `lastTickAt`. There is no explicit stale-controller lease recovery yet; `leaseOwner` and `leaseExpiresAt` exist, but the controller currently uses periodic sweeps and status updates rather than a takeover protocol.

Relevant files:
- `apps/server/src/persistence/Migrations/039_PresenceResidentController.ts`
- `apps/server/src/orchestration/Layers/OrchestrationReactor.ts`
- `apps/server/src/presence/Layers/PresenceControllerService.ts`

## Open Questions

- Should `planNow: true` continue planning synchronously from the UI, or should all goal planning be resident-controller-only for cleaner queue semantics?
- Should controller `leaseOwner` and `leaseExpiresAt` become real stuck-controller takeover invariants?
- Should malformed tool reports from reviewers automatically block the ticket, or should the supervisor first ask the reviewer to resend a valid result?

## Git History Notes

Relevant commits:

- `7181f6e9 feat(presence): add repo organization control plane`
- `0d7ee2b1 feat(presence): track projection health and repair stale mirrors`
- `b056858b feat(presence): make review decisions agentic`
- `1914e0a7 feat(presence): make merge approval durable`
- `8446872c Add Presence mission runtime foundation`
- `d501c337 Add Presence internal mission control`
- `2e71cfc8 Add Presence provider tool bridge`

## Commands Recorded By Auditor

```powershell
Get-Content -Raw .plans/presence/tasks/ready/PRES-001-document-current-presence-baseline.md
git status --short
git log --oneline --decorate --all -- apps/server/src/presence apps/web/src/components/presence packages/contracts/src/presence.ts apps/server/src/persistence/Migrations/026_PresenceDomain.ts
git log --stat --oneline -- apps/server/src/presence packages/contracts/src/presence.ts apps/web/src/components/presence
git diff --check
```

`rg --files` failed with Access denied in the auditor environment, so the auditor used `git ls-files`, `git grep`, and targeted `Get-Content` reads.

