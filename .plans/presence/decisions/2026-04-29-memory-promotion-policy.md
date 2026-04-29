# Decision: Memory Promotion Policy

Date: 2026-04-29
Status: Accepted
Milestone: 07-repo-brain

## Context

The repo-brain provenance decision defines how durable memory should be shaped: compiled truth plus append-only evidence, strict status labels, trust modes, confidence, and invalidation triggers.

This decision defines the promotion policy: when Presence may create a memory candidate, when that candidate may become durable compiled memory, and which memory is safe to load into supervisor briefings.

The policy exists because silent memory writes are dangerous. A worker, reviewer, or supervisor can notice something useful, but noticing is not the same as durable repo truth. Memory should be proposed from evidence, reviewed, scoped, and labeled before future agents rely on it.

## Decision

Presence may create repo-brain memory candidates from evidence-backed outputs, but it must not silently promote candidates to durable compiled truth.

Promotion requires an explicit review decision or a future deterministic policy that is at least as strict as this decision. Until such policy exists, durable compiled memory is created only through reviewed promotion.

Memory remains non-authoritative. Current orchestration state, tickets, attempts, reviews, findings, merge operations, and explicit human direction always win over repo-brain memory.

## Allowed Candidate Sources

Presence may propose memory candidates from these sources:

- explicit human direction that states a repo preference, decision, warning, or workflow
- accepted or edited promotion candidates from prior reviewed work
- reviewer artifacts that cite files, commands, tests, or changed behavior
- worker handoffs that include concrete changed files, commands/tests, completed work, or failed paths
- supervisor handoffs that summarize cross-ticket decisions or unresolved repository risks
- mission events that represent durable milestones, blocked paths, or verified outcomes
- findings and blockers that explain a repeatable risk or repo invariant
- merge operations or accepted attempts that establish what landed
- repository capability scans that identify commands, package managers, scripts, or validation surfaces

Candidate creation requires at least one durable source reference. A prose-only summary from one agent is not enough for a high-confidence fact candidate.

## Disallowed Candidate Sources

Presence must not create durable memory candidates from:

- transient chat text with no linked ticket, attempt, event, review, or human instruction
- streamed assistant tokens before the turn completes
- failed provider output that lacks a handoff, finding, or review artifact
- inferred implementation facts from a failed attempt
- stale or disputed memory retrieved from the repo brain
- raw command output without a summary and source command/test metadata
- UI-only display state
- speculative supervisor plans that have not been executed or reviewed

These inputs may appear in timeline evidence or debugging views, but they are not promotion candidates by themselves.

## Candidate Kinds

Candidate kind must be chosen before review:

- `fact`: current repo behavior, structure, command, file ownership, or implementation detail
- `decision`: accepted product, architecture, or process choice
- `workflow`: repeatable validation, review, release, setup, or recovery procedure
- `lesson`: bounded learning from an attempt, especially what worked or failed
- `risk`: known hazard, flaky path, integration issue, or source of drift

Failed attempts can produce `lesson` or `risk` candidates only. They cannot produce `fact` candidates unless a later reviewer or human validates the fact independently.

## Required Candidate Metadata

Every candidate must include:

- proposed title
- proposed body
- kind
- scope
- source evidence references
- confidence
- invalidation triggers
- created timestamp
- proposed by source: worker, reviewer, supervisor, human, or deterministic projection

Scope must be one of:

- repo-wide
- package
- directory
- file
- symbol
- ticket
- attempt
- historical-only

Candidates with broad scope need stronger evidence than narrow candidates. A failed attempt should normally be ticket, attempt, file, or historical-only scoped.

## Review Flow

Candidate review actions:

- **Accept as proposed**
  Promote the candidate into compiled memory without changing the claim.

- **Edit and accept**
  Promote a corrected version into compiled memory while preserving the original candidate and evidence timeline.

- **Reject**
  Mark the candidate rejected with a reason. Rejected candidates remain durable enough to avoid repeated proposals.

- **Mark disputed**
  Preserve the candidate as disputed evidence when the claim may be useful but is contradicted or uncertain.

- **Mark historical**
  Preserve the candidate as past context that should not be treated as current truth.

Review must record:

- reviewer identity when available
- decision action
- decision reason
- decision timestamp
- final scope
- final confidence
- final invalidation triggers

Edits create a reviewed compiled memory linked to the candidate. They must not mutate source evidence.

## Status Rules

Candidate lifecycle:

`candidate -> accepted | edited | rejected | disputed | historical`

Compiled memory lifecycle:

`accepted | edited -> stale | disputed | historical`

