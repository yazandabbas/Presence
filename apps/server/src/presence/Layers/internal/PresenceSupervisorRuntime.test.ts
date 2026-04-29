import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

import {
  AttemptId,
  BoardId,
  CommandId,
  EventId,
  FindingId,
  HandoffId,
  type OrchestrationCommand,
  MessageId,
  ProjectId,
  type ProviderRuntimeEvent,
  RuntimeItemId,
  SupervisorRunId,
  type SupervisorRunRecord,
  ThreadId,
  TicketId,
} from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  buildReviewResultBlock,
  createGitRepository,
  createPresenceSystem,
  removeTempRepo,
  runGit,
  waitFor,
} from "../PresenceControlPlaneTestSupport.ts";
import { presenceError } from "./PresenceShared.ts";
import {
  makePresenceSupervisorRuntime,
  reviewAcceptanceBlocker,
  supervisorHandoffReceiverWarnings,
} from "./PresenceSupervisorRuntime.ts";
import { buildPresenceToolBridgeReport } from "./PresenceToolBridge.ts";

describe("PresenceSupervisorRuntime", () => {
  const validAcceptReviewResult = () => ({
    decision: "accept" as const,
    summary: "The attempt is ready.",
    checklistAssessment: [
      {
        label: "Mechanism understood",
        satisfied: true,
        notes: "The reviewer understood the changed mechanism.",
      },
      {
        label: "Evidence attached",
        satisfied: true,
        notes: "Concrete evidence was attached.",
      },
    ],
    findings: [],
    evidence: [
      {
        kind: "file_inspection" as const,
        target: "README.md",
        outcome: "passed" as const,
        relevant: true,
        summary: "README.md was inspected.",
        details: null,
      },
    ],
    changedFilesReviewed: ["README.md"],
    updatedAt: "2026-04-24T00:00:00.000Z",
  });

  it("refuses accept review results that also contain blocking findings", () => {
    const blocker = reviewAcceptanceBlocker({
      parsedReviewResult: {
        ...validAcceptReviewResult(),
        findings: [
          {
            severity: "blocking" as const,
            disposition: "same_ticket" as const,
            summary: "The implementation is still broken.",
            rationale: "The reviewer found a blocking defect.",
          },
        ],
      },
      latestWorkerHandoff: null,
      reviewResultHasValidationEvidence: () => true,
    });

    expect(blocker?.summary).toBe("Review worker returned an inconsistent accept result.");
    expect(blocker?.rationale).toContain("blocking findings");
  });

  it("refuses accept review results without relevant validation evidence", () => {
    const blocker = reviewAcceptanceBlocker({
      parsedReviewResult: validAcceptReviewResult(),
      latestWorkerHandoff: null,
      reviewResultHasValidationEvidence: () => false,
    });

    expect(blocker?.summary).toBe("Review worker accepted without enough validation evidence.");
    expect(blocker?.rationale).toContain("concrete relevant evidence");
  });

  it("refuses accept review results with unsatisfied checklist items", () => {
    const blocker = reviewAcceptanceBlocker({
      parsedReviewResult: {
        ...validAcceptReviewResult(),
        checklistAssessment: [
          {
            label: "Mechanism understood",
            satisfied: true,
            notes: "Mechanism was inspected.",
          },
          {
            label: "Evidence attached",
            satisfied: false,
            notes: "The reviewer did not attach evidence.",
          },
        ],
      },
      latestWorkerHandoff: null,
      reviewResultHasValidationEvidence: () => true,
    });

    expect(blocker?.summary).toBe("Review worker accepted with unsatisfied checklist items.");
    expect(blocker?.rationale).toContain("checklist item was unsatisfied");
  });

  it("classifies stale supervisor handoff claims against current board state", () => {
    const boardId = BoardId.make("board_handoff_receiver");
    const run = {
      id: SupervisorRunId.make("supervisor_run_current"),
      boardId,
      sourceGoalIntakeId: null,
      scopeTicketIds: [TicketId.make("ticket_current"), TicketId.make("ticket_stale")],
      status: "running",
      stage: "waiting_on_worker",
      currentTicketId: TicketId.make("ticket_current"),
      activeThreadIds: [],
      summary: "Current persisted run.",
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:00:00.000Z",
    } satisfies SupervisorRunRecord;
    const handoff = {
      id: HandoffId.make("handoff_stale"),
      boardId,
      topPriorities: [],
      activeAttemptIds: [AttemptId.make("attempt_terminal"), AttemptId.make("attempt_foreign")],
      blockedTicketIds: [TicketId.make("ticket_stale")],
      recentDecisions: [],
      nextBoardActions: [],
      currentRunId: SupervisorRunId.make("supervisor_run_old"),
      stage: "plan" as const,
      resumeProtocol: [],
      createdAt: "2026-04-24T00:00:00.000Z",
    };

    const warnings = supervisorHandoffReceiverWarnings({
      handoff,
      run,
      snapshot: {
        supervisorHandoff: handoff,
        tickets: [
          { id: "ticket_current", title: "Current blocker", status: "blocked" },
          { id: "ticket_stale", title: "No longer blocked", status: "in_progress" },
          { id: "ticket_foreign", title: "Foreign ticket", status: "in_progress" },
        ],
        attempts: [
          {
            id: AttemptId.make("attempt_terminal"),
            ticketId: TicketId.make("ticket_current"),
            workspaceId: null,
            title: "Terminal attempt",
            status: "accepted",
            provider: null,
            model: null,
            threadId: null,
            summary: null,
            confidence: null,
            lastWorkerHandoffId: null,
            createdAt: "2026-04-24T00:00:00.000Z",
            updatedAt: "2026-04-24T00:00:00.000Z",
          },
          {
            id: AttemptId.make("attempt_foreign"),
            ticketId: TicketId.make("ticket_foreign"),
            workspaceId: null,
            title: "Foreign attempt",
            status: "in_progress",
            provider: null,
            model: null,
            threadId: null,
            summary: null,
            confidence: null,
            lastWorkerHandoffId: null,
            createdAt: "2026-04-24T00:00:00.000Z",
            updatedAt: "2026-04-24T00:00:00.000Z",
          },
        ],
        findings: [
          {
            id: FindingId.make("finding_current_blocker"),
            ticketId: TicketId.make("ticket_current"),
            attemptId: null,
            source: "supervisor",
            severity: "blocking",
            disposition: "blocker",
            status: "open",
            summary: "Current state has a blocker.",
            rationale: "Persisted findings win over handoff omissions.",
            evidenceIds: [],
            createdAt: "2026-04-24T00:00:00.000Z",
            updatedAt: "2026-04-24T00:00:00.000Z",
          },
        ],
      },
    });

    expect(warnings.map((warning) => warning.dedupeKey)).toEqual(
      expect.arrayContaining([
        "supervisor-handoff-stale-active-attempt:handoff_stale:attempt_terminal",
        "supervisor-handoff-out-of-scope-active-attempt:handoff_stale:attempt_foreign",
        "supervisor-handoff-stale-blocked-ticket:handoff_stale:ticket_stale",
        "supervisor-handoff-omitted-current-blocker:handoff_stale:ticket_current",
        "supervisor-handoff-run-mismatch:handoff_stale:supervisor_run_current",
        "supervisor-handoff-stage-mismatch:handoff_stale:supervisor_run_current",
      ]),
    );
  });

  it("emits warning mission events for stale handoffs while completing from current state", async () => {
    const boardId = BoardId.make("board_handoff_runtime");
    const ticketId = TicketId.make("ticket_current_blocked");
    const attemptId = AttemptId.make("attempt_terminal_runtime");
    const now = "2026-04-24T00:00:00.000Z";
    const run = {
      id: SupervisorRunId.make("supervisor_run_handoff_runtime"),
      boardId,
      sourceGoalIntakeId: null,
      scopeTicketIds: [ticketId],
      status: "running",
      stage: "waiting_on_worker",
      currentTicketId: ticketId,
      activeThreadIds: [],
      summary: "Current persisted run.",
      createdAt: now,
      updatedAt: now,
    } satisfies SupervisorRunRecord;
    const handoff = {
      id: HandoffId.make("handoff_runtime_stale"),
      boardId,
      topPriorities: [],
      activeAttemptIds: [attemptId],
      blockedTicketIds: [],
      recentDecisions: [],
      nextBoardActions: [],
      currentRunId: run.id,
      stage: "waiting_on_worker" as const,
      resumeProtocol: [],
      createdAt: now,
    };
    const snapshot = {
      tickets: [{ id: ticketId, title: "Currently blocked", status: "blocked" }],
      goalIntakes: [],
      attempts: [
        {
          id: attemptId,
          ticketId,
          workspaceId: null,
          title: "Terminal attempt",
          status: "accepted",
          provider: null,
          model: null,
          threadId: null,
          summary: null,
          confidence: null,
          lastWorkerHandoffId: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      findings: [],
      ticketSummaries: [],
      reviewArtifacts: [],
      boardProjectionHealth: null,
      ticketProjectionHealth: [],
      missionBriefing: null,
      ticketBriefings: [],
      missionEvents: [],
      supervisorHandoff: handoff,
    };
    const writtenEvents: Array<{ kind: string; dedupeKey: string }> = [];
    const persistedRuns: SupervisorRunRecord[] = [];
    const deps = {
      getBoardSnapshotInternal: () => Effect.succeed(snapshot),
      readSupervisorRunById: () => Effect.succeed(run),
      saveSupervisorHandoff: () => Effect.succeed(null),
      persistSupervisorRun: (input: {
        status: SupervisorRunRecord["status"];
        stage: SupervisorRunRecord["stage"];
        currentTicketId: SupervisorRunRecord["currentTicketId"];
        activeThreadIds: SupervisorRunRecord["activeThreadIds"];
        summary: string;
      }) =>
        Effect.sync(() => {
          const persisted = {
            ...run,
            status: input.status,
            stage: input.stage,
            currentTicketId: input.currentTicketId,
            activeThreadIds: input.activeThreadIds,
            summary: input.summary,
          } satisfies SupervisorRunRecord;
          persistedRuns.push(persisted);
          return persisted;
        }),
      writeMissionEvent: (input: { kind: string; dedupeKey: string }) =>
        Effect.sync(() => {
          writtenEvents.push({
            kind: input.kind,
            dedupeKey: input.dedupeKey,
          });
          return {
            id: "mission_event_handoff_warning",
            boardId,
            ticketId,
            attemptId,
            reviewArtifactId: null,
            supervisorRunId: run.id,
            threadId: null,
            kind: "runtime_warning",
            severity: "warning",
            summary: "warning",
            detail: null,
            retryBehavior: "not_applicable",
            humanAction: null,
            dedupeKey: input.dedupeKey,
            report: null,
            createdAt: now,
          };
        }),
      uniqueStrings: (values: ReadonlyArray<string>) => [...new Set(values)],
      nowIso: () => now,
    } as unknown as Parameters<typeof makePresenceSupervisorRuntime>[0];

    const supervisor = makePresenceSupervisorRuntime(deps);
    await supervisor.executeSupervisorRun(run.id).pipe(Effect.runPromise);

    expect(writtenEvents).toEqual([
      {
        kind: "runtime_warning",
        dedupeKey:
          "supervisor-handoff-stale-active-attempt:handoff_runtime_stale:attempt_terminal_runtime",
      },
      {
        kind: "runtime_warning",
        dedupeKey:
          "supervisor-handoff-omitted-current-blocker:handoff_runtime_stale:ticket_current_blocked",
      },
    ]);
    expect(persistedRuns.at(-1)?.status).toBe("completed");
  });

  it("returns the existing active same-scope supervisor run without launching another executor", async () => {
    const boardId = BoardId.make("board_supervisor_existing");
    const firstTicketId = TicketId.make("ticket_supervisor_existing_a");
    const secondTicketId = TicketId.make("ticket_supervisor_existing_b");
    const now = "2026-04-21T00:00:00.000Z";
    const existingRun = {
      id: SupervisorRunId.make("supervisor_run_existing_same_scope"),
      boardId,
      sourceGoalIntakeId: null,
      scopeTicketIds: [firstTicketId, secondTicketId],
      status: "running",
      stage: "waiting_on_worker",
      currentTicketId: firstTicketId,
      activeThreadIds: [],
      summary: "Existing same-scope supervisor run.",
      createdAt: now,
      updatedAt: now,
    } satisfies SupervisorRunRecord;
    let executorReads = 0;
    let handoffWrites = 0;
    let persistWrites = 0;

    const deps = {
      getBoardSnapshotInternal: () =>
        Effect.succeed({
          tickets: [
            { id: firstTicketId, title: "First ticket", status: "in_progress" },
            { id: secondTicketId, title: "Second ticket", status: "in_progress" },
          ],
          goalIntakes: [],
          attempts: [],
          findings: [],
          ticketSummaries: [],
          reviewArtifacts: [],
          boardProjectionHealth: null,
          ticketProjectionHealth: [],
          missionBriefing: null,
          ticketBriefings: [],
          missionEvents: [],
        }),
      readLatestSupervisorRunForBoard: () => Effect.succeed(existingRun),
      readSupervisorRunById: () =>
        Effect.sync(() => {
          executorReads += 1;
          return existingRun;
        }),
      persistSupervisorRun: () =>
        Effect.sync(() => {
          persistWrites += 1;
          return existingRun;
        }),
      saveSupervisorHandoff: () =>
        Effect.sync(() => {
          handoffWrites += 1;
          return null;
        }),
      normalizeIdList: (values: ReadonlyArray<string>) => [...new Set(values)].toSorted(),
      nowIso: () => now,
      presenceError,
    } as unknown as Parameters<typeof makePresenceSupervisorRuntime>[0];

    const supervisor = makePresenceSupervisorRuntime(deps);
    const run = await supervisor
      .startSupervisorRun({ boardId, ticketIds: [secondTicketId, firstTicketId] })
      .pipe(Effect.runPromise);

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(run).toBe(existingRun);
    expect(persistWrites).toBe(0);
    expect(handoffWrites).toBe(0);
    expect(executorReads).toBe(0);
  });

  it("rejects an active cross-scope supervisor run without launching another executor", async () => {
    const boardId = BoardId.make("board_supervisor_cross_scope");
    const existingTicketId = TicketId.make("ticket_supervisor_existing_scope");
    const requestedTicketId = TicketId.make("ticket_supervisor_requested_scope");
    const now = "2026-04-21T00:00:00.000Z";
    const existingRun = {
      id: SupervisorRunId.make("supervisor_run_existing_cross_scope"),
      boardId,
      sourceGoalIntakeId: null,
      scopeTicketIds: [existingTicketId],
      status: "running",
      stage: "waiting_on_worker",
      currentTicketId: existingTicketId,
      activeThreadIds: [],
      summary: "Existing cross-scope supervisor run.",
      createdAt: now,
      updatedAt: now,
    } satisfies SupervisorRunRecord;
    let executorReads = 0;
    let handoffWrites = 0;
    let persistWrites = 0;

    const deps = {
      getBoardSnapshotInternal: () =>
        Effect.succeed({
          tickets: [
            { id: existingTicketId, title: "Existing ticket", status: "in_progress" },
            { id: requestedTicketId, title: "Requested ticket", status: "in_progress" },
          ],
          goalIntakes: [],
          attempts: [],
          findings: [],
          ticketSummaries: [],
          reviewArtifacts: [],
          boardProjectionHealth: null,
          ticketProjectionHealth: [],
          missionBriefing: null,
          ticketBriefings: [],
          missionEvents: [],
        }),
      readLatestSupervisorRunForBoard: () => Effect.succeed(existingRun),
      readSupervisorRunById: () =>
        Effect.sync(() => {
          executorReads += 1;
          return existingRun;
        }),
      persistSupervisorRun: () =>
        Effect.sync(() => {
          persistWrites += 1;
          return existingRun;
        }),
      saveSupervisorHandoff: () =>
        Effect.sync(() => {
          handoffWrites += 1;
          return null;
        }),
      normalizeIdList: (values: ReadonlyArray<string>) => [...new Set(values)].toSorted(),
      nowIso: () => now,
      presenceError,
    } as unknown as Parameters<typeof makePresenceSupervisorRuntime>[0];

    const supervisor = makePresenceSupervisorRuntime(deps);
    await expect(
      supervisor
        .startSupervisorRun({ boardId, ticketIds: [requestedTicketId] })
        .pipe(Effect.runPromise),
    ).rejects.toMatchObject({
      message: expect.stringContaining("Failed to start the supervisor runtime."),
      cause: expect.objectContaining({
        message: expect.stringMatching(/different scope/i),
      }),
    });

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(persistWrites).toBe(0);
    expect(handoffWrites).toBe(0);
    expect(executorReads).toBe(0);
  });

  it("reuses a concurrent same-scope supervisor run without launching another executor", async () => {
    const boardId = BoardId.make("board_supervisor_race");
    const ticketId = TicketId.make("ticket_supervisor_race");
    const reviewThreadId = ThreadId.make("presence_review_thread_race_existing");
    const now = "2026-04-21T00:00:00.000Z";
    const existingRun = {
      id: SupervisorRunId.make("supervisor_run_race_existing"),
      boardId,
      sourceGoalIntakeId: null,
      scopeTicketIds: [ticketId],
      status: "running",
      stage: "waiting_on_review",
      currentTicketId: ticketId,
      activeThreadIds: [reviewThreadId],
      summary: "Existing same-scope supervisor run.",
      createdAt: now,
      updatedAt: now,
    } satisfies SupervisorRunRecord;
    let latestRunReads = 0;
    let executorReads = 0;
    let handoffWrites = 0;

    const deps = {
      getBoardSnapshotInternal: () =>
        Effect.succeed({
          tickets: [{ id: ticketId, title: "Review race ticket", status: "in_review" }],
          goalIntakes: [],
          attempts: [],
          findings: [],
          ticketSummaries: [],
          reviewArtifacts: [],
          boardProjectionHealth: null,
          ticketProjectionHealth: [],
          missionBriefing: null,
          ticketBriefings: [],
          missionEvents: [],
        }),
      readLatestSupervisorRunForBoard: () =>
        Effect.succeed(latestRunReads++ === 0 ? null : existingRun),
      readSupervisorRunById: () =>
        Effect.sync(() => {
          executorReads += 1;
          return existingRun;
        }),
      persistSupervisorRun: () =>
        Effect.fail(
          new Error("SQLITE_CONSTRAINT_UNIQUE: presence_supervisor_runs_running_board_idx"),
        ),
      saveSupervisorHandoff: () =>
        Effect.sync(() => {
          handoffWrites += 1;
          return null;
        }),
      normalizeIdList: (values: ReadonlyArray<string>) => [...new Set(values)].toSorted(),
      nowIso: () => now,
      makeId: () => SupervisorRunId.make("supervisor_run_race_new"),
      isSqliteUniqueConstraintError: () => true,
      presenceError,
    } as unknown as Parameters<typeof makePresenceSupervisorRuntime>[0];

    const supervisor = makePresenceSupervisorRuntime(deps);
    const run = await supervisor
      .startSupervisorRun({ boardId, ticketIds: [ticketId] })
      .pipe(Effect.runPromise);

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(run).toBe(existingRun);
    expect(handoffWrites).toBe(0);
    expect(executorReads).toBe(0);
  });

  it("rejects supervisor runs that scope tickets outside the selected board", async () => {
    const firstRepo = await createGitRepository("presence-supervisor-scope-a-");
    const secondRepo = await createGitRepository("presence-supervisor-scope-b-");
    const system = await createPresenceSystem();

    try {
      const firstRepository = await system.presence
        .importRepository({
          workspaceRoot: firstRepo,
          title: "Presence Supervisor Scope A",
        })
        .pipe(Effect.runPromise);
      const secondRepository = await system.presence
        .importRepository({
          workspaceRoot: secondRepo,
          title: "Presence Supervisor Scope B",
        })
        .pipe(Effect.runPromise);
      const foreignTicket = await system.presence
        .createTicket({
          boardId: secondRepository.boardId,
          title: "Foreign ticket",
          description: "This ticket belongs to another board.",
          priority: "p2",
        })
        .pipe(Effect.runPromise);

      await expect(
        system.presence
          .startSupervisorRun({
            boardId: firstRepository.boardId,
            ticketIds: [foreignTicket.id],
          })
          .pipe(Effect.runPromise),
      ).rejects.toMatchObject({
        message: expect.stringContaining("Failed to start the supervisor runtime."),
        cause: expect.objectContaining({
          message: expect.stringMatching(/belong to the selected board/i),
        }),
      });
    } finally {
      await system.dispose();
      await removeTempRepo(firstRepo);
      await removeTempRepo(secondRepo);
    }
  });

  it("surfaces specific supervisor-start reasons in the top-level error message", async () => {
    const repoRoot = await createGitRepository("presence-supervisor-no-actionable-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence
        .importRepository({
          workspaceRoot: repoRoot,
          title: "Presence No Actionable Repo",
        })
        .pipe(Effect.runPromise);
      const ticket = await system.presence
        .createTicket({
          boardId: repository.boardId,
          title: "Blocked ticket",
          description: "Nothing is actionable yet.",
          priority: "p2",
        })
        .pipe(Effect.runPromise);
      await system.presence
        .updateTicket({
          ticketId: ticket.id,
          status: "blocked",
        })
        .pipe(Effect.runPromise);

      await expect(
        system.presence
          .startSupervisorRun({
            boardId: repository.boardId,
          })
          .pipe(Effect.runPromise),
      ).rejects.toMatchObject({
        message: expect.stringContaining("Failed to start the supervisor runtime."),
        cause: expect.objectContaining({
          message: expect.stringMatching(/no actionable tickets were available/i),
        }),
      });

      await expect(
        system.presence
          .startSupervisorRun({
            boardId: repository.boardId,
          })
          .pipe(Effect.runPromise),
      ).rejects.toMatchObject({
        message: expect.stringMatching(
          /Failed to start the supervisor runtime\..*No actionable tickets were available for the supervisor run\./i,
        ),
      });
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("rejects a new supervisor run while Presence is waiting on active runtime work", async () => {
    const repoRoot = await createGitRepository("presence-supervisor-active-runtime-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence
        .importRepository({
          workspaceRoot: repoRoot,
          title: "Presence Active Runtime Repo",
        })
        .pipe(Effect.runPromise);
      const ticket = await system.presence
        .createTicket({
          boardId: repository.boardId,
          title: "Active worker ticket",
          description: "The worker is still running, so another supervisor run should not start.",
          priority: "p2",
        })
        .pipe(Effect.runPromise);

      await system.sql`
        INSERT INTO presence_mission_events (
          mission_event_id, board_id, ticket_id, attempt_id, review_artifact_id,
          supervisor_run_id, thread_id, kind, severity, summary, detail,
          retry_behavior, human_action, dedupe_key, report_json, created_at
        ) VALUES (
          ${"mission_event_active_runtime_worker_started"},
          ${repository.boardId},
          ${ticket.id},
          ${null},
          ${null},
          ${null},
          ${"presence_thread_active_runtime_worker"},
          ${"turn_started"},
          ${"info"},
          ${"Worker turn started."},
          ${null},
          ${"not_applicable"},
          ${null},
          ${"runtime:active-worker-started"},
          ${null},
          ${"2026-04-21T00:05:00.000Z"}
        )
      `.pipe(Effect.runPromise);

      await expect(
        system.presence
          .startSupervisorRun({
            boardId: repository.boardId,
            ticketIds: [ticket.id],
          })
          .pipe(Effect.runPromise),
      ).rejects.toMatchObject({
        message: expect.stringContaining("Failed to start the supervisor runtime."),
        cause: expect.objectContaining({
          message: expect.stringMatching(/active worker or reviewer runtime activity/i),
        }),
      });
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  });

  it("starts and cancels a supervisor run while exposing it in the board snapshot", async () => {
    const repoRoot = await createGitRepository("presence-supervisor-run-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence
        .importRepository({
          workspaceRoot: repoRoot,
          title: "Presence Supervisor Repo",
        })
        .pipe(Effect.runPromise);
      const intake = await system.presence
        .submitGoalIntake({
          boardId: repository.boardId,
          rawGoal: "Add a repository AGENTS.md guide and tighten the validation path.",
          source: "human_goal",
          priorityHint: "p2",
        })
        .pipe(Effect.runPromise);
      expect(intake.createdTickets).toHaveLength(0);

      const run = await system.presence
        .startSupervisorRun({
          boardId: repository.boardId,
          goalIntakeId: intake.intake.id,
        })
        .pipe(Effect.runPromise);
      expect(run.scopeTicketIds).toHaveLength(0);
      expect(run.status).toBe("running");

      const runningSnapshot = await system.presence
        .getBoardSnapshot({
          boardId: repository.boardId,
        })
        .pipe(Effect.runPromise);
      expect(runningSnapshot.supervisorRuns[0]?.id).toBe(run.id);
      expect(runningSnapshot.supervisorHandoff?.currentRunId).toBe(run.id);

      let advancedSnapshot = runningSnapshot;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (
          (advancedSnapshot.goalIntakes[0]?.createdTicketIds?.length ?? 0) > 0 ||
          advancedSnapshot.attempts.length > 0 ||
          advancedSnapshot.supervisorRuns[0]?.stage !== "plan"
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
        advancedSnapshot = await system.presence
          .getBoardSnapshot({
            boardId: repository.boardId,
          })
          .pipe(Effect.runPromise);
      }
      const plannedIntake = advancedSnapshot.goalIntakes[0];
      expect(plannedIntake).toBeDefined();
      expect(plannedIntake?.createdTicketIds).toHaveLength(2);
      expect(plannedIntake?.summary).toMatch(/planned this goal into 2 tickets/i);
      expect(advancedSnapshot.tickets).toHaveLength(2);
      expect(advancedSnapshot.supervisorRuns[0]?.scopeTicketIds).toHaveLength(2);
      expect(advancedSnapshot.supervisorRuns[0]?.stage).not.toBe("stable");

      const cancelled = await system.presence
        .cancelSupervisorRun({
          runId: run.id,
        })
        .pipe(Effect.runPromise);
      expect(cancelled.status).toBe("cancelled");

      const cancelledSnapshot = await system.presence
        .getBoardSnapshot({
          boardId: repository.boardId,
        })
        .pipe(Effect.runPromise);
      expect(cancelledSnapshot.supervisorRuns[0]?.status).toBe("cancelled");
      expect(cancelledSnapshot.supervisorHandoff?.currentRunId).toBeNull();
      expect(cancelledSnapshot.supervisorHandoff?.stage).toBeNull();
      await waitFor(
        async () => existsSync(path.join(repoRoot, ".presence", "board", "supervisor_run.md")),
        5_000,
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  }, 15_000);

  it("waits for a structured review-agent result before accepting a ticket", async () => {
    const repoRoot = await createGitRepository("presence-agentic-review-accept-");
    const system = await createPresenceSystem();
    let attemptId: string | null = null;
    let runId: string | null = null;

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify(
          { name: "presence-agentic-review", scripts: { test: 'node -e "process.exit(0)"' } },
          null,
          2,
        ),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add agentic review evidence scripts"]);

      const repository = await system.presence
        .importRepository({
          workspaceRoot: repoRoot,
          title: "Presence Agentic Review Repo",
        })
        .pipe(Effect.runPromise);
      const ticket = await system.presence
        .createTicket({
          boardId: repository.boardId,
          title: "Review worker decides acceptance",
          description:
            "The supervisor should wait for a structured review result before accepting the ticket.",
          priority: "p2",
          acceptanceChecklist: [
            { id: "check-1", label: "Mechanism understood", checked: true },
            { id: "check-2", label: "Evidence attached", checked: true },
            { id: "check-3", label: "Reviewer validation captured", checked: true },
          ],
        })
        .pipe(Effect.runPromise);
      const attempt = await system.presence
        .createAttempt({
          ticketId: ticket.id,
        })
        .pipe(Effect.runPromise);
      attemptId = attempt.id;
      const session = await system.presence
        .startAttemptSession({
          attemptId: attempt.id,
        })
        .pipe(Effect.runPromise);

      const activeSnapshot = await system.presence
        .getBoardSnapshot({
          boardId: repository.boardId,
        })
        .pipe(Effect.runPromise);
      const worktreePath = activeSnapshot.workspaces[0]?.worktreePath;
      if (!worktreePath) throw new Error("Expected a prepared worktree.");

      await fs.writeFile(
        path.join(worktreePath, "README.md"),
        "# Presence Test\nagentic review\n",
        "utf8",
      );
      await system.presence
        .saveWorkerHandoff({
          attemptId: attempt.id,
          completedWork: ["Updated README.md so the review worker has a concrete diff to inspect."],
          currentHypothesis:
            "The supervisor should wait for the review worker's structured result before accepting.",
          changedFiles: ["README.md"],
          testsRun: ["npm test"],
          blockers: [],
          nextStep: "Request reviewer validation and wait for review.",
          openQuestions: [],
          retryCount: 0,
          evidenceIds: [],
        })
        .pipe(Effect.runPromise);
      system.orchestration.setCheckpoint({
        threadId: session.threadId,
        files: ["README.md"],
        completedAt: "2026-04-21T00:00:01.000Z",
      });
      system.orchestration.setLatestTurnState({
        threadId: session.threadId,
        state: "completed",
        completedAt: "2026-04-21T00:00:02.000Z",
      });
      const run = await system.presence
        .startSupervisorRun({
          boardId: repository.boardId,
          ticketIds: [ticket.id],
        })
        .pipe(Effect.runPromise);
      runId = run.id;

      let reviewCreate: Extract<OrchestrationCommand, { type: "thread.create" }> | undefined;
      let reviewStart: Extract<OrchestrationCommand, { type: "thread.turn.start" }> | undefined;
      await waitFor(async () => {
        reviewCreate = system.commands.find(
          (command): command is Extract<OrchestrationCommand, { type: "thread.create" }> =>
            command.type === "thread.create" && command.title === `${ticket.title} - review`,
        );
        reviewStart = system.commands.find(
          (command): command is Extract<OrchestrationCommand, { type: "thread.turn.start" }> =>
            command.type === "thread.turn.start" &&
            reviewCreate !== undefined &&
            command.threadId === reviewCreate.threadId,
        );
        return Boolean(reviewCreate && reviewStart);
      }, 20_000);

      expect(reviewCreate?.systemPrompt).toContain("Presence review worker role");
      expect(reviewCreate?.systemPrompt).toContain("Inputs and evidence:");
      expect(reviewStart?.message.text).toContain(`Repository root: ${repoRoot}`);
      expect(reviewStart?.message.text).toContain("Current ticket summary:");
      expect(reviewStart?.message.text).toContain("[PRESENCE_REVIEW_RESULT]");
      expect(reviewStart?.message.text).not.toContain("Top priorities:");

      const waitingSnapshot = await system.presence
        .getBoardSnapshot({
          boardId: repository.boardId,
        })
        .pipe(Effect.runPromise);
      expect(
        waitingSnapshot.supervisorRuns.find((candidate) => candidate.id === run.id)?.stage,
      ).toBe("waiting_on_review");
      expect(
        waitingSnapshot.tickets.find((candidate) => candidate.id === ticket.id)?.status,
      ).not.toBe("ready_to_merge");

      if (!reviewCreate) throw new Error("Expected review thread to exist.");
      system.orchestration.pushAssistantMessage({
        threadId: reviewCreate.threadId,
        updatedAt: "2026-04-21T00:00:03.000Z",
        text: buildReviewResultBlock({
          decision: "accept",
          summary: "The README change matches the ticket intent and validation already passed.",
          checklistAssessment: [
            {
              label: "Mechanism understood",
              satisfied: true,
              notes:
                "The worker explained the mechanism clearly and the change is narrow and coherent.",
            },
            {
              label: "Evidence attached",
              satisfied: true,
              notes: "Validation evidence and reviewed files support the conclusion.",
            },
            {
              label: "Reviewer validation captured",
              satisfied: true,
              notes: "The latest validation batch passed before review.",
            },
          ],
          findings: [],
          evidence: [
            {
              kind: "file_inspection",
              target: "README.md",
              outcome: "passed",
              relevant: true,
              summary: "Reviewed README.md in the attempt worktree.",
              details: "The changed README content matches the ticket intent.",
            },
            {
              kind: "command",
              target: "npm test",
              outcome: "passed",
              relevant: true,
              summary: "Observed the reviewer-selected npm test check pass.",
              details: "The command covers the lightweight repo behavior for this ticket.",
            },
          ],
          changedFilesReviewed: ["README.md"],
        }),
      });
      system.orchestration.setLatestTurnState({
        threadId: reviewCreate.threadId,
        state: "completed",
        completedAt: "2026-04-21T00:00:04.000Z",
      });

      await waitFor(async () => {
        const snapshot = await system.presence
          .getBoardSnapshot({
            boardId: repository.boardId,
          })
          .pipe(Effect.runPromise);
        return (
          snapshot.tickets.find((candidate) => candidate.id === ticket.id)?.status ===
            "ready_to_merge" &&
          snapshot.supervisorRuns.find((candidate) => candidate.id === run.id)?.status ===
            "completed"
        );
      }, 30_000);

      const acceptedSnapshot = await system.presence
        .getBoardSnapshot({
          boardId: repository.boardId,
        })
        .pipe(Effect.runPromise);
      expect(acceptedSnapshot.tickets.find((candidate) => candidate.id === ticket.id)?.status).toBe(
        "ready_to_merge",
      );
      expect(
        acceptedSnapshot.attempts.find((candidate) => candidate.id === attempt.id)?.status,
      ).toBe("accepted");
      expect(
        acceptedSnapshot.supervisorRuns.find((candidate) => candidate.id === run.id)?.status,
      ).toBe("completed");
      expect(acceptedSnapshot.supervisorHandoff?.currentRunId).toBeNull();
      expect(acceptedSnapshot.supervisorHandoff?.stage).toBeNull();
    } finally {
      if (runId) {
        await system.presence
          .cancelSupervisorRun({ runId: SupervisorRunId.make(runId) })
          .pipe(Effect.runPromise)
          .catch(() => undefined);
      }
      if (attemptId) {
        await system.presence
          .cleanupWorkspace({ attemptId: AttemptId.make(attemptId), force: true })
          .pipe(Effect.runPromise)
          .catch(() => undefined);
      }
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  }, 90_000);

  it("blocks the ticket when the review worker settles without a valid structured result", async () => {
    const repoRoot = await createGitRepository("presence-agentic-review-block-");
    const system = await createPresenceSystem();
    let attemptId: string | null = null;

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify(
          { name: "presence-agentic-review-block", scripts: { test: 'node -e "process.exit(0)"' } },
          null,
          2,
        ),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add malformed review evidence scripts"]);

      const repository = await system.presence
        .importRepository({
          workspaceRoot: repoRoot,
          title: "Presence Review Failure Repo",
        })
        .pipe(Effect.runPromise);
      const ticket = await system.presence
        .createTicket({
          boardId: repository.boardId,
          title: "Block malformed review output",
          description:
            "Missing structured review output should block the ticket instead of silently falling back.",
          priority: "p2",
          acceptanceChecklist: [
            { id: "check-1", label: "Mechanism understood", checked: true },
            { id: "check-2", label: "Evidence attached", checked: true },
            { id: "check-3", label: "Reviewer validation captured", checked: true },
          ],
        })
        .pipe(Effect.runPromise);
      const attempt = await system.presence
        .createAttempt({
          ticketId: ticket.id,
        })
        .pipe(Effect.runPromise);
      attemptId = attempt.id;
      const session = await system.presence
        .startAttemptSession({
          attemptId: attempt.id,
        })
        .pipe(Effect.runPromise);

      await system.presence
        .saveWorkerHandoff({
          attemptId: attempt.id,
          completedWork: ["Prepared the attempt for review."],
          currentHypothesis:
            "A malformed review result should block the ticket because the supervisor cannot apply it honestly.",
          changedFiles: ["README.md"],
          testsRun: ["npm test"],
          blockers: [],
          nextStep: "Wait for review.",
          openQuestions: [],
          retryCount: 0,
          evidenceIds: [],
        })
        .pipe(Effect.runPromise);
      system.orchestration.setCheckpoint({
        threadId: session.threadId,
        files: ["README.md"],
        completedAt: "2026-04-21T00:10:01.000Z",
      });
      system.orchestration.setLatestTurnState({
        threadId: session.threadId,
        state: "completed",
        completedAt: "2026-04-21T00:10:02.000Z",
      });
      const run = await system.presence
        .startSupervisorRun({
          boardId: repository.boardId,
          ticketIds: [ticket.id],
        })
        .pipe(Effect.runPromise);

      let reviewCreate: Extract<OrchestrationCommand, { type: "thread.create" }> | undefined;
      await waitFor(async () => {
        reviewCreate = system.commands.find(
          (command): command is Extract<OrchestrationCommand, { type: "thread.create" }> =>
            command.type === "thread.create" && command.title === `${ticket.title} - review`,
        );
        return Boolean(reviewCreate);
      }, 10_000);

      if (!reviewCreate) throw new Error("Expected review thread to exist.");
      system.orchestration.pushAssistantMessage({
        threadId: reviewCreate.threadId,
        updatedAt: "2026-04-21T00:10:03.000Z",
        text: "I inspected the attempt and it looks mostly fine, but this message intentionally omits the structured review result block.",
      });
      system.orchestration.setLatestTurnState({
        threadId: reviewCreate.threadId,
        state: "completed",
        completedAt: "2026-04-21T00:10:04.000Z",
      });

      await waitFor(async () => {
        const snapshot = await system.presence
          .getBoardSnapshot({
            boardId: repository.boardId,
          })
          .pipe(Effect.runPromise);
        return (
          snapshot.tickets.find((candidate) => candidate.id === ticket.id)?.status === "blocked" &&
          snapshot.supervisorRuns.find((candidate) => candidate.id === run.id)?.status ===
            "completed"
        );
      }, 40_000);

      const blockedSnapshot = await system.presence
        .getBoardSnapshot({
          boardId: repository.boardId,
        })
        .pipe(Effect.runPromise);
      expect(blockedSnapshot.tickets.find((candidate) => candidate.id === ticket.id)?.status).toBe(
        "blocked",
      );
      expect(
        blockedSnapshot.supervisorRuns.find((candidate) => candidate.id === run.id)?.status,
      ).toBe("completed");
      expect(
        blockedSnapshot.findings.some(
          (finding) =>
            finding.ticketId === ticket.id &&
            finding.attemptId === attempt.id &&
            finding.source === "supervisor" &&
            finding.status === "open" &&
            finding.summary.includes("valid structured review result"),
        ),
      ).toBe(true);
    } finally {
      if (attemptId) {
        await system.presence
          .cleanupWorkspace({ attemptId: AttemptId.make(attemptId), force: true })
          .pipe(Effect.runPromise)
          .catch(() => undefined);
      }
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  }, 90_000);

  it("retries review kickoff on the same thread when the first review turn never starts", async () => {
    const repoRoot = await createGitRepository("presence-agentic-review-restart-");
    const system = await createPresenceSystem();
    let attemptId: string | null = null;
    let runId: string | null = null;

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify(
          {
            name: "presence-agentic-review-restart",
            scripts: { test: 'node -e "process.exit(0)"' },
          },
          null,
          2,
        ),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add review restart evidence scripts"]);

      const repository = await system.presence
        .importRepository({
          workspaceRoot: repoRoot,
          title: "Presence Review Restart Repo",
        })
        .pipe(Effect.runPromise);
      const ticket = await system.presence
        .createTicket({
          boardId: repository.boardId,
          title: "Restart partial review startup",
          description:
            "A review thread that never starts should be restarted instead of leaving the supervisor stuck.",
          priority: "p2",
          acceptanceChecklist: [
            { id: "check-1", label: "Mechanism understood", checked: true },
            { id: "check-2", label: "Evidence attached", checked: true },
            { id: "check-3", label: "Reviewer validation captured", checked: true },
          ],
        })
        .pipe(Effect.runPromise);
      const attempt = await system.presence
        .createAttempt({
          ticketId: ticket.id,
        })
        .pipe(Effect.runPromise);
      attemptId = attempt.id;
      const session = await system.presence
        .startAttemptSession({
          attemptId: attempt.id,
        })
        .pipe(Effect.runPromise);

      await fs.writeFile(
        path.join(repoRoot, "README.md"),
        "# Presence Test\nreview restart\n",
        "utf8",
      );
      await system.presence
        .saveWorkerHandoff({
          attemptId: attempt.id,
          completedWork: ["Prepared the attempt for an agentic review restart scenario."],
          currentHypothesis:
            "The supervisor should recover when review startup fails before the first review turn exists.",
          changedFiles: ["README.md"],
          testsRun: ["npm test"],
          blockers: [],
          nextStep: "Wait for review restart.",
          openQuestions: [],
          retryCount: 0,
          evidenceIds: [],
        })
        .pipe(Effect.runPromise);
      system.orchestration.setCheckpoint({
        threadId: session.threadId,
        files: ["README.md"],
        completedAt: "2026-04-21T00:20:01.000Z",
      });
      system.orchestration.setLatestTurnState({
        threadId: session.threadId,
        state: "completed",
        completedAt: "2026-04-21T00:20:02.000Z",
      });
      system.orchestration.failNextDispatch(
        "thread.turn.start",
        "simulated review kickoff failure",
      );

      const run = await system.presence
        .startSupervisorRun({
          boardId: repository.boardId,
          ticketIds: [ticket.id],
        })
        .pipe(Effect.runPromise);
      runId = run.id;

      let reviewCreates: Array<Extract<OrchestrationCommand, { type: "thread.create" }>> = [];
      await waitFor(async () => {
        reviewCreates = system.commands.filter(
          (command): command is Extract<OrchestrationCommand, { type: "thread.create" }> =>
            command.type === "thread.create" && command.title === `${ticket.title} - review`,
        );
        return reviewCreates.length >= 1;
      }, 20_000);

      const reviewThread = reviewCreates[0];
      if (!reviewThread) throw new Error("Expected review thread.");
      await waitFor(async () => {
        return system.commands.some(
          (command): command is Extract<OrchestrationCommand, { type: "thread.turn.start" }> =>
            command.type === "thread.turn.start" && command.threadId === reviewThread.threadId,
        );
      }, 20_000);
      system.orchestration.pushAssistantMessage({
        threadId: reviewThread.threadId,
        updatedAt: "2026-04-21T00:20:05.000Z",
        text: buildReviewResultBlock({
          decision: "accept",
          summary:
            "The retried review completed successfully after the first kickoff never started.",
          checklistAssessment: [
            {
              label: "Mechanism understood",
              satisfied: true,
              notes: "The restarted reviewer confirmed the intended mechanism.",
            },
            {
              label: "Evidence attached",
              satisfied: true,
              notes: "The restart still had access to the worker evidence and changed files.",
            },
            {
              label: "Reviewer validation captured",
              satisfied: true,
              notes: "The passing validation batch was preserved across the restart.",
            },
          ],
          findings: [],
          evidence: [
            {
              kind: "file_inspection",
              target: "README.md",
              outcome: "passed",
              relevant: true,
              summary: "Reviewed README.md after restarting the review kickoff.",
              details: "The restarted reviewer verified the same changed file.",
            },
          ],
          changedFilesReviewed: ["README.md"],
        }),
      });
      system.orchestration.setLatestTurnState({
        threadId: reviewThread.threadId,
        state: "completed",
        completedAt: "2026-04-21T00:20:06.000Z",
      });

      await waitFor(async () => {
        const snapshot = await system.presence
          .getBoardSnapshot({
            boardId: repository.boardId,
          })
          .pipe(Effect.runPromise);
        return (
          snapshot.tickets.find((candidate) => candidate.id === ticket.id)?.status ===
          "ready_to_merge"
        );
      }, 20_000);

      const acceptedSnapshot = await system.presence
        .getBoardSnapshot({
          boardId: repository.boardId,
        })
        .pipe(Effect.runPromise);
      expect(acceptedSnapshot.tickets.find((candidate) => candidate.id === ticket.id)?.status).toBe(
        "ready_to_merge",
      );
      expect(reviewCreates).toHaveLength(1);
    } finally {
      if (runId) {
        await system.presence
          .cancelSupervisorRun({ runId: SupervisorRunId.make(runId) })
          .pipe(Effect.runPromise)
          .catch(() => undefined);
      }
      if (attemptId) {
        await system.presence
          .cleanupWorkspace({ attemptId: AttemptId.make(attemptId), force: true })
          .pipe(Effect.runPromise)
          .catch(() => undefined);
      }
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  }, 40_000);

  it("prefers a structured tool review result over a conflicting assistant block", async () => {
    const repoRoot = await createGitRepository("presence-review-reconcile-");
    const system = await createPresenceSystem();
    let attemptId: string | null = null;

    try {
      const repository = await system.presence
        .importRepository({
          workspaceRoot: repoRoot,
          title: "Presence Review Reconcile Repo",
        })
        .pipe(Effect.runPromise);
      if (!repository.projectId) {
        throw new Error("Imported repository did not create an orchestration project.");
      }
      const projectId = repository.projectId;
      const ticket = await system.presence
        .createTicket({
          boardId: repository.boardId,
          title: "Reconcile completed review",
          description:
            "The supervisor should ingest a completed review result even after a premature blocker.",
          priority: "p2",
          acceptanceChecklist: [
            { id: "check-1", label: "Mechanism understood", checked: true },
            { id: "check-2", label: "Evidence attached", checked: true },
            { id: "check-3", label: "Reviewer validation captured", checked: true },
          ],
        })
        .pipe(Effect.runPromise);
      const attempt = await system.presence
        .createAttempt({
          ticketId: ticket.id,
        })
        .pipe(Effect.runPromise);
      attemptId = attempt.id;
      const session = await system.presence
        .startAttemptSession({
          attemptId: attempt.id,
        })
        .pipe(Effect.runPromise);
      await fs.writeFile(
        path.join(repoRoot, "README.md"),
        "# Presence Test\nneeds follow-up\n",
        "utf8",
      );
      await system.presence
        .saveWorkerHandoff({
          attemptId: attempt.id,
          completedWork: ["Prepared a doc change that needs reviewer feedback."],
          currentHypothesis: "Reviewer feedback should be routed back to the worker.",
          changedFiles: ["README.md"],
          testsRun: ["git diff --check"],
          blockers: [],
          nextStep: "Wait for review.",
          openQuestions: [],
          retryCount: 0,
          evidenceIds: [],
        })
        .pipe(Effect.runPromise);
      system.orchestration.setCheckpoint({
        threadId: session.threadId,
        files: ["README.md"],
        completedAt: "2026-04-21T00:30:01.000Z",
      });
      system.orchestration.setLatestTurnState({
        threadId: session.threadId,
        state: "completed",
        completedAt: "2026-04-21T00:30:02.000Z",
      });

      const reviewThreadId = ThreadId.make("presence_review_thread_reconcile_test");
      const reviewTurnStartedAt = "2026-04-21T00:30:03.000Z";
      const reviewTurnCompletedAt = "2026-04-21T00:30:04.000Z";
      await system.orchestration.service
        .dispatch({
          type: "thread.create",
          commandId: CommandId.make("presence_review_reconcile_thread_create"),
          threadId: reviewThreadId,
          projectId: ProjectId.make(projectId),
          title: `${ticket.title} - review`,
          systemPrompt: "Presence review worker role",
          modelSelection: { provider: "codex", model: "gpt-5.4" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: repoRoot,
          createdAt: reviewTurnStartedAt,
        })
        .pipe(Effect.runPromise);
      await system.orchestration.service
        .dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make("presence_review_reconcile_turn_start"),
          threadId: reviewThreadId,
          message: {
            messageId: MessageId.make("presence_review_reconcile_message"),
            role: "user",
            text: "Review this completed attempt.",
            attachments: [],
          },
          modelSelection: { provider: "codex", model: "gpt-5.4" },
          titleSeed: "Reconcile completed review",
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt: reviewTurnStartedAt,
        })
        .pipe(Effect.runPromise);
      system.orchestration.pushAssistantMessage({
        threadId: reviewThreadId,
        updatedAt: reviewTurnCompletedAt,
        text: buildReviewResultBlock({
          decision: "request_changes",
          summary: "The attempt needs one concrete follow-up before approval.",
          checklistAssessment: [
            { label: "Mechanism understood", satisfied: true, notes: "The mechanism is clear." },
            { label: "Evidence attached", satisfied: true, notes: "Reviewer inspected README.md." },
            {
              label: "Reviewer validation captured",
              satisfied: true,
              notes: "The completed reviewer result is structured.",
            },
          ],
          findings: [
            {
              severity: "blocking",
              disposition: "same_ticket",
              summary: "README.md still needs the requested detail.",
              rationale: "The reviewed file does not include the detail requested by the ticket.",
            },
          ],
          evidence: [
            {
              kind: "file_inspection",
              target: "README.md",
              outcome: "failed",
              relevant: true,
              summary: "Reviewed README.md and found the missing detail.",
              details: "The requested detail is absent.",
            },
          ],
          changedFilesReviewed: ["README.md"],
        }),
      });
      const structuredReviewResult = buildPresenceToolBridgeReport(
        {
          eventId: EventId.make("presence_review_reconcile_tool_event"),
          provider: "codex",
          threadId: reviewThreadId,
          createdAt: reviewTurnCompletedAt,
          itemId: RuntimeItemId.make("presence_review_reconcile_tool_item"),
          type: "item.completed",
          payload: {
            itemType: "dynamic_tool_call",
            status: "completed",
            title: "presence.submit_review_result",
            data: {
              tool: "presence.submit_review_result",
              state: {
                input: {
                  decision: "accept",
                  summary: "The structured tool result accepts the completed attempt.",
                  checklistAssessment: [
                    {
                      label: "Mechanism understood",
                      satisfied: true,
                      notes: "The review tool inspected the intended change.",
                    },
                    {
                      label: "Evidence attached",
                      satisfied: true,
                      notes: "The review tool attached relevant file inspection evidence.",
                    },
                    {
                      label: "Reviewer validation captured",
                      satisfied: true,
                      notes: "The canonical structured result came from the Presence tool.",
                    },
                  ],
                  findings: [],
                  evidence: [
                    {
                      kind: "file_inspection",
                      target: "README.md",
                      outcome: "passed",
                      relevant: true,
                      summary: "Reviewed README.md and verified the requested detail.",
                      details: "The structured tool result should win over the stale block.",
                    },
                  ],
                  changedFilesReviewed: ["README.md"],
                },
              },
            },
          },
        } satisfies ProviderRuntimeEvent,
        {
          role: "review",
          boardId: repository.boardId,
          ticketId: ticket.id,
          attemptId: attempt.id,
          reviewArtifactId: null,
          supervisorRunId: null,
        },
      );
      expect(structuredReviewResult._tag).toBe("record");
      if (structuredReviewResult._tag !== "record") {
        throw new Error("Expected structured review tool result to produce a mission event.");
      }
      const structuredReviewInput = structuredReviewResult.input;
      await system.sql`
        INSERT INTO presence_mission_events (
          mission_event_id, board_id, ticket_id, attempt_id, review_artifact_id,
          supervisor_run_id, thread_id, kind, severity, summary, detail,
          retry_behavior, human_action, dedupe_key, report_json, created_at
        ) VALUES (
          ${"mission_event_reconcile_structured_review_result"},
          ${repository.boardId},
          ${ticket.id},
          ${attempt.id},
          ${null},
          ${null},
          ${reviewThreadId},
          ${structuredReviewInput.kind},
          ${structuredReviewInput.severity ?? "info"},
          ${structuredReviewInput.summary},
          ${structuredReviewInput.detail ?? null},
          ${structuredReviewInput.retryBehavior ?? "not_applicable"},
          ${structuredReviewInput.humanAction ?? null},
          ${structuredReviewInput.dedupeKey},
          ${JSON.stringify(structuredReviewInput.report)},
          ${structuredReviewInput.createdAt ?? reviewTurnCompletedAt}
        )
      `.pipe(Effect.runPromise);
      system.orchestration.setLatestTurnState({
        threadId: reviewThreadId,
        state: "completed",
        completedAt: reviewTurnCompletedAt,
      });
      await system.sql`
        INSERT OR IGNORE INTO projection_threads (
          thread_id, project_id, title, model_selection_json, branch, worktree_path,
          latest_turn_id, created_at, updated_at, archived_at, latest_user_message_at,
          pending_approval_count, pending_user_input_count, has_actionable_proposed_plan,
          deleted_at, runtime_mode, interaction_mode
        ) VALUES (
          ${reviewThreadId},
          ${projectId},
          ${`${ticket.title} - review`},
          ${JSON.stringify({ provider: "codex", model: "gpt-5.4" })},
          ${null},
          ${repoRoot},
          ${null},
          ${reviewTurnStartedAt},
          ${reviewTurnCompletedAt},
          ${null},
          ${null},
          ${0},
          ${0},
          ${0},
          ${null},
          ${"full-access"},
          ${"default"}
        )
      `.pipe(Effect.runPromise);
      await system.sql`
        INSERT INTO presence_mission_events (
          mission_event_id, board_id, ticket_id, attempt_id, review_artifact_id,
          supervisor_run_id, thread_id, kind, severity, summary, detail,
          retry_behavior, human_action, dedupe_key, report_json, created_at
        ) VALUES (
          ${"mission_event_reconcile_review_completed"},
          ${repository.boardId},
          ${ticket.id},
          ${attempt.id},
          ${null},
          ${null},
          ${reviewThreadId},
          ${"turn_completed"},
          ${"success"},
          ${"Reviewer turn completed."},
          ${null},
          ${"not_applicable"},
          ${null},
          ${"runtime:reconcile-review-completed"},
          ${null},
          ${reviewTurnCompletedAt}
        )
      `.pipe(Effect.runPromise);
      await system.presence
        .updateTicket({
          ticketId: ticket.id,
          status: "blocked",
        })
        .pipe(Effect.runPromise);
      const seededSnapshot = await system.presence
        .getBoardSnapshot({
          boardId: repository.boardId,
        })
        .pipe(Effect.runPromise);
      expect(
        seededSnapshot.missionEvents.some(
          (event) => event.threadId === reviewThreadId && event.kind === "turn_completed",
        ),
      ).toBe(true);

      await system.presence
        .startSupervisorRun({
          boardId: repository.boardId,
          ticketIds: [ticket.id],
        })
        .pipe(Effect.runPromise);

      await waitFor(async () => {
        const snapshot = await system.presence
          .getBoardSnapshot({
            boardId: repository.boardId,
          })
          .pipe(Effect.runPromise);
        return snapshot.reviewArtifacts.some((artifact) => artifact.threadId === reviewThreadId);
      }, 30_000);

      const reconciledSnapshot = await system.presence
        .getBoardSnapshot({
          boardId: repository.boardId,
        })
        .pipe(Effect.runPromise);
      expect(
        reconciledSnapshot.reviewArtifacts.some((artifact) => artifact.threadId === reviewThreadId),
      ).toBe(true);
      expect(
        reconciledSnapshot.tickets.find((candidate) => candidate.id === ticket.id)?.status,
      ).toBe("ready_to_merge");
      expect(
        reconciledSnapshot.attempts.find((candidate) => candidate.id === attempt.id)?.status,
      ).toBe("accepted");
      expect(
        reconciledSnapshot.findings.some(
          (finding) =>
            finding.ticketId === ticket.id &&
            finding.source === "review" &&
            finding.summary.includes("README.md still needs"),
        ),
      ).toBe(false);
    } finally {
      if (attemptId) {
        await system.presence
          .cleanupWorkspace({ attemptId: AttemptId.make(attemptId), force: true })
          .pipe(Effect.runPromise)
          .catch(() => undefined);
      }
      await system.dispose();
      await removeTempRepo(repoRoot);
    }
  }, 60_000);
});
