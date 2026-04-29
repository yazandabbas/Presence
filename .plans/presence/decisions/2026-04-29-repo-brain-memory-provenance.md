# Decision: Repo Brain Memory Provenance

Date: 2026-04-29
Status: Accepted
Milestone: 07-repo-brain

## Context

Presence needs continuity across supervisor, worker, reviewer, and future resumed sessions. That continuity cannot depend on a single chat context window, and it cannot be a loose summary that later agents treat as truth.

The research pass across GBrain/GStack, OpenHands, LangGraph, Cline, Continue, AutoGen, CrewAI, CodexMonitor, and recent long-horizon memory papers points to the same architecture:

- keep raw execution history as append-only evidence
- maintain compact current state for fast resume
- promote only reviewed claims into durable memory
- keep human-readable knowledge as the source of truth
- treat retrieval indexes as secondary projections
- label stale, disputed, inferred, and historical memory so agents do not over-trust it

The strongest compatible pattern for Presence is "compiled truth plus append-only timeline." A repo-brain page may show the current reviewed belief, but every belief must link back to evidence. Memory can inform planning; it must not decide orchestration state.

## Decision

Use a two-layer provenance model for repo-brain memory:

1. **Compiled Memory**
   The current reviewed statement Presence may use as repo context. It is human-readable, scoped, statused, confidence-labeled, and linked to evidence.

2. **Timeline Evidence**
   Append-only evidence entries that explain where the memory came from, how it changed, why it was rejected, or why it became stale.

Memory is a projection from existing Presence evidence. The canonical sources remain `BoardSnapshot`, mission events, tickets, attempts, handoffs, findings, review artifacts, merge operations, provider events, file changes, commands, tests, and explicit human direction.

## Memory Types

Compiled memory records should use explicit kinds:

- `fact`: current repo behavior or structure, supported by source evidence
- `decision`: accepted architectural or product decision
- `workflow`: recurring command, validation, release, or review procedure
- `lesson`: a bounded learning from a failed or successful attempt
- `risk`: known hazard, flaky path, integration risk, or operational warning

Evidence records should use explicit roles:

- `supports`: evidence supporting the compiled memory
- `contradicts`: evidence that disputes or weakens the memory
- `supersedes`: evidence that replaces an older memory
- `context`: related evidence that should not be treated as proof

Failed attempts may produce `lesson` or `risk` candidates, but they must not produce current implementation `fact` records unless a later review validates the claim independently.

## Status Model

Memory and candidates use these statuses:

- `candidate`: proposed by Presence, not durable truth
- `accepted`: reviewed and available for normal repo-brain retrieval
- `edited`: accepted after human or reviewer edits
- `rejected`: reviewed and intentionally not promoted
- `stale`: previously accepted, but invalidated by newer evidence
- `disputed`: contradicted or challenged and excluded from default briefings
- `historical`: useful as past context, not current truth

Allowed candidate flow:

`candidate -> accepted | edited | rejected | disputed | historical`

Accepted memory may later become:

`accepted | edited -> stale | disputed | historical`

Rejections stay durable enough to prevent Presence from repeatedly proposing the same unsupported memory.

## Provenance Metadata

Every compiled memory record must include:

- stable memory id
- repository id
- kind
- title
- human-readable body
- scope: repo-wide, package, directory, file, symbol, ticket, or historical-only
- status
- confidence
- trust mode at time of use
- source evidence ids
- created timestamp
- updated timestamp
- reviewed timestamp when accepted, edited, rejected, or disputed
- invalidation triggers

Every evidence entry must include at least one durable source reference. Supported references:

- source ticket id
- source attempt id
- mission event id
- review artifact id
- promotion candidate id
- handoff id when available
- finding id when available
- merge operation id when available
- file path
- command or test name
- commit sha when available
- provider thread/session id when relevant
- timestamp observed
- summary
- evidence role
- confidence

Attempt-derived memory should include ticket id and attempt id. Review-derived memory should include review artifact id. File-specific memory should include file path. Command or validation memory should include command/test name and observed result.

## Confidence

Confidence is advisory and source-derived, not a permission to act.

- `low`: single-agent prose, inferred summary, unverified observation, failed-attempt lesson
- `medium`: supported by same-attempt evidence or review notes but not independently verified
- `high`: human-reviewed, supported by passing validation, review artifact, or durable repo evidence

Evidence confidence and compiled memory confidence are separate. A compiled record can only be high confidence when its supporting evidence is high quality and recent enough for its scope.

## Trust Modes

Trust mode is configured per repository and may later become namespace-scoped.

