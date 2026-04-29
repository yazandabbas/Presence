# PRES-023 Continuity Regression Scenarios

## Purpose

Presence should be judged by continuity under interruption, replay, stale state, and human correction. These scenarios define the externally observable behavior that must hold before Presence is treated as product-ready.

## Scenario 1: Restart During Worker Attempt

Setup:

- Import a repository with one Presence board.
- Create one ticket and one worker attempt.
- Start the worker session and record at least one worker handoff with changed files, tests run, next step, and no blockers.
- Stop and restart the server or reconstruct the Presence services before the supervisor sees the worker as complete.

Pass evidence:

- The board snapshot still contains the same ticket, attempt, workspace, worker thread id, latest worker handoff, and mission events after restart.
- Presence does not create a duplicate worker attempt or duplicate worker thread for the same active attempt.
- The next supervisor tick resumes from the saved handoff and either waits for the active thread, queues a bounded continuation, or starts review when the attempt is complete.
- Mission events show one coherent timeline with stable dedupe keys for replayed runtime events.

Fail evidence:

- A second active worker attempt is created for the same ticket without human direction.
- The latest worker handoff is missing or stale after restart.
- Replayed runtime/domain events create duplicate user-visible mission events.
- The supervisor starts over from old transcript context instead of saved board state.

## Scenario 2: Duplicate Review Retry

Setup:

- Put a ticket into review with a worker attempt and review thread.
- Trigger "Retry review with Codex" twice, including a fast double-click path and a delayed retry after the first retry thread starts.
- Repeat once through the supervisor path where the supervisor creates or retries a reviewer without a direct button click.

Pass evidence:

- Only one current review thread is active for the same ticket/attempt/retry scope.
- Stale retry threads are not treated as current review authority.
- Review artifacts and mission events reference the accepted current review thread only.
- The work queue does not show duplicate review work items for the same retry scope.

Fail evidence:

- Two review threads remain active for the same ticket and attempt after one retry action.
- A stale review thread produces a later result that overwrites the current review result.
- The dashboard shows duplicate reviewer rows or conflicting "latest meaningful update" entries for the same review retry.

## Scenario 3: Stale Memory Candidate Rejection

Setup:

- Seed a knowledge candidate or promotion candidate from a prior failed attempt.
- Create a newer ticket summary, finding, or supervisor handoff that contradicts the candidate.
- Ask Presence to resume or plan work that could use that memory.

Pass evidence:

- Presence either rejects the stale candidate or marks it as needing review before it can influence planning.
- The memory decision records provenance: source ticket/attempt, evidence, reviewer, and reason for rejection or deferral.
- The supervisor chooses current board state over stale memory when they conflict.

Fail evidence:

- The supervisor repeats a known failed path because a stale memory candidate was promoted unchecked.
- A memory item lacks source attempt/ticket provenance.
- A stale candidate is used without a mission event, review artifact, or promotion decision explaining why.

## Scenario 4: Provider Unavailable Blocker

Setup:

- Start a worker, reviewer, or supervisor session against a provider account/harness that is unavailable, unauthenticated, or disconnected.
- Let the provider emit runtime errors, session exit, realtime errors, or approval/user-input stalls.
- Restart the server and replay the same runtime events.

Pass evidence:

- Presence records one manual blocker for the unavailable provider condition.
- The ticket or run stops retrying blindly and asks for the specific human action needed, such as signing in, choosing another harness, or reconnecting.
- Replayed provider events do not create duplicate blockers.
- After the human fixes the provider and resumes, Presence continues from the durable board state instead of restarting the whole goal.

Fail evidence:

- Presence repeatedly starts new sessions against the same unavailable provider.
- The UI remains in "active" or "retrying projection" without a clear human action.
- Provider replay creates multiple identical blockers.

## Scenario 5: Goal Planning And Human Correction

Setup:

- Submit a vague human goal that can reasonably split into multiple tickets.
- Let Presence plan tickets immediately or through the resident controller.
- Give a correction such as "pause this ticket", "retry review", "start fresh", or "that split is wrong; make it one task."
- Restart before the next supervisor tick.

Pass evidence:

- The original goal intake, created tickets, human correction, and next supervisor handoff remain visible after restart.
- High-confidence plans create tickets without waiting for the resident controller tick, while ambiguous plans ask for clarification.
- Human correction changes the durable ticket/supervisor state instead of becoming a literal new ticket unless the user explicitly asked for a new ticket.
- The next supervisor run honors the correction before taking any new execution action.

Fail evidence:

- A control command such as pause, retry, or kill becomes a normal work ticket.
- The old plan continues after the user corrected it.
- Restart loses the correction or creates another ticket split for the same goal.

## Release Gate

Presence is not release-ready until each scenario has either an automated regression test or a repeatable manual smoke script with recorded pass/fail evidence. The minimum release bar is no duplicate active work, no silent stalls, no stale review authority, and no promoted memory without provenance.