`rejected`, `disputed`, `stale`, and `historical` records are preserved for audit and inspection. They are excluded from default supervisor briefings.

Deletion is reserved for corruption, path repair, privacy/security removal, or explicit user request.

## Confidence Rules

Confidence is source-derived and review-adjusted.

- `low`: single-agent prose, inferred lesson, failed-attempt observation, or weak evidence
- `medium`: supported by concrete same-attempt evidence or reviewer note
- `high`: reviewed and supported by durable repo evidence, passing command/test, human direction, accepted review, or landed merge

A candidate cannot become high-confidence compiled memory from unreviewed worker or supervisor prose alone.

Reviewers may lower confidence when evidence is narrow, stale, or contradicted. They may raise confidence only when the supporting evidence justifies it.

## Trust Mode Policy

Repository trust mode controls reads and writes:

- `deny`
  Memory is not loaded into prompts. Presence does not create new candidates. Existing memory is visible only in admin/inspection surfaces.

- `read_only`
  Accepted, fresh memory may be read with labels and provenance. Presence does not create new candidates or compiled memory.

- `read_write`
  Presence may propose candidates. Durable compiled memory still requires review.

Changing from `read_write` to `read_only` or `deny` must prevent future writes immediately. It does not delete existing records.

## Supervisor Briefing Eligibility

Default supervisor briefings may load only `briefing_safe` memory.

A memory is `briefing_safe` when all of these are true:

- status is `accepted` or `edited`
- trust mode allows reading
- memory is not stale, disputed, rejected, or historical
- memory has source evidence references
- memory has scope and confidence labels
- invalidation triggers have not fired
- retrieval returns provenance citations with the memory

Candidates, rejected records, disputed records, stale records, and historical records may be shown in inspection surfaces or explicitly requested audits. They must not be injected as instructions or silent context.

Supervisor prompts must label retrieved memory as context, not authority. They must continue to prefer current board state for lifecycle, merge, blocker, and active attempt decisions.

## Invalidation Policy

Accepted or edited memory must be marked stale or disputed when new evidence invalidates or weakens it.

Invalidation triggers include:

- source file changed after memory creation
- proof command/test later failed
- proof command/test disappeared or changed meaning
- newer attempt superseded the source attempt
- newer review contradicted the memory
- finding or blocker opened for the same scope
- ticket was reopened, split, merged, corrected, or made obsolete
- human disputed or edited the memory
- source evidence became missing or undecodable
- contract, schema, migration, or protocol changed for contract-related memory
- manual expiry

Invalidation should prefer status changes over deletion. The timeline should record why the memory changed.

## Reproposal Policy

Presence should not repeatedly propose the same rejected or disputed memory.

A new candidate may be created only when one of these is true:

- new evidence materially changes the claim
- the scope is narrowed
- the kind changes from fact to lesson/risk or historical
- a human explicitly asks Presence to reconsider
- the original rejection reason has been addressed

The new candidate must link to the rejected or disputed predecessor.

## Examples

Allowed:

- A reviewer verifies that `bun fmt`, `bun lint`, and `bun typecheck` are required gates and links to `AGENTS.md`.
- A worker fails on Windows path handling, records the exact failing command, and proposes a narrowly scoped lesson.
- A human says this repository must avoid broad upstream conflicts, creating a repo-wide decision candidate.
- A capability scan discovers package scripts and proposes a workflow candidate with command provenance.

Not allowed:

- A worker says "this probably uses Vite" without file or package evidence and promotes it as fact.
- A failed attempt says an architecture is impossible and promotes that as repo truth.
- A stale memory retrieved from the repo brain becomes a new candidate without fresh evidence.
- A supervisor plan proposes a future refactor and records it as an accepted decision before execution or review.

## Implementation Consequences

The next code tasks should enforce this policy in this order:

1. schema definitions must represent candidate source, review action, status, confidence, trust mode, scope, and invalidation
2. projection code may create candidates, not compiled truth
3. review state must gate compiled memory
4. retrieval must filter by briefing eligibility by default
5. UI must make status, confidence, scope, and provenance visible
6. regression tests must prove memory cannot alter orchestration state

## Compatibility

This decision is documentation-only. It keeps upstream interference low:

- no code changes
- no prompt changes
- no server contract changes
- no UI changes
- repo-brain policy remains Presence-owned and additive

## Non-Goals

- Do not implement promotion APIs here.
- Do not add memory schemas here.
- Do not implement invalidation here.
- Do not load memory into prompts here.
- Do not introduce automatic promotion.
- Do not make memory an orchestration authority.