- `deny`: memory is not loaded into prompts and Presence cannot write new memory candidates. Existing memory may remain visible in admin inspection.
- `read_only`: accepted, fresh memory may be read with labels and provenance. Presence cannot write candidates or compiled truth.
- `read_write`: Presence may propose candidates. Durable compiled truth still requires explicit review or policy approval.

For supervisor briefings, use a stricter derived mode:

- `briefing_safe`: only accepted or edited, fresh, non-disputed compiled memory with provenance may enter default supervisor context.

Candidate, disputed, stale, rejected, and historical records may be shown as labeled evidence in inspection surfaces, but they must not be injected as instructions.

## Invalidation

Each memory must define invalidation triggers with a target and reason. Initial trigger types:

- `file_changed`: a source or scoped file changed after the memory timestamp
- `command_failed`: a command/test used as proof later failed
- `command_removed`: a command/test used as proof disappeared or was replaced
- `newer_attempt`: a newer attempt superseded the source attempt
- `newer_review`: a newer review contradicted or weakened the memory
- `finding_opened`: a blocker or finding appeared for the same ticket, attempt, file, or behavior
- `ticket_rescoped`: a ticket was reopened, split, merged, corrected, or marked obsolete
- `human_dispute`: a human challenged, edited, or rejected the memory
- `source_missing`: the source evidence can no longer be decoded or resolved
- `contract_changed`: schema, migration, protocol, or contract files changed for contract-related memory
- `manual_expiry`: a human or policy marked the memory expired

Invalidation should first mark memory `stale` or `disputed`; deletion is not the normal path. The timeline should preserve why the memory changed.

## Compiled Truth Rendering

Repo-brain pages should render:

1. Front matter with id, kind, scope, status, confidence, trust mode, timestamps, and invalidation rules.
2. Compiled truth: the current reviewed body.
3. Evidence timeline: append-only entries with source links, support role, timestamp, and summary.

The compiled truth section may be rewritten by review. Timeline evidence is append-only except for mechanical repair of broken links. Contradictory evidence must remain visible and must not be hidden by the compiled summary.

Markdown pages are the human-readable source of truth. Database rows, FTS indexes, graph links, and future vector indexes are retrieval projections over those pages and source events.

## Supervisor Rules

- Current orchestration state always wins over memory.
- Memory may inform planning, not decide ticket lifecycle, review authority, merge readiness, blocker status, active attempt identity, or approval policy.
- Default supervisor briefings may load only `briefing_safe` memory.
- Failed-attempt lessons must be labeled as lessons or risks, scoped narrowly, and excluded from current implementation facts.
- Every retrieved memory shown to an agent must carry status, confidence, scope, and provenance citations.

## Promotion Candidate Review

Promotion candidates should show:

- proposed claim
- proposed kind and scope
- source evidence
- affected files
- commands/tests used as proof
- confidence
- invalidation triggers
- reviewer identity when available
- decision reason
- decision timestamp

Review actions:

- accept as proposed
- edit and accept
- reject with reason
- mark disputed
- mark historical-only

Edits create a reviewed compiled memory linked to the candidate. They must not silently mutate raw evidence.

## First Implementation Tasks

Create or advance these tasks after this decision:

1. `PRES-022`: Memory Promotion Policy
2. `PRES-031`: Add Repo-Brain Memory Schemas
3. `PRES-032`: Add Memory Projection Read Model
4. `PRES-033`: Implement Promotion Candidate Review State
5. `PRES-034`: Add Git-Backed Markdown Repo-Brain Projection
6. `PRES-035`: Add Structured Repo-Brain Retrieval
7. `PRES-036`: Add Repo-Brain UI Inspection Panel
8. `PRES-037`: Add Repo-Brain End-To-End Regression Tests

## Compatibility

This design keeps upstream interference low:

- no runtime changes in this decision
- no schema changes in this decision
- no UI changes in this decision
- no replacement of Codex app-server or T3 Code orchestration
- repo-brain memory remains Presence-owned and additive
- retrieval projects from Presence evidence instead of rewriting orchestration flow

## Consequences

Positive:

- Presence memory becomes auditable and inspectable.
- Future agents can inherit continuity without trusting chat summaries.
- Stale or contradicted memory has a defined lifecycle.
- Human-readable repo-brain pages can become durable team assets.
- Retrieval can cite sources instead of laundering weak claims.

Tradeoffs:

- The model is more explicit than a single memory table.
- Promotion and invalidation require careful UI and policy work.
- The first implementation should move slowly because bad memory infrastructure is worse than none.

## Non-Goals

- Do not implement schemas in this decision.
- Do not write markdown repo-brain pages in this decision.
- Do not inject memory into supervisor prompts yet.
- Do not add vector search yet.
- Do not allow silent durable memory writes.
- Do not make memory the orchestration source of truth.
