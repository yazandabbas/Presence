# Decision: Presence Cockpit, Attention Queue, And Evidence Panel

Date: 2026-04-29
Status: Accepted
Milestone: 06-ui-product-pass

## Context

Presence is meant to feel like a repo operator, not a raw board viewer. The current UI is closer than the first dashboard, but it still mixes three jobs in the same component surface:

- command/control: accepting goals, running the supervisor, sending direction, approving review outcomes
- attention triage: showing which work needs the human and what Presence is waiting on
- evidence inspection: exposing handoffs, findings, reviews, timeline events, policy gates, and tools

This makes the product feel busy. It also makes the code harder to reason about because `PresenceGuidedViews.tsx` renders the cockpit, work queue, human direction panel, live status panel, ticket workspace, evidence cards, and tools in one large file. The server must remain the source of truth; the web UI should prioritize and explain server-owned state, not create a second policy engine.

## Decision

Split the Presence screen into three conceptual surfaces:

1. **Cockpit**
   The always-visible command and status surface. It answers: "What is Presence doing, can it continue, and what is the safest next command?"

2. **Attention Queue**
   The prioritized work list. It answers: "What needs human attention first, what is moving without me, and what is waiting?"

3. **Evidence Panel**
   The inspector/audit surface for the selected item. It answers: "Why does Presence believe this, and what evidence or command path produced that belief?"

This is a UI architecture split, not a new backend domain model. The split should be implemented with web-local view models derived from `BoardSnapshot`, existing policy decisions, command definitions, and local query state.

## Responsibilities

### Cockpit

Responsibilities:

- Show the current repo, Presence controller state, latest supervisor state, projection health, active runtime status, and human-action count.
- Own the primary command bar for repo-level goals and registered Presence commands.
- Show at most one primary recommendation at a time.
- Disable commands using centralized command definitions, with visible disabled reasons.
- Show fast local feedback for submitted goals, supervisor starts, and human directions.

Current component mapping:

- `PresenceDashboard` remains the page shell.
- `RepositorySelector` stays in the page header for now.
- `PresenceBriefingSurface` becomes `PresenceCockpit` after extraction.
- Goal submission and run-supervisor controls should continue to use `PresenceCommandDefinition`.

View-model inputs:

- `BoardSnapshot.repository`
- `BoardSnapshot.controllerState`
- `BoardSnapshot.supervisorRuns[0]`
- `BoardSnapshot.missionBriefing`
- `BoardSnapshot.boardProjectionHealth`
- queued/planning `goalIntakes`
- `hasActivePresenceRuntimeThread`
- selected repository and selected Presence harness availability
- relevant command definitions

Command outputs:

- `presence.goal.submit`
- `presence.supervisor.run`
- repository import/refresh/rescan commands
- future controller pause/resume commands
- future global thread-control commands

### Attention Queue

Responsibilities:

- Prioritize items needing human attention above routine active work.
- Include queued goals, planning goals, active tickets, blocked tickets, review tickets, and completed/done tickets only when useful.
- Explain stage, latest meaningful update, and waiting-for reason in compact rows.
- Select work for evidence inspection.
- Never invent status; it must derive from mission briefing, ticket briefing, ticket state, attempts, findings, review artifacts, merge operations, and mission events.

Current component mapping:

- `WorkQueueSurface` becomes `PresenceAttentionQueue`.
- Its row ordering logic should move out of JSX into a pure view-model helper.
- Existing `deriveTicketStage`, `deriveTicketReasonLine`, and `deriveLatestMeaningfulEvent` remain useful but should feed a queue-specific row model.

View-model inputs:

- `BoardSnapshot.goalIntakes`
- `BoardSnapshot.tickets`
- `BoardSnapshot.ticketBriefings`
- `BoardSnapshot.ticketSummaries`
- `BoardSnapshot.attemptSummaries`
- `BoardSnapshot.findings`
- `BoardSnapshot.reviewArtifacts`
- `BoardSnapshot.mergeOperations`
- `BoardSnapshot.missionEvents`
- selected ticket id
- repository capability scan

Command outputs:

