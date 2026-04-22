import {
  AttemptId,
  BoardId,
  type AttemptRecord,
  type BoardSnapshot,
  type FindingRecord,
  type ModelSelection,
  type PresenceCancelSupervisorRunInput,
  type PresenceReviewDecisionKind,
  type PresenceRpcError,
  type PresenceStartSupervisorRunInput,
  type ReviewArtifactRecord,
  type ReviewChecklistAssessmentItem,
  type ReviewDecisionRecord,
  type ReviewEvidenceItem,
  type TicketSummaryRecord,
  TicketId,
  SupervisorRunId,
  type SupervisorRunRecord,
  type ValidationRunRecord,
  type WorkerHandoffRecord,
} from "@t3tools/contracts";
import { Effect } from "effect";
import type { SqlClient } from "effect/unstable/sql/SqlClient";

import type { PresenceControlPlaneShape } from "../../Services/PresenceControlPlane.ts";
import type {
  AttemptWorkspaceContextRow,
  PresenceCreateOrUpdateFindingInput,
  PresenceEnsurePromotionCandidateInput,
  ParsedPresenceReviewResult,
  PresenceReviewDecisionApplicationInput,
  PresenceThreadReadModel,
} from "./PresenceInternalDeps.ts";

type PresenceSupervisorRuntime = Pick<
  PresenceControlPlaneShape,
  "startSupervisorRun" | "cancelSupervisorRun"
> & {
  executeSupervisorRun: (runId: string) => Effect.Effect<void, unknown, never>;
};

type MakePresenceSupervisorRuntimeDeps = Readonly<{
  getBoardSnapshotInternal: (
    boardId: string,
  ) => Effect.Effect<
    {
      tickets: ReadonlyArray<{ id: string; title: string; status: string }>;
      goalIntakes: ReadonlyArray<{ id: string; createdTicketIds: ReadonlyArray<string> }>;
    } & Pick<
      BoardSnapshot,
      | "attempts"
      | "findings"
      | "validationRuns"
      | "ticketSummaries"
      | "reviewArtifacts"
      | "boardProjectionHealth"
      | "ticketProjectionHealth"
    >,
    unknown,
    never
  >;
  readLatestSupervisorRunForBoard: (
    boardId: string,
  ) => Effect.Effect<SupervisorRunRecord | null, unknown, never>;
  readSupervisorRunById: (
    runId: string,
  ) => Effect.Effect<SupervisorRunRecord | null, unknown, never>;
  persistSupervisorRun: (input: {
    runId: string;
    boardId: string;
    sourceGoalIntakeId: string | null;
    scopeTicketIds: ReadonlyArray<string>;
    status: SupervisorRunRecord["status"];
    stage: SupervisorRunRecord["stage"];
    currentTicketId: string | null;
    activeThreadIds: ReadonlyArray<string>;
    summary: string;
    createdAt: string;
  }) => Effect.Effect<SupervisorRunRecord, unknown, never>;
  saveSupervisorHandoff: PresenceControlPlaneShape["saveSupervisorHandoff"];
  normalizeIdList: (values: ReadonlyArray<string>) => ReadonlyArray<string>;
  nowIso: () => string;
  makeId: <T extends { make: (value: string) => unknown }>(
    schema: T,
    prefix: string,
  ) => ReturnType<T["make"]>;
  isSqliteUniqueConstraintError: (error: unknown) => boolean;
  presenceError: (message: string, cause?: unknown) => PresenceRpcError;
  projectionIsRepairEligible: (
    health: BoardSnapshot["boardProjectionHealth"] | BoardSnapshot["ticketProjectionHealth"][number] | null,
  ) => boolean;
  runProjectionWorker: () => Effect.Effect<void, unknown, never>;
  createAttempt: PresenceControlPlaneShape["createAttempt"];
  readAttemptWorkspaceContext: (
    attemptId: string,
  ) => Effect.Effect<AttemptWorkspaceContextRow | null, unknown, never>;
  startAttemptSession: PresenceControlPlaneShape["startAttemptSession"];
  readThreadFromModel: (
    threadId: string,
  ) => Effect.Effect<(PresenceThreadReadModel & { id: string }) | null, unknown, never>;
  isThreadSettled: (thread: PresenceThreadReadModel | null) => boolean;
  synthesizeWorkerHandoffFromThread: (
    attemptId: string,
    options?: { allowRunning?: boolean },
  ) => Effect.Effect<WorkerHandoffRecord | null, unknown, never>;
  syncTicketProjectionBestEffort: (
    ticketId: string,
    dirtyReason: string,
  ) => Effect.Effect<void, unknown, never>;
  readLatestWorkerHandoffForAttempt: (
    attemptId: string,
  ) => Effect.Effect<WorkerHandoffRecord | null, unknown, never>;
  readValidationRunsForAttempt: (
    attemptId: string,
  ) => Effect.Effect<ReadonlyArray<ValidationRunRecord>, unknown, never>;
  runAttemptValidation: PresenceControlPlaneShape["runAttemptValidation"];
  uniqueStrings: (values: ReadonlyArray<string>) => ReadonlyArray<string>;
  saveWorkerHandoff: PresenceControlPlaneShape["saveWorkerHandoff"];
  createOrUpdateFinding: (
    input: PresenceCreateOrUpdateFindingInput,
  ) => Effect.Effect<FindingRecord, unknown, never>;
  sql: SqlClient;
  resolveModelSelectionForAttempt: (
    context: AttemptWorkspaceContextRow,
  ) => Effect.Effect<ModelSelection, unknown, never>;
  queueTurnStart: (input: {
    threadId: string;
    titleSeed: string;
    selection: ModelSelection;
    text: string;
  }) => Effect.Effect<void, unknown, never>;
  buildWorkerContinuationPrompt: (input: {
    ticketTitle: string;
    reason: string;
    handoff: WorkerHandoffRecord | null;
  }) => string;
  startReviewSession: (input: {
    attempt: AttemptWorkspaceContextRow;
    ticketSummary: TicketSummaryRecord | null;
    workerHandoff: WorkerHandoffRecord | null;
    validationRuns: ReadonlyArray<ValidationRunRecord>;
    findings: ReadonlyArray<FindingRecord>;
    priorReviewArtifacts: ReadonlyArray<ReviewArtifactRecord>;
    supervisorNote: string;
  }) => Effect.Effect<string, PresenceRpcError, never>;
  addMillisecondsIso: (value: string, amount: number) => string;
  reviewThreadTimeoutMs: number;
  readLatestReviewResultFromThread: (
    thread: PresenceThreadReadModel | null,
  ) => Effect.Effect<ParsedPresenceReviewResult | null, unknown, never>;
  blockTicketForReviewFailure: (input: {
    ticketId: string;
    attemptId: string;
    reviewThreadId: string | null;
    summary: string;
    rationale: string;
  }) => Effect.Effect<FindingRecord, PresenceRpcError, never>;
  applyReviewDecisionInternal: (
    input: PresenceReviewDecisionApplicationInput,
  ) => Effect.Effect<ReviewDecisionRecord, PresenceRpcError, never>;
  reviewResultSupportsMechanismChecklist: (
    parsedReviewResult: ParsedPresenceReviewResult,
    workerHandoff: WorkerHandoffRecord | null,
  ) => boolean;
  ensurePromotionCandidateForAcceptedAttempt: (
    input: PresenceEnsurePromotionCandidateInput,
  ) => Effect.Effect<void, PresenceRpcError, never>;
}>;

