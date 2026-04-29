# 03: Resident Controller Stepper

## Goal

Replace long in-memory supervisor loops with a persisted stepper coordinated by the resident controller.

## Why

The current system has both a polling resident controller and a long supervisor runtime loop. This makes recovery, duplicate suppression, and user trust harder than necessary.

## Outcomes

- Controller ticks acquire durable board/run ownership.
- Each tick performs one bounded step.
- Supervisor state advances through persisted stages.
- Restarting the server resumes from persisted state.
- Paused boards stay paused.

## Backlog

- Persist controller tick ownership.
- Add one-step supervisor execution API.
- Move stable-run detection into the stepper.
- Replace `forkDetach` supervisor execution with queued/resumable work.
- Add crash/restart tests.