- select ticket
- open selected ticket thread/attempt
- future "resolve this attention item" command dispatch

### Evidence Panel

Responsibilities:

- Show the selected ticket's current state, policy gates, latest meaningful event, handoff evidence, review evidence, findings, proposed follow-ups, timeline, and advanced tools.
- Make the evidence trail inspectable without forcing it into the main queue.
- Keep human-direction controls visible only when the selected/current attention item needs human input.
- Keep tools and memory/admin actions behind clearly secondary sections.
- Link every claim back to existing records where available.

Current component mapping:

- `PresenceLiveStatusPanel` and `HumanDirectionPanel` become two modes of the evidence panel shell.
- `TicketWorkspace` becomes the selected-ticket evidence body.
- `ToolsWorkspace` stays secondary and should eventually move to a repository tools drawer or tab inside the evidence panel.
- `PresenceStatusCallout`, `EvidenceCard`, timeline rendering, findings, review evidence, and handoff editors become subcomponents under the evidence panel boundary.

View-model inputs:

- selected `TicketRecord`
- selected ticket `AttemptSummary` rows
- selected ticket `TicketSummaryRecord`
- selected ticket `ProjectionHealthRecord`
- selected ticket findings
- selected ticket review artifacts
- selected ticket merge operations
- selected ticket proposed follow-ups
- policy decisions for approve/merge
- capability scan
- handoff editor local UI state

Command outputs:

- `presence.human-direction.submit`
- `presence.review.accept`
- `presence.review.request_changes`
- `presence.review.merge_approved`
- create/start attempt
- resolve/dismiss finding
- create/materialize follow-up
- save worker handoff
- create promotion candidate
- repository memory/tools commands

## View Model Rules

- View models may sort, group, label, and prioritize state for readability.
- View models must not mutate domain state.
- View models must not decide ticket lifecycle transitions.
- Server-owned fields win over client inference. Prefer `missionBriefing` and `ticketBriefings` when present.
- Fallback inference is allowed only for display continuity while older snapshots or missing briefing rows exist.
- Every "needs human" claim should carry a reason string and, where possible, a source record id.
- Every risky command should be represented as a `PresenceCommandDefinition` and executed through the command facade.

## First Refactor Tasks

Create these tasks after this decision:

1. **Extract Presence cockpit view model**
   Move status-line, counts, queued goal counts, supervisor run reason, and primary command labels out of `PresenceBriefingSurface`.

2. **Extract attention queue view model**
   Move `WorkQueueSurface` row ordering and row label derivation into pure helpers with tests.

3. **Extract evidence panel shell**
   Split `HumanDirectionPanel` and `PresenceLiveStatusPanel` into one evidence shell with mode-specific header/actions.

4. **Extract ticket evidence sections**
   Move findings, review evidence, handoff, timeline, policy gates, and advanced actions out of `TicketWorkspace` into smaller focused components.

5. **Move repository tools to secondary panel**
   Keep `ToolsWorkspace` accessible, but separate it from the default evidence flow so repo memory/admin controls do not dominate ordinary supervision.

## Compatibility

This direction keeps upstream interference modest:

- no server contract changes
- no new backend APIs
- no replacement of T3 Code routing or settings architecture
- mostly additive web-local helpers and component extraction
- current `BoardSnapshot` remains the UI source of truth

The likely conflict surface with upstream is limited to `apps/web/src/components/presence/*` and small web-local helper files.

## Consequences

Positive:

- Presence becomes easier to scan.
- The human sees attention first, then evidence on demand.
- The code gains testable view-model seams before the next UI pass.
- Command execution remains centralized.

Tradeoffs:

- This adds more web-local files and naming.
- The split must be implemented carefully to avoid just moving a giant component into three giant components.
- Some existing UI text and layout will move, which may cause medium-sized diffs in Presence-only files.

## Non-Goals

- Do not add repo-brain memory implementation in this milestone.
- Do not redesign server orchestration.
- Do not make the web UI decide supervisor policy.
- Do not add vector retrieval or memory promotion here.
- Do not create a separate ticket-only command bar.