const getLatestValidationBatch = (runs: ReadonlyArray<ValidationRunRecord>) => {
  const batchId = runs[0]?.batchId ?? null;
  if (!batchId) {
    return [] as ValidationRunRecord[];
  }
  return runs.filter((run) => run.batchId === batchId);
};

const isValidationBatchPassing = (runs: ReadonlyArray<ValidationRunRecord>) =>
  runs.length > 0 && runs.every((run) => run.status === "passed");

const isScopedSupervisorTicketStable = (ticket: { status: string }) =>
  ticket.status === "ready_to_merge" || ticket.status === "done" || ticket.status === "blocked";

const describeStableScopeOutcome = (scopedTickets: ReadonlyArray<{ status: string }>) =>
  scopedTickets.some((ticket) => ticket.status === "blocked")
    ? {
        recentDecision: "Supervisor run reached a stable state with blocked tickets.",
        nextBoardActions: [
          "Inspect blocked tickets or provide new goals before starting another supervisor run.",
        ],
      }
    : scopedTickets.some((ticket) => ticket.status === "ready_to_merge")
      ? {
          recentDecision: "Supervisor run reached a stable state and is waiting for merge approval.",
          nextBoardActions: ["Wait for human merge approval or new goals."],
        }
      : {
          recentDecision: "Supervisor run reached a stable completed state.",
          nextBoardActions: ["No further supervisor action is needed right now."],
        };

const makePresenceSupervisorRuntime = (
  deps: MakePresenceSupervisorRuntimeDeps,
): PresenceSupervisorRuntime => {
  const saveTerminalSupervisorHandoff = (input: {
    boardId: string;
    scopeTicketIds: ReadonlyArray<string>;
    recentDecision: string;
    nextBoardActions: ReadonlyArray<string>;
  }) =>
    Effect.gen(function* () {
      const snapshot = yield* deps.getBoardSnapshotInternal(input.boardId);
      const scopedTickets = snapshot.tickets.filter((ticket) =>
        input.scopeTicketIds.some((scopeTicketId: string) => scopeTicketId === ticket.id),
      );
      const activeAttemptIds = snapshot.attempts
        .filter((attempt) =>
          scopedTickets.some((ticket) => ticket.id === attempt.ticketId) &&
          attempt.status !== "accepted" &&
          attempt.status !== "merged" &&
          attempt.status !== "rejected",
        )
        .map((attempt) => AttemptId.make(attempt.id));
      const blockedTicketIds = scopedTickets
        .filter((ticket) => ticket.status === "blocked")
        .map((ticket) => TicketId.make(ticket.id));
      yield* deps.saveSupervisorHandoff({
        boardId: BoardId.make(input.boardId),
        topPriorities: scopedTickets.map((ticket) => ticket.title).slice(0, 3),
        activeAttemptIds,
        blockedTicketIds,
        recentDecisions: [input.recentDecision],
        nextBoardActions: [...input.nextBoardActions],
        currentRunId: null,
        stage: null,
      });
    });

  const persistSupervisorRunAfterStateChange = (input: {
    run: SupervisorRunRecord;
    stage: SupervisorRunRecord["stage"];
    currentTicketId: string | null;
    activeThreadIds: ReadonlyArray<string>;
    summary: string;
  }) =>
    Effect.gen(function* () {
      const snapshot = yield* deps.getBoardSnapshotInternal(input.run.boardId);
      const scopedTickets = snapshot.tickets.filter((ticket) =>
        input.run.scopeTicketIds.some((scopeTicketId) => scopeTicketId === ticket.id),
      );
      if (scopedTickets.every(isScopedSupervisorTicketStable)) {
        const stableOutcome = describeStableScopeOutcome(scopedTickets);
        yield* saveTerminalSupervisorHandoff({
          boardId: input.run.boardId,
          scopeTicketIds: input.run.scopeTicketIds,
          recentDecision: stableOutcome.recentDecision,
          nextBoardActions: stableOutcome.nextBoardActions,
        });
        return yield* deps.persistSupervisorRun({
          runId: input.run.id,
          boardId: input.run.boardId,
          sourceGoalIntakeId: input.run.sourceGoalIntakeId,
          scopeTicketIds: input.run.scopeTicketIds,
          status: "completed",
          stage: "stable",
          currentTicketId: null,
          activeThreadIds: [],
          summary: input.summary,
          createdAt: input.run.createdAt,
        });
      }
      return yield* deps.persistSupervisorRun({
        runId: input.run.id,
        boardId: input.run.boardId,
        sourceGoalIntakeId: input.run.sourceGoalIntakeId,
        scopeTicketIds: input.run.scopeTicketIds,
        status: "running",
        stage: input.stage,
        currentTicketId: input.currentTicketId,
        activeThreadIds: input.activeThreadIds,
        summary: input.summary,
        createdAt: input.run.createdAt,
      });
    });

  const executeSupervisorRun: PresenceSupervisorRuntime["executeSupervisorRun"] = (runId) =>
    Effect.gen(function* () {
      const startedAt = Date.now();
      let steps = 0;
      while (steps < 200 && Date.now() - startedAt < 30 * 60_000) {
        steps += 1;
        const run = yield* deps.readSupervisorRunById(runId);
        if (!run || run.status === "cancelled") {
          return;
        }

        const snapshot = yield* deps.getBoardSnapshotInternal(run.boardId);
        if (
          snapshot.boardProjectionHealth &&
          deps.projectionIsRepairEligible(snapshot.boardProjectionHealth)
        ) {
          yield* deps.runProjectionWorker().pipe(Effect.forkDetach, Effect.asVoid);
        }
        for (const health of snapshot.ticketProjectionHealth.filter((health) =>
          run.scopeTicketIds.some((ticketId: string) => ticketId === health.scopeId),
        )) {
          if (deps.projectionIsRepairEligible(health)) {
            yield* deps.runProjectionWorker().pipe(Effect.forkDetach, Effect.asVoid);
            break;
          }
        }
        const scopedTickets = snapshot.tickets.filter((ticket) =>
          run.scopeTicketIds.some((scopeTicketId: string) => scopeTicketId === ticket.id),
        );
        const stable = scopedTickets.every(isScopedSupervisorTicketStable);
        const activeAttemptIds = snapshot.attempts
          .filter((attempt) =>
            scopedTickets.some((ticket) => ticket.id === attempt.ticketId) &&
            attempt.status !== "accepted" &&
            attempt.status !== "merged" &&
            attempt.status !== "rejected",
          )
          .map((attempt) => attempt.id);
        const blockedTicketIds = scopedTickets
          .filter((ticket) => ticket.status === "blocked")
          .map((ticket) => ticket.id);

        if (stable) {
          const stableOutcome = describeStableScopeOutcome(scopedTickets);
          yield* saveTerminalSupervisorHandoff({
            boardId: run.boardId,
            scopeTicketIds: run.scopeTicketIds,
            recentDecision: stableOutcome.recentDecision,
            nextBoardActions: stableOutcome.nextBoardActions,
          });
          yield* deps.persistSupervisorRun({
            runId,
            boardId: run.boardId,
            sourceGoalIntakeId: run.sourceGoalIntakeId,
            scopeTicketIds: run.scopeTicketIds,
            status: "completed",
            stage: "stable",
            currentTicketId: null,
            activeThreadIds: [],
            summary: "Scoped tickets reached ready-to-merge, done, or blocked.",
            createdAt: run.createdAt,
          });
          return;
        }

        const actionableTickets = scopedTickets.filter(
          (ticket) =>
            ticket.status === "todo" ||
            ticket.status === "in_progress" ||
            ticket.status === "in_review",
        );

        yield* deps.saveSupervisorHandoff({
            boardId: BoardId.make(run.boardId),
          topPriorities: actionableTickets.map((ticket) => ticket.title).slice(0, 3),
          activeAttemptIds: activeAttemptIds.map((attemptId) => AttemptId.make(attemptId)),
          blockedTicketIds: blockedTicketIds.map((ticketId) => TicketId.make(ticketId)),
          recentDecisions: [`Supervisor loop step ${steps} is evaluating scoped tickets.`],
          nextBoardActions: ["Create attempts, run validation, then review."],
          currentRunId: run.id,
          stage: run.stage,
        });

        let progressed = false;

        for (const ticket of actionableTickets.slice(0, 2)) {
          const attemptsForTicket = snapshot.attempts
            .filter((attempt) => attempt.ticketId === ticket.id)
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
          let activeAttempt =
            attemptsForTicket.find(
              (attempt) =>
                attempt.status === "in_progress" ||
                attempt.status === "in_review" ||
                attempt.status === "planned",
            ) ?? null;

          if (!activeAttempt) {
            activeAttempt = yield* deps.createAttempt({ ticketId: TicketId.make(ticket.id) });
            yield* deps.persistSupervisorRun({
              runId,
              boardId: run.boardId,
              sourceGoalIntakeId: run.sourceGoalIntakeId,
              scopeTicketIds: run.scopeTicketIds,
              status: "running",
              stage: "waiting_on_worker",
              currentTicketId: ticket.id,
              activeThreadIds: [],
              summary: `Created attempt ${activeAttempt.id} for ${ticket.title}.`,
              createdAt: run.createdAt,
            });
            progressed = true;
          }

          const attemptContext = yield* deps.readAttemptWorkspaceContext(activeAttempt.id);
          if (!attemptContext) {
            continue;
          }

          if (!attemptContext.attemptThreadId) {
            const session = yield* deps.startAttemptSession({ attemptId: activeAttempt.id });
            yield* deps.persistSupervisorRun({
              runId,
              boardId: run.boardId,
              sourceGoalIntakeId: run.sourceGoalIntakeId,
              scopeTicketIds: run.scopeTicketIds,
              status: "running",
              stage: "waiting_on_worker",
              currentTicketId: ticket.id,
              activeThreadIds: [session.threadId],
              summary: `Started worker session for ${ticket.title}.`,
              createdAt: run.createdAt,
            });
            progressed = true;
            continue;
          }

          const thread = yield* deps.readThreadFromModel(attemptContext.attemptThreadId);
          if (!thread) {
            const recoveredSession = yield* deps.startAttemptSession({ attemptId: activeAttempt.id });
            yield* deps.persistSupervisorRun({
              runId,
              boardId: run.boardId,
              sourceGoalIntakeId: run.sourceGoalIntakeId,
              scopeTicketIds: run.scopeTicketIds,
              status: "running",
              stage: "waiting_on_worker",
              currentTicketId: ticket.id,
              activeThreadIds: [recoveredSession.threadId],
              summary: `Recovered the worker session for ${ticket.title} after the previous thread became unavailable.`,
              createdAt: run.createdAt,
            });
            progressed = true;
            continue;
          }

          if (!deps.isThreadSettled(thread) && thread?.latestTurn) {
            yield* deps.synthesizeWorkerHandoffFromThread(activeAttempt.id, { allowRunning: true });
            yield* deps.syncTicketProjectionBestEffort(
              ticket.id,
              "Supervisor runtime updated ticket state while creating or reusing an attempt.",
            );
            yield* deps.persistSupervisorRun({
              runId,
              boardId: run.boardId,
              sourceGoalIntakeId: run.sourceGoalIntakeId,
              scopeTicketIds: run.scopeTicketIds,
              status: "running",
              stage: "waiting_on_worker",
              currentTicketId: ticket.id,
              activeThreadIds: [attemptContext.attemptThreadId],
              summary: `Waiting for the active worker turn on ${ticket.title} to settle.`,
              createdAt: run.createdAt,
            });
            continue;
          }

          const synthesizedHandoff = yield* deps.synthesizeWorkerHandoffFromThread(activeAttempt.id);
          const latestWorkerHandoff =
            synthesizedHandoff ??
            (yield* deps.readLatestWorkerHandoffForAttempt(activeAttempt.id));

          if (!latestWorkerHandoff && !thread.latestTurn) {
            const recoveredSession = yield* deps.startAttemptSession({ attemptId: activeAttempt.id });
            yield* deps.persistSupervisorRun({
              runId,
              boardId: run.boardId,
              sourceGoalIntakeId: run.sourceGoalIntakeId,
              scopeTicketIds: run.scopeTicketIds,
              status: "running",
              stage: "waiting_on_worker",
              currentTicketId: ticket.id,
              activeThreadIds: [recoveredSession.threadId],
              summary: `Restarted the worker kickoff for ${ticket.title} because the claimed thread had no active turn yet.`,
              createdAt: run.createdAt,
            });
            progressed = true;
            continue;
          }

          if (!latestWorkerHandoff && !deps.isThreadSettled(thread)) {
            yield* deps.persistSupervisorRun({
              runId,
              boardId: run.boardId,
              sourceGoalIntakeId: run.sourceGoalIntakeId,
              scopeTicketIds: run.scopeTicketIds,
              status: "running",
              stage: "waiting_on_worker",
              currentTicketId: ticket.id,
              activeThreadIds: [attemptContext.attemptThreadId],
              summary: `Waiting for worker output on ${ticket.title}.`,
              createdAt: run.createdAt,
            });
            continue;
          }

          const validationRuns = yield* deps.readValidationRunsForAttempt(activeAttempt.id);
          const latestValidationBatch = getLatestValidationBatch(validationRuns);
          if (!isValidationBatchPassing(latestValidationBatch)) {
            const runs = yield* deps.runAttemptValidation({ attemptId: activeAttempt.id });
            const batch = getLatestValidationBatch(runs);
            progressed = true;
            if (!isValidationBatchPassing(batch)) {
              const retryCount = (latestWorkerHandoff?.retryCount ?? 0) + 1;
              const updatedHandoff = yield* deps.saveWorkerHandoff({
                attemptId: activeAttempt.id,
                completedWork:
                  latestWorkerHandoff?.completedWork ?? [
                    "Validation exposed a failure that needs another worker pass.",
                  ],
                currentHypothesis: latestWorkerHandoff?.currentHypothesis ?? null,
                changedFiles: latestWorkerHandoff?.changedFiles ?? [],
                testsRun: deps.uniqueStrings([
                  ...(latestWorkerHandoff?.testsRun ?? []),
                  ...batch.map((run) => run.command),
                ]),
                blockers:
                  retryCount >= 3
                    ? deps.uniqueStrings([
                        ...(latestWorkerHandoff?.blockers ?? []),
                        "Repeated similar validation failures reached the retry threshold.",
                      ])
                    : (latestWorkerHandoff?.blockers ?? []),
                nextStep:
                  retryCount >= 3
                    ? "Escalate or propose follow-up work before another ordinary retry."
                    : "Address the failed validation commands and continue the same attempt.",
                openQuestions: latestWorkerHandoff?.openQuestions ?? [],
                retryCount,
                reasoningSource: latestWorkerHandoff?.reasoningSource ?? null,
                reasoningUpdatedAt: latestWorkerHandoff?.reasoningUpdatedAt ?? null,
                confidence: latestWorkerHandoff?.confidence ?? 0.62,
                evidenceIds: latestWorkerHandoff?.evidenceIds ?? [],
              });

              if (retryCount >= 3) {
                yield* deps.createOrUpdateFinding({
                  ticketId: ticket.id,
                  attemptId: activeAttempt.id,
                  source: "supervisor",
                  severity: "blocking",
                  disposition: "escalate",
                  summary:
                    "Supervisor blocked another ordinary retry after repeated similar failures.",
                  rationale:
                    "GLM-style loop breaking triggered after three materially similar failed validation/review cycles.",
                });
                yield* deps.sql`
                  UPDATE presence_tickets
                  SET status = ${"blocked"}, updated_at = ${deps.nowIso()}
                  WHERE ticket_id = ${ticket.id}
                `;
                yield* persistSupervisorRunAfterStateChange({
                  run,
                  stage: "stable",
                  currentTicketId: ticket.id,
                  activeThreadIds: [],
                  summary: `Blocked ${ticket.title} after repeated similar failures.`,
                });
                continue;
              }

              const selection = yield* deps.resolveModelSelectionForAttempt(attemptContext);
              yield* deps.queueTurnStart({
                threadId: attemptContext.attemptThreadId,
                titleSeed: attemptContext.ticketTitle,
                selection,
                text: deps.buildWorkerContinuationPrompt({
                  ticketTitle: attemptContext.ticketTitle,
                  reason: `Validation failed for this attempt. Retry count is now ${updatedHandoff.retryCount}. Fix the failure without repeating the same approach blindly.`,
                  handoff: updatedHandoff,
                }),
              });
              yield* deps.persistSupervisorRun({
                runId,
                boardId: run.boardId,
                sourceGoalIntakeId: run.sourceGoalIntakeId,
                scopeTicketIds: run.scopeTicketIds,
                status: "running",
                stage: "waiting_on_worker",
                currentTicketId: ticket.id,
                activeThreadIds: [attemptContext.attemptThreadId],
                summary: `Validation failed for ${ticket.title}; worker continuation queued.`,
                createdAt: run.createdAt,
              });
              continue;
            }
          }

          const ticketSnapshot = yield* deps.getBoardSnapshotInternal(run.boardId);
          const openFindings = ticketSnapshot.findings.filter(
            (finding) =>
              finding.ticketId === ticket.id &&
              finding.status === "open" &&
              (finding.attemptId === null || finding.attemptId === activeAttempt.id),
          );
          const latestBatch = getLatestValidationBatch(
            ticketSnapshot.validationRuns.filter((runItem) => runItem.attemptId === activeAttempt.id),
          );
          const ticketSummary =
            ticketSnapshot.ticketSummaries.find((summary) => summary.ticketId === ticket.id) ?? null;
          const priorReviewArtifacts = ticketSnapshot.reviewArtifacts.filter(
            (artifact) => artifact.attemptId === activeAttempt.id,
          );

          let reviewThreadId: string | null =
            run.stage === "waiting_on_review" && run.currentTicketId === ticket.id
              ? (run.activeThreadIds[0] ?? null)
              : null;

          if (!reviewThreadId) {
            const startedReviewThreadId = yield* deps.startReviewSession({
              attempt: attemptContext,
              ticketSummary,
              workerHandoff: latestWorkerHandoff,
              validationRuns: latestBatch,
              findings: openFindings,
              priorReviewArtifacts,
              supervisorNote: "Review this attempt after validation recorded a passing batch.",
            });
            reviewThreadId = startedReviewThreadId;
            yield* deps.persistSupervisorRun({
              runId,
              boardId: run.boardId,
              sourceGoalIntakeId: run.sourceGoalIntakeId,
              scopeTicketIds: run.scopeTicketIds,
              status: "running",
              stage: "waiting_on_review",
              currentTicketId: ticket.id,
              activeThreadIds: [startedReviewThreadId],
              summary: `Started review for ${ticket.title}.`,
              createdAt: run.createdAt,
            });
            progressed = true;
            continue;
          }

          const reviewThread = yield* deps.readThreadFromModel(reviewThreadId);
          if (!reviewThread) {
            const restartedReviewThreadId = yield* deps.startReviewSession({
              attempt: attemptContext,
              ticketSummary,
              workerHandoff: latestWorkerHandoff,
              validationRuns: latestBatch,
              findings: openFindings,
              priorReviewArtifacts,
              supervisorNote:
                "Restart review for this attempt because the previous review thread is unavailable.",
            });
            reviewThreadId = restartedReviewThreadId;
            yield* deps.persistSupervisorRun({
              runId,
              boardId: run.boardId,
              sourceGoalIntakeId: run.sourceGoalIntakeId,
              scopeTicketIds: run.scopeTicketIds,
              status: "running",
              stage: "waiting_on_review",
              currentTicketId: ticket.id,
              activeThreadIds: [restartedReviewThreadId],
              summary: `Restarted review for ${ticket.title}.`,
              createdAt: run.createdAt,
            });
            progressed = true;
            continue;
          }

          if (!reviewThread.latestTurn) {
            const restartedReviewThreadId = yield* deps.startReviewSession({
              attempt: attemptContext,
              ticketSummary,
              workerHandoff: latestWorkerHandoff,
              validationRuns: latestBatch,
              findings: openFindings,
              priorReviewArtifacts,
              supervisorNote:
                "Restart review for this attempt because the previous review thread never started a turn.",
            });
            reviewThreadId = restartedReviewThreadId;
            yield* deps.persistSupervisorRun({
              runId,
              boardId: run.boardId,
              sourceGoalIntakeId: run.sourceGoalIntakeId,
              scopeTicketIds: run.scopeTicketIds,
              status: "running",
              stage: "waiting_on_review",
              currentTicketId: ticket.id,
              activeThreadIds: [restartedReviewThreadId],
              summary: `Restarted review kickoff for ${ticket.title} because the previous review thread never became active.`,
              createdAt: run.createdAt,
            });
            progressed = true;
            continue;
          }

          if (
            reviewThread?.latestTurn?.state === "running" &&
            reviewThread.latestTurn.requestedAt &&
            deps
              .addMillisecondsIso(reviewThread.latestTurn.requestedAt, deps.reviewThreadTimeoutMs)
              .localeCompare(deps.nowIso()) <= 0
          ) {
            yield* deps.blockTicketForReviewFailure({
              ticketId: ticket.id,
              attemptId: activeAttempt.id,
              reviewThreadId,
              summary: "Review worker timed out before producing a valid result.",
              rationale:
                "The review thread exceeded the review timeout without settling on a machine-readable review result.",
            });
            yield* persistSupervisorRunAfterStateChange({
              run,
              stage: "stable",
              currentTicketId: ticket.id,
              activeThreadIds: [],
              summary: `Blocked ${ticket.title} because the review worker timed out.`,
            });
            progressed = true;
            continue;
          }

          if (!deps.isThreadSettled(reviewThread)) {
            yield* deps.persistSupervisorRun({
              runId,
              boardId: run.boardId,
              sourceGoalIntakeId: run.sourceGoalIntakeId,
              scopeTicketIds: run.scopeTicketIds,
              status: "running",
              stage: "waiting_on_review",
              currentTicketId: ticket.id,
              activeThreadIds: [reviewThreadId],
              summary: `Waiting for the review worker on ${ticket.title} to settle.`,
              createdAt: run.createdAt,
            });
            continue;
          }

          const parsedReviewResult = yield* deps.readLatestReviewResultFromThread(reviewThread);
          if (
            parsedReviewResult?.decision === "accept" &&
            parsedReviewResult.findings.some((finding) => finding.severity === "blocking")
          ) {
            yield* deps.blockTicketForReviewFailure({
              ticketId: ticket.id,
              attemptId: activeAttempt.id,
              reviewThreadId,
              summary: "Review worker returned an inconsistent accept result.",
              rationale:
                "The review result recommended accept while also reporting blocking findings, so the supervisor refused to apply it.",
            });
            yield* persistSupervisorRunAfterStateChange({
              run,
              stage: "stable",
              currentTicketId: ticket.id,
              activeThreadIds: [],
              summary: `Blocked ${ticket.title} because the review result was internally inconsistent.`,
            });
            progressed = true;
            continue;
          }

          if (
            reviewThread?.latestTurn?.state === "error" ||
            reviewThread?.latestTurn?.state === "interrupted" ||
            !parsedReviewResult
          ) {
            yield* deps.blockTicketForReviewFailure({
              ticketId: ticket.id,
              attemptId: activeAttempt.id,
              reviewThreadId,
              summary: !parsedReviewResult
                ? "Review worker did not produce a valid structured review result."
                : `Review worker settled with state ${reviewThread?.latestTurn?.state}.`,
              rationale: !parsedReviewResult
                ? "The review thread settled without a valid [PRESENCE_REVIEW_RESULT] block, so the supervisor cannot apply an honest agentic review decision."
                : "The review thread failed before producing a valid structured review result.",
            });
            yield* persistSupervisorRunAfterStateChange({
              run,
              stage: "stable",
              currentTicketId: ticket.id,
              activeThreadIds: [],
              summary: `Blocked ${ticket.title} because the review output was missing or invalid.`,
            });
            progressed = true;
            continue;
          }

          const reviewResult = yield* deps.applyReviewDecisionInternal({
            ticketId: ticket.id,
            attemptId: activeAttempt.id,
            decision: parsedReviewResult.decision,
            notes: parsedReviewResult.summary,
            reviewerKind: "review_agent",
            reviewThreadId,
            reviewFindings: parsedReviewResult.findings,
            reviewChecklistAssessment: parsedReviewResult.checklistAssessment,
            reviewEvidence: parsedReviewResult.evidence,
            changedFilesReviewed: parsedReviewResult.changedFilesReviewed,
            mechanismChecklistSupported: deps.reviewResultSupportsMechanismChecklist(
              parsedReviewResult,
              latestWorkerHandoff,
            ),
          });
          progressed = true;

          if (reviewResult.decision === "accept") {
            yield* deps.ensurePromotionCandidateForAcceptedAttempt({
              boardId: run.boardId,
              ticketId: ticket.id,
              attemptId: activeAttempt.id,
              workerHandoff: latestWorkerHandoff,
              findings: openFindings,
            });
            yield* persistSupervisorRunAfterStateChange({
              run,
              stage: "apply_review",
              currentTicketId: ticket.id,
              activeThreadIds: [],
              summary: `Review accepted ${ticket.title}; ticket is ready to merge.`,
            });
          } else if (reviewResult.decision === "request_changes") {
            const refreshedHandoff = yield* deps.readLatestWorkerHandoffForAttempt(activeAttempt.id);
            const retryCount = (refreshedHandoff?.retryCount ?? 0) + 1;
            yield* deps.saveWorkerHandoff({
              attemptId: activeAttempt.id,
              completedWork:
                refreshedHandoff?.completedWork ?? ["Review requested another worker iteration."],
              currentHypothesis: refreshedHandoff?.currentHypothesis ?? null,
              changedFiles: refreshedHandoff?.changedFiles ?? [],
              testsRun: refreshedHandoff?.testsRun ?? [],
              blockers: refreshedHandoff?.blockers ?? [],
              nextStep:
                "Address the review feedback on the same attempt before asking for approval again.",
              openQuestions: refreshedHandoff?.openQuestions ?? [],
              retryCount,
              reasoningSource: refreshedHandoff?.reasoningSource ?? null,
              reasoningUpdatedAt: refreshedHandoff?.reasoningUpdatedAt ?? null,
              confidence: refreshedHandoff?.confidence ?? 0.64,
              evidenceIds: refreshedHandoff?.evidenceIds ?? [],
            });
            if (retryCount >= 3) {
              yield* deps.sql`
                UPDATE presence_tickets
                SET status = ${"blocked"}, updated_at = ${deps.nowIso()}
                WHERE ticket_id = ${ticket.id}
              `;
            } else {
              const selection = yield* deps.resolveModelSelectionForAttempt(attemptContext);
              yield* deps.queueTurnStart({
                threadId: attemptContext.attemptThreadId,
                titleSeed: attemptContext.ticketTitle,
                selection,
                text: deps.buildWorkerContinuationPrompt({
                  ticketTitle: attemptContext.ticketTitle,
                  reason: `Review requested changes on the same attempt. Address the feedback and continue. Review summary: ${parsedReviewResult.summary}`,
                  handoff: refreshedHandoff ?? latestWorkerHandoff,
                }),
              });
            }
            if (retryCount >= 3) {
              yield* persistSupervisorRunAfterStateChange({
                run,
                stage: "stable",
                currentTicketId: ticket.id,
                activeThreadIds: [],
                summary: `Blocked ${ticket.title} after repeated review-driven retries.`,
              });
            } else {
              yield* deps.persistSupervisorRun({
                runId,
                boardId: run.boardId,
                sourceGoalIntakeId: run.sourceGoalIntakeId,
                scopeTicketIds: run.scopeTicketIds,
                status: "running",
                stage: "waiting_on_worker",
                currentTicketId: ticket.id,
                activeThreadIds: [attemptContext.attemptThreadId],
                summary: `Review requested changes for ${ticket.title}; worker continuation queued.`,
                createdAt: run.createdAt,
              });
            }
          } else {
            yield* persistSupervisorRunAfterStateChange({
              run,
              stage: "stable",
              currentTicketId: ticket.id,
              activeThreadIds: [],
              summary: `Escalated ${ticket.title} after review.`,
            });
          }
        }

        if (!progressed) {
          yield* deps.persistSupervisorRun({
            runId,
            boardId: run.boardId,
            sourceGoalIntakeId: run.sourceGoalIntakeId,
            scopeTicketIds: run.scopeTicketIds,
            status: "running",
            stage: "waiting_on_worker",
            currentTicketId: actionableTickets[0]?.id ?? null,
            activeThreadIds: snapshot.attempts
              .filter((attempt) =>
                actionableTickets.some((ticket) => ticket.id === attempt.ticketId) &&
                Boolean(attempt.threadId),
              )
              .map((attempt) => attempt.threadId!)
              .slice(0, 2),
            summary:
              "Supervisor is waiting for worker progress before the next validation/review pass.",
            createdAt: run.createdAt,
          });
          for (const activeAttempt of snapshot.attempts.filter((attempt) =>
            actionableTickets.some((ticket) => ticket.id === attempt.ticketId) &&
            Boolean(attempt.threadId),
          )) {
            yield* deps.synthesizeWorkerHandoffFromThread(activeAttempt.id, { allowRunning: true });
            yield* deps.syncTicketProjectionBestEffort(
              activeAttempt.ticketId,
              "Supervisor runtime refreshed active attempt projections while waiting on work.",
            );
          }
          yield* Effect.sleep(5000);
        }
      }

      const finalRun = yield* deps.readSupervisorRunById(runId);
      if (!finalRun || finalRun.status === "cancelled" || finalRun.status === "completed") {
        return;
      }
      yield* saveTerminalSupervisorHandoff({
        boardId: finalRun.boardId,
        scopeTicketIds: finalRun.scopeTicketIds,
        recentDecision:
          "Supervisor runtime hit the configured step or time budget before reaching a stable state.",
        nextBoardActions: ["Inspect the latest ticket state and decide whether to resume or cancel."],
      });
      yield* deps.persistSupervisorRun({
        runId,
        boardId: finalRun.boardId,
        sourceGoalIntakeId: finalRun.sourceGoalIntakeId,
        scopeTicketIds: finalRun.scopeTicketIds,
        status: "failed",
        stage: finalRun.stage,
        currentTicketId: finalRun.currentTicketId,
        activeThreadIds: finalRun.activeThreadIds,
        summary:
          "Supervisor runtime hit the configured step or time budget before reaching a stable state.",
        createdAt: finalRun.createdAt,
      });
    }).pipe(
      Effect.catch((cause) =>
        Effect.gen(function* () {
          const run = yield* deps.readSupervisorRunById(runId);
          if (!run || run.status === "cancelled" || run.status === "completed") {
            return;
          }
          const failureSummary =
            cause instanceof Error ? cause.message : "Supervisor runtime failed unexpectedly.";
          yield* saveTerminalSupervisorHandoff({
            boardId: run.boardId,
            scopeTicketIds: run.scopeTicketIds,
            recentDecision: failureSummary,
            nextBoardActions: ["Inspect the latest ticket state before starting another supervisor run."],
          });
          yield* deps.persistSupervisorRun({
            runId,
            boardId: run.boardId,
            sourceGoalIntakeId: run.sourceGoalIntakeId,
            scopeTicketIds: run.scopeTicketIds,
            status: "failed",
            stage: run.stage,
            currentTicketId: run.currentTicketId,
            activeThreadIds: run.activeThreadIds,
            summary: failureSummary,
            createdAt: run.createdAt,
          });
        }),
      ),
    );

  return {
    startSupervisorRun: (
      input: PresenceStartSupervisorRunInput,
    ) =>
      Effect.gen(function* () {
        const snapshot = yield* deps.getBoardSnapshotInternal(input.boardId);
        const boardTicketIds = new Set(snapshot.tickets.map((ticket) => ticket.id));
        if (input.ticketIds && input.ticketIds.some((ticketId) => !boardTicketIds.has(ticketId))) {
          return yield* Effect.fail(
            deps.presenceError(
              "Supervisor runs can only scope tickets that belong to the selected board.",
            ),
          );
        }
        const scopeTicketIds =
          input.ticketIds && input.ticketIds.length > 0
            ? input.ticketIds
            : input.goalIntakeId
              ? snapshot.goalIntakes.find((intake) => intake.id === input.goalIntakeId)
                  ?.createdTicketIds ?? []
              : snapshot.tickets
                  .filter(
                    (ticket) =>
                      ticket.status === "todo" ||
                      ticket.status === "in_progress" ||
                      ticket.status === "in_review",
                  )
                  .map((ticket) => ticket.id);
        if (scopeTicketIds.length === 0) {
          return yield* Effect.fail(
            deps.presenceError("No actionable tickets were available for the supervisor run."),
          );
        }
        const normalizedScopeTicketIds = deps.normalizeIdList(scopeTicketIds);
        const existingRun = yield* deps.readLatestSupervisorRunForBoard(input.boardId);
        if (existingRun && existingRun.status === "running") {
          const requestedGoalIntakeId = input.goalIntakeId ?? null;
          const existingScope = deps.normalizeIdList(existingRun.scopeTicketIds);
          if (
            existingRun.sourceGoalIntakeId !== requestedGoalIntakeId ||
            JSON.stringify(existingScope) !== JSON.stringify(normalizedScopeTicketIds)
          ) {
            return yield* Effect.fail(
              deps.presenceError(
                "A supervisor run is already active for this board with a different scope. Cancel it before starting another one.",
              ),
            );
          }
          return existingRun;
        }

        const createdAt = deps.nowIso();
        const runId = deps.makeId(SupervisorRunId, "supervisor_run");
        const run = yield* deps
          .persistSupervisorRun({
            runId,
            boardId: input.boardId,
            sourceGoalIntakeId: input.goalIntakeId ?? null,
            scopeTicketIds: normalizedScopeTicketIds,
            status: "running",
            stage: "plan",
            currentTicketId: null,
            activeThreadIds: [],
            summary: "Supervisor runtime started and is planning the scoped tickets.",
            createdAt,
          })
          .pipe(
            Effect.catch((cause) =>
              deps.isSqliteUniqueConstraintError(cause)
                ? Effect.gen(function* () {
                    const runningRun = yield* deps.readLatestSupervisorRunForBoard(input.boardId);
                    const requestedGoalIntakeId = input.goalIntakeId ?? null;
                    const runningScope = deps.normalizeIdList(runningRun?.scopeTicketIds ?? []);
                    if (
                      runningRun?.status === "running" &&
                      runningRun.sourceGoalIntakeId === requestedGoalIntakeId &&
                      JSON.stringify(runningScope) === JSON.stringify(normalizedScopeTicketIds)
                    ) {
                      return runningRun;
                    }
                    return yield* Effect.fail(
                      deps.presenceError(
                        "A supervisor run is already active for this board with a different scope. Cancel it before starting another one.",
                        cause,
                      ),
                    );
                  })
                : Effect.fail(cause),
            ),
          );
        yield* deps.saveSupervisorHandoff({
          boardId: BoardId.make(input.boardId),
          topPriorities: snapshot.tickets
            .filter((ticket) =>
              normalizedScopeTicketIds.some((scopeTicketId) => scopeTicketId === ticket.id),
            )
            .map((ticket) => ticket.title)
            .slice(0, 3),
          activeAttemptIds: [],
          blockedTicketIds: snapshot.tickets
            .filter((ticket) => ticket.status === "blocked")
            .map((ticket) => TicketId.make(ticket.id)),
          recentDecisions: ["Started a supervisor runtime using the GLM-style handoff loop."],
          nextBoardActions: ["Work -> test -> log -> advance across the scoped tickets."],
          currentRunId: run.id,
          stage: "plan",
        });
        yield* executeSupervisorRun(run.id).pipe(Effect.ignore, Effect.forkDetach);
        return run;
      }).pipe(
        Effect.catch((cause) =>
          Effect.fail(deps.presenceError("Failed to start the supervisor runtime.", cause)),
        ),
      ),

    cancelSupervisorRun: (
      input: PresenceCancelSupervisorRunInput,
    ) =>
      Effect.gen(function* () {
        const run = yield* deps.readSupervisorRunById(input.runId);
        if (!run) {
          return yield* Effect.fail(
            deps.presenceError(`Supervisor run '${input.runId}' not found.`),
          );
        }
        yield* saveTerminalSupervisorHandoff({
          boardId: run.boardId,
          scopeTicketIds: run.scopeTicketIds,
          recentDecision: "Supervisor runtime was cancelled.",
          nextBoardActions: ["Resume manually when you want the supervisor loop to continue."],
        });
        return yield* deps.persistSupervisorRun({
          runId: run.id,
          boardId: run.boardId,
          sourceGoalIntakeId: run.sourceGoalIntakeId,
          scopeTicketIds: run.scopeTicketIds,
          status: "cancelled",
          stage: run.stage,
          currentTicketId: run.currentTicketId,
          activeThreadIds: [],
          summary: "Supervisor runtime was cancelled.",
          createdAt: run.createdAt,
        });
      }).pipe(
        Effect.catch((cause) =>
          Effect.fail(deps.presenceError("Failed to cancel the supervisor runtime.", cause)),
        ),
      ),

    executeSupervisorRun,
  };
};

export { makePresenceSupervisorRuntime };
export type { PresenceSupervisorRuntime };
