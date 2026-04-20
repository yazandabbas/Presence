import {
  AgentSessionRecord,
  AttemptId,
  type AttemptRecord,
  type AttemptSummary,
  BoardId,
  type BoardRecord,
  BoardSnapshot,
  CommandId,
  DEFAULT_PRESENCE_RESUME_PROTOCOL,
  type DeterministicJobRecord,
  DeterministicJobId,
  EvidenceId,
  type KnowledgePageRecord,
  KnowledgePageId,
  type ModelSelection,
  PresenceAttachThreadInput,
  PresenceCreateAttemptInput,
  PresenceCreateDeterministicJobInput,
  PresenceCreatePromotionCandidateInput,
  PresenceCreateTicketInput,
  PresenceGetBoardSnapshotInput,
  PresenceImportRepositoryInput,
  PresenceListRepositoriesInput,
  PresencePromotionStatus,
  PresenceReviewDecisionKind,
  PresenceReviewPromotionCandidateInput,
  PresenceRpcError,
  PresenceSaveAttemptEvidenceInput,
  PresenceSaveSupervisorHandoffInput,
  PresenceSaveWorkerHandoffInput,
  PresenceStartAttemptSessionInput,
  PresenceAttemptStatus,
  PresenceJobStatus,
  PresenceKnowledgeFamily,
  PresenceTicketPriority,
  PresenceSubmitReviewDecisionInput,
  PresenceTicketStatus,
  PresenceUpdateTicketInput,
  PresenceUpsertKnowledgePageInput,
  PresenceWorkspaceStatus,
  ProviderKind,
  type PromotionCandidateRecord,
  PromotionCandidateId,
  ProjectId,
  RepositoryId,
  type RepositorySummary,
  ReviewDecisionId,
  type ReviewDecisionRecord,
  type SupervisorHandoffRecord,
  ThreadId,
  TicketId,
  type TicketRecord,
  type WorkspaceRecord,
  WorkspaceId,
  type WorkerHandoffRecord,
  HandoffId,
  type AttemptEvidenceRecord,
} from "@t3tools/contracts";
import { Effect, Layer, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { PresenceControlPlane, type PresenceControlPlaneShape } from "../Services/PresenceControlPlane.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const encodeJson = (value: unknown) => JSON.stringify(value);

function decodeJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function presenceError(message: string, cause?: unknown) {
  return new PresenceRpcError({ message, ...(cause !== undefined ? { cause } : {}) });
}

function makeId<T extends { make: (value: string) => any }>(schema: T, prefix: string) {
  return schema.make(`${prefix}_${crypto.randomUUID()}`);
}

function titleFromPath(workspaceRoot: string): string {
  const normalized = workspaceRoot.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/);
  return parts.at(-1) || workspaceRoot;
}

function chooseDefaultModelSelection(
  providers: ReadonlyArray<{
    provider: string;
    enabled: boolean;
    installed: boolean;
    status: string;
    models: ReadonlyArray<{ slug: string }>;
  }>,
): ModelSelection | null {
  const preferredProviders = ["codex", "claudeAgent"];
  for (const providerName of preferredProviders) {
    const provider = providers.find(
      (candidate) =>
        candidate.provider === providerName &&
        candidate.enabled &&
        candidate.installed &&
        candidate.status !== "error" &&
        candidate.models.length > 0,
    );
    if (!provider) continue;
    if (provider.provider === "codex") {
      return {
        provider: "codex",
        model: provider.models[0]!.slug,
      };
    }
    if (provider.provider === "claudeAgent") {
      return {
        provider: "claudeAgent",
        model: provider.models[0]!.slug,
      };
    }
  }
  return null;
}

const makePresenceControlPlane = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerRegistry = yield* ProviderRegistry;

  const readRepositoryByWorkspaceRoot = (workspaceRoot: string) =>
    sql<{
      id: string;
      boardId: string;
      projectId: string | null;
      title: string;
      workspaceRoot: string;
      defaultModelSelection: string | null;
      createdAt: string;
      updatedAt: string;
    }>`
      SELECT
        repository_id as id,
        board_id as "boardId",
        project_id as "projectId",
        title,
        workspace_root as "workspaceRoot",
        default_model_selection_json as "defaultModelSelection",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM presence_repositories
      WHERE workspace_root = ${workspaceRoot}
    `.pipe(Effect.map((rows) => rows[0] ?? null));

  const mapRepository = (row: {
    id: string;
    boardId: string;
    projectId: string | null;
    title: string;
    workspaceRoot: string;
    defaultModelSelection: string | null;
    createdAt: string;
    updatedAt: string;
  }): RepositorySummary => ({
    id: RepositoryId.make(row.id),
    boardId: BoardId.make(row.boardId),
    projectId: row.projectId ? ProjectId.make(row.projectId) : null,
    title: row.title,
    workspaceRoot: row.workspaceRoot,
    defaultModelSelection: decodeJson<ModelSelection | null>(row.defaultModelSelection, null),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const mapBoard = (row: {
    id: string;
    repositoryId: string;
    title: string;
    sprintFocus: string | null;
    topPrioritySummary: string | null;
    createdAt: string;
    updatedAt: string;
  }): BoardRecord => ({
    id: BoardId.make(row.id),
    repositoryId: RepositoryId.make(row.repositoryId),
    title: row.title,
    sprintFocus: row.sprintFocus,
    topPrioritySummary: row.topPrioritySummary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const mapTicket = (row: {
    id: string;
    boardId: string;
    parentTicketId: string | null;
    title: string;
    description: string;
    status: typeof PresenceTicketStatus.Type;
    priority: string;
    acceptanceChecklist: string;
    assignedAttemptId: string | null;
    createdAt: string;
    updatedAt: string;
  }): TicketRecord => ({
    id: TicketId.make(row.id),
    boardId: BoardId.make(row.boardId),
    parentTicketId: row.parentTicketId ? TicketId.make(row.parentTicketId) : null,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: Schema.decodeSync(PresenceTicketPriority)(row.priority as never),
    acceptanceChecklist: decodeJson(row.acceptanceChecklist, []),
    assignedAttemptId: row.assignedAttemptId ? AttemptId.make(row.assignedAttemptId) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const mapAttempt = (row: {
    id: string;
    ticketId: string;
    workspaceId: string | null;
    title: string;
    status: string;
    provider: string | null;
    model: string | null;
    threadId: string | null;
    summary: string | null;
    confidence: number | null;
    lastWorkerHandoffId: string | null;
    createdAt: string;
    updatedAt: string;
  }): AttemptRecord => ({
    id: AttemptId.make(row.id),
    ticketId: TicketId.make(row.ticketId),
    workspaceId: row.workspaceId ? WorkspaceId.make(row.workspaceId) : null,
    title: row.title,
    status: Schema.decodeSync(PresenceAttemptStatus)(row.status as never),
    provider: row.provider ? Schema.decodeSync(ProviderKind)(row.provider as never) : null,
    model: row.model,
    threadId: row.threadId ? ThreadId.make(row.threadId) : null,
    summary: row.summary,
    confidence: row.confidence,
    lastWorkerHandoffId: row.lastWorkerHandoffId ? HandoffId.make(row.lastWorkerHandoffId) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const mapWorkspace = (row: {
    id: string;
    attemptId: string;
    status: string;
    branch: string | null;
    worktreePath: string | null;
    createdAt: string;
    updatedAt: string;
  }): WorkspaceRecord => ({
    id: WorkspaceId.make(row.id),
    attemptId: AttemptId.make(row.attemptId),
    status: Schema.decodeSync(PresenceWorkspaceStatus)(row.status as never),
    branch: row.branch,
    worktreePath: row.worktreePath,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const mapSupervisorHandoff = (row: {
    id: string;
    boardId: string;
    payload: string;
    createdAt: string;
  }): SupervisorHandoffRecord => {
    const payload = decodeJson<{
      topPriorities: string[];
      activeAttemptIds: string[];
      blockedTicketIds: string[];
      recentDecisions: string[];
      nextBoardActions: string[];
    }>(row.payload, {
      topPriorities: [],
      activeAttemptIds: [],
      blockedTicketIds: [],
      recentDecisions: [],
      nextBoardActions: [],
    });
    return {
      id: HandoffId.make(row.id),
      boardId: BoardId.make(row.boardId),
      topPriorities: payload.topPriorities,
      activeAttemptIds: payload.activeAttemptIds.map((value) => AttemptId.make(value)),
      blockedTicketIds: payload.blockedTicketIds.map((value) => TicketId.make(value)),
      recentDecisions: payload.recentDecisions,
      nextBoardActions: payload.nextBoardActions,
      createdAt: row.createdAt,
    };
  };

  const mapWorkerHandoff = (row: {
    id: string;
    attemptId: string;
    payload: string;
    createdAt: string;
  }): WorkerHandoffRecord => {
    const payload = decodeJson<{
      completedWork: string[];
      currentHypothesis: string | null;
      changedFiles: string[];
      testsRun: string[];
      blockers: string[];
      nextStep: string | null;
      confidence: number | null;
      evidenceIds: string[];
    }>(row.payload, {
      completedWork: [],
      currentHypothesis: null,
      changedFiles: [],
      testsRun: [],
      blockers: [],
      nextStep: null,
      confidence: null,
      evidenceIds: [],
    });
    return {
      id: HandoffId.make(row.id),
      attemptId: AttemptId.make(row.attemptId),
      completedWork: payload.completedWork,
      currentHypothesis: payload.currentHypothesis,
      changedFiles: payload.changedFiles,
      testsRun: payload.testsRun,
      blockers: payload.blockers,
      nextStep: payload.nextStep,
      confidence: payload.confidence,
      evidenceIds: payload.evidenceIds.map((value) => EvidenceId.make(value)),
      createdAt: row.createdAt,
    };
  };

  const mapEvidence = (row: {
    id: string;
    attemptId: string;
    title: string;
    kind: string;
    content: string;
    createdAt: string;
  }): AttemptEvidenceRecord => ({
    id: EvidenceId.make(row.id),
    attemptId: AttemptId.make(row.attemptId),
    title: row.title,
    kind: row.kind,
    content: row.content,
    createdAt: row.createdAt,
  });

  const mapKnowledgePage = (row: {
    id: string;
    boardId: string;
    family: string;
    slug: string;
    title: string;
    compiledTruth: string;
    timeline: string;
    linkedTicketIds: string;
    createdAt: string;
    updatedAt: string;
  }): KnowledgePageRecord => ({
    id: KnowledgePageId.make(row.id),
    boardId: BoardId.make(row.boardId),
    family: Schema.decodeSync(PresenceKnowledgeFamily)(row.family as never),
    slug: row.slug,
    title: row.title,
    compiledTruth: row.compiledTruth,
    timeline: row.timeline,
    linkedTicketIds: decodeJson<string[]>(row.linkedTicketIds, []).map((value) => TicketId.make(value)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const mapPromotionCandidate = (row: {
    id: string;
    sourceTicketId: string;
    sourceAttemptId: string | null;
    family: string;
    title: string;
    slug: string;
    compiledTruth: string;
    timelineEntry: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }): PromotionCandidateRecord => ({
    id: PromotionCandidateId.make(row.id),
    sourceTicketId: TicketId.make(row.sourceTicketId),
    sourceAttemptId: row.sourceAttemptId ? AttemptId.make(row.sourceAttemptId) : null,
    family: Schema.decodeSync(PresenceKnowledgeFamily)(row.family as never),
    title: row.title,
    slug: row.slug,
    compiledTruth: row.compiledTruth,
    timelineEntry: row.timelineEntry,
    status: Schema.decodeSync(PresencePromotionStatus)(row.status as never),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const mapJob = (row: {
    id: string;
    boardId: string;
    title: string;
    kind: string;
    status: string;
    progress: number;
    outputSummary: string | null;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string;
  }): DeterministicJobRecord => ({
    id: DeterministicJobId.make(row.id),
    boardId: BoardId.make(row.boardId),
    title: row.title,
    kind: row.kind,
    status: Schema.decodeSync(PresenceJobStatus)(row.status as never),
    progress: row.progress,
    outputSummary: row.outputSummary,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const mapReviewDecision = (row: {
    id: string;
    ticketId: string;
    attemptId: string | null;
    decision: string;
    notes: string;
    createdAt: string;
  }): ReviewDecisionRecord => ({
    id: ReviewDecisionId.make(row.id),
    ticketId: TicketId.make(row.ticketId),
    attemptId: row.attemptId ? AttemptId.make(row.attemptId) : null,
    decision: Schema.decodeSync(PresenceReviewDecisionKind)(row.decision as never),
    notes: row.notes,
    createdAt: row.createdAt,
  });

  const getBoardSnapshotInternal = (boardId: string) =>
    Effect.gen(function* () {
      const repositoryRow = yield* sql<{
        id: string;
        boardId: string;
        projectId: string | null;
        title: string;
        workspaceRoot: string;
        defaultModelSelection: string | null;
        createdAt: string;
        updatedAt: string;
      }>`
        SELECT
          repository_id as id,
          board_id as "boardId",
          project_id as "projectId",
          title,
          workspace_root as "workspaceRoot",
          default_model_selection_json as "defaultModelSelection",
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM presence_repositories
        WHERE board_id = ${boardId}
      `.pipe(Effect.map((rows) => rows[0] ?? null));
      if (!repositoryRow) {
        return yield* Effect.fail(presenceError(`Board '${boardId}' not found.`));
      }

      const boardRow = yield* sql<{
        id: string;
        repositoryId: string;
        title: string;
        sprintFocus: string | null;
        topPrioritySummary: string | null;
        createdAt: string;
        updatedAt: string;
      }>`
        SELECT
          board_id as id,
          repository_id as "repositoryId",
          title,
          sprint_focus as "sprintFocus",
          top_priority_summary as "topPrioritySummary",
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM presence_boards
        WHERE board_id = ${boardId}
      `.pipe(Effect.map((rows) => rows[0] ?? null));
      if (!boardRow) {
        return yield* Effect.fail(presenceError(`Board '${boardId}' is missing its record.`));
      }

      const [ticketRows, dependencyRows, attemptRows, workspaceRows, supervisorRows, workerRows, evidenceRows, knowledgeRows, promotionRows, jobRows, reviewRows] =
        yield* Effect.all([
          sql<any>`SELECT
              ticket_id as id, board_id as "boardId", parent_ticket_id as "parentTicketId",
              title, description, status, priority,
              acceptance_checklist_json as "acceptanceChecklist",
              assigned_attempt_id as "assignedAttemptId",
              created_at as "createdAt", updated_at as "updatedAt"
            FROM presence_tickets
            WHERE board_id = ${boardId}
            ORDER BY updated_at DESC, created_at DESC`,
          sql<any>`SELECT
              ticket_id as "ticketId",
              depends_on_ticket_id as "dependsOnTicketId"
            FROM presence_ticket_dependencies
            WHERE ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})`,
          sql<any>`SELECT
              attempt_id as id, ticket_id as "ticketId", workspace_id as "workspaceId",
              title, status, provider, model, thread_id as "threadId", summary, confidence,
              last_worker_handoff_id as "lastWorkerHandoffId",
              created_at as "createdAt", updated_at as "updatedAt"
            FROM presence_attempts
            WHERE ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
            ORDER BY created_at DESC`,
          sql<any>`SELECT
              workspace_id as id, attempt_id as "attemptId", status, branch,
              worktree_path as "worktreePath", created_at as "createdAt", updated_at as "updatedAt"
            FROM presence_workspaces
            WHERE attempt_id IN (
              SELECT attempt_id FROM presence_attempts
              WHERE ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
            )`,
          sql<any>`SELECT
              handoff_id as id, board_id as "boardId", payload_json as payload, created_at as "createdAt"
            FROM presence_handoffs
            WHERE board_id = ${boardId} AND role = 'supervisor'
            ORDER BY created_at DESC
            LIMIT 1`,
          sql<any>`SELECT
              handoff_id as id, attempt_id as "attemptId", payload_json as payload, created_at as "createdAt"
            FROM presence_handoffs
            WHERE attempt_id IN (
              SELECT attempt_id FROM presence_attempts
              WHERE ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
            ) AND role = 'worker'
            ORDER BY created_at DESC`,
          sql<any>`SELECT
              evidence_id as id, attempt_id as "attemptId", title, kind, content, created_at as "createdAt"
            FROM presence_attempt_evidence
            WHERE attempt_id IN (
              SELECT attempt_id FROM presence_attempts
              WHERE ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
            )
            ORDER BY created_at DESC`,
          sql<any>`SELECT
              knowledge_page_id as id, board_id as "boardId", family, slug, title,
              compiled_truth as "compiledTruth", timeline, linked_ticket_ids_json as "linkedTicketIds",
              created_at as "createdAt", updated_at as "updatedAt"
            FROM presence_knowledge_pages
            WHERE board_id = ${boardId}
            ORDER BY updated_at DESC`,
          sql<any>`SELECT
              promotion_candidate_id as id, source_ticket_id as "sourceTicketId",
              source_attempt_id as "sourceAttemptId", family, title, slug, compiled_truth as "compiledTruth",
              timeline_entry as "timelineEntry", status, created_at as "createdAt", updated_at as "updatedAt"
            FROM presence_promotion_candidates
            WHERE source_ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
            ORDER BY updated_at DESC`,
          sql<any>`SELECT
              deterministic_job_id as id, board_id as "boardId", title, kind, status, progress,
              output_summary as "outputSummary", error_message as "errorMessage",
              created_at as "createdAt", updated_at as "updatedAt"
            FROM presence_deterministic_jobs
            WHERE board_id = ${boardId}
            ORDER BY updated_at DESC`,
          sql<any>`SELECT
              review_decision_id as id, ticket_id as "ticketId", attempt_id as "attemptId",
              decision, notes, created_at as "createdAt"
            FROM presence_review_decisions
            WHERE ticket_id IN (SELECT ticket_id FROM presence_tickets WHERE board_id = ${boardId})
            ORDER BY created_at DESC`,
        ]);

      const attempts = attemptRows.map(mapAttempt);
      const workspaces = workspaceRows.map(mapWorkspace);
      const latestWorkerHandoffByAttemptId = new Map<string, WorkerHandoffRecord>();
      for (const row of workerRows) {
        if (!latestWorkerHandoffByAttemptId.has(row.attemptId)) {
          latestWorkerHandoffByAttemptId.set(row.attemptId, mapWorkerHandoff(row));
        }
      }
      const workspaceByAttemptId = new Map(workspaces.map((workspace) => [workspace.attemptId, workspace]));

      const attemptSummaries: AttemptSummary[] = attempts.map((attempt) => ({
        attempt,
        workspace: workspaceByAttemptId.get(attempt.id) ?? null,
        latestWorkerHandoff: latestWorkerHandoffByAttemptId.get(attempt.id) ?? null,
      }));

      return {
        repository: mapRepository(repositoryRow),
        board: mapBoard(boardRow),
        tickets: ticketRows.map(mapTicket),
        dependencies: dependencyRows.map((row: any) => ({
          ticketId: TicketId.make(row.ticketId),
          dependsOnTicketId: TicketId.make(row.dependsOnTicketId),
        })),
        attempts,
        workspaces,
        attemptSummaries,
        supervisorHandoff: supervisorRows[0] ? mapSupervisorHandoff(supervisorRows[0]) : null,
        evidence: evidenceRows.map(mapEvidence),
        promotionCandidates: promotionRows.map(mapPromotionCandidate),
        knowledgePages: knowledgeRows.map(mapKnowledgePage),
        jobs: jobRows.map(mapJob),
        reviewDecisions: reviewRows.map(mapReviewDecision),
      } satisfies BoardSnapshot;
    });

  const listRepositories: PresenceControlPlaneShape["listRepositories"] = () =>
    sql<any>`
      SELECT
        repository_id as id,
        board_id as "boardId",
        project_id as "projectId",
        title,
        workspace_root as "workspaceRoot",
        default_model_selection_json as "defaultModelSelection",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM presence_repositories
      ORDER BY updated_at DESC, created_at DESC
    `.pipe(
      Effect.map((rows) => rows.map(mapRepository)),
      Effect.catch((cause) => Effect.fail(presenceError("Failed to list repositories.", cause))),
    );

  const importRepository: PresenceControlPlaneShape["importRepository"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* readRepositoryByWorkspaceRoot(input.workspaceRoot);
      if (existing) {
        return mapRepository(existing);
      }

      const currentReadModel = yield* orchestrationEngine.getReadModel();
      const existingProject = currentReadModel.projects.find(
        (project) => project.workspaceRoot === input.workspaceRoot,
      );
      const providers = yield* providerRegistry.getProviders;
      const defaultModelSelection =
        existingProject?.defaultModelSelection ?? chooseDefaultModelSelection(providers);
      const projectId =
        existingProject?.id ?? ProjectId.make(`presence_project_${crypto.randomUUID()}`);
      const title = input.title ?? titleFromPath(input.workspaceRoot);
      const createdAt = nowIso();

      if (!existingProject) {
        yield* orchestrationEngine.dispatch({
          type: "project.create",
          commandId: CommandId.make(`presence_project_create_${crypto.randomUUID()}`),
          projectId,
          title,
          workspaceRoot: input.workspaceRoot,
          defaultModelSelection,
          createdAt,
        });
      }

      const repositoryId = makeId(RepositoryId, "repository");
      const boardId = makeId(BoardId, "board");
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO presence_repositories (
              repository_id, board_id, project_id, title, workspace_root,
              default_model_selection_json, created_at, updated_at
            ) VALUES (
              ${repositoryId},
              ${boardId},
              ${projectId},
              ${title},
              ${input.workspaceRoot},
              ${encodeJson(defaultModelSelection)},
              ${createdAt},
              ${createdAt}
            )
          `;
          yield* sql`
            INSERT INTO presence_boards (
              board_id, repository_id, title, sprint_focus, top_priority_summary, created_at, updated_at
            ) VALUES (
              ${boardId},
              ${repositoryId},
              ${title},
              ${null},
              ${"Establish the first trustworthy supervisor-managed loop."},
              ${createdAt},
              ${createdAt}
            )
          `;
        }),
      );

      return {
        id: repositoryId,
        boardId,
        projectId,
        title,
        workspaceRoot: input.workspaceRoot,
        defaultModelSelection,
        createdAt,
        updatedAt: createdAt,
      };
    }).pipe(Effect.catch((cause) => Effect.fail(presenceError("Failed to import repository.", cause))));

  const getBoardSnapshot: PresenceControlPlaneShape["getBoardSnapshot"] = (input) =>
    getBoardSnapshotInternal(input.boardId).pipe(
      Effect.catch((cause) => Effect.fail(presenceError("Failed to load board snapshot.", cause))),
    );

  const createTicket: PresenceControlPlaneShape["createTicket"] = (input) =>
    Effect.gen(function* () {
      const createdAt = nowIso();
      const ticketId = makeId(TicketId, "ticket");
      const checklist = input.acceptanceChecklist ?? [
        { id: `check_${crypto.randomUUID()}`, label: "Mechanism understood", checked: false },
        { id: `check_${crypto.randomUUID()}`, label: "Evidence attached", checked: false },
        { id: `check_${crypto.randomUUID()}`, label: "Tests or validation captured", checked: false },
      ];
      yield* sql`
        INSERT INTO presence_tickets (
          ticket_id, board_id, parent_ticket_id, title, description, status, priority,
          acceptance_checklist_json, assigned_attempt_id, created_at, updated_at
        ) VALUES (
          ${ticketId},
          ${input.boardId},
          ${null},
          ${input.title},
          ${input.description},
          ${"todo"},
          ${input.priority},
          ${encodeJson(checklist)},
          ${null},
          ${createdAt},
          ${createdAt}
        )
      `;
      return {
        id: ticketId,
        boardId: input.boardId,
        parentTicketId: null,
        title: input.title,
        description: input.description,
        status: "todo" as const,
        priority: input.priority,
        acceptanceChecklist: checklist,
        assignedAttemptId: null,
        createdAt,
        updatedAt: createdAt,
      };
    }).pipe(Effect.catch((cause) => Effect.fail(presenceError("Failed to create ticket.", cause))));

  const updateTicket: PresenceControlPlaneShape["updateTicket"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* sql<any>`
        SELECT
          ticket_id as id, board_id as "boardId", parent_ticket_id as "parentTicketId",
          title, description, status, priority,
          acceptance_checklist_json as "acceptanceChecklist",
          assigned_attempt_id as "assignedAttemptId",
          created_at as "createdAt", updated_at as "updatedAt"
        FROM presence_tickets
        WHERE ticket_id = ${input.ticketId}
      `.pipe(Effect.map((rows) => rows[0] ?? null));
      if (!existing) {
        return yield* Effect.fail(presenceError(`Ticket '${input.ticketId}' not found.`));
      }
      const updatedAt = nowIso();
      const nextChecklist =
        input.acceptanceChecklist ?? decodeJson(existing.acceptanceChecklist, []);
      yield* sql`
        UPDATE presence_tickets
        SET
          title = ${input.title ?? existing.title},
          description = ${input.description ?? existing.description},
          status = ${input.status ?? existing.status},
          priority = ${input.priority ?? existing.priority},
          acceptance_checklist_json = ${encodeJson(nextChecklist)},
          updated_at = ${updatedAt}
        WHERE ticket_id = ${input.ticketId}
      `;
      return mapTicket({
        ...existing,
        title: input.title ?? existing.title,
        description: input.description ?? existing.description,
        status: input.status ?? existing.status,
        priority: input.priority ?? existing.priority,
        acceptanceChecklist: encodeJson(nextChecklist),
        updatedAt,
      });
    }).pipe(Effect.catch((cause) => Effect.fail(presenceError("Failed to update ticket.", cause))));

  const createAttempt: PresenceControlPlaneShape["createAttempt"] = (input) =>
    Effect.gen(function* () {
      const ticket = yield* sql<any>`
        SELECT ticket_id as id, title, board_id as "boardId"
        FROM presence_tickets
        WHERE ticket_id = ${input.ticketId}
      `.pipe(Effect.map((rows) => rows[0] ?? null));
      if (!ticket) {
        return yield* Effect.fail(presenceError(`Ticket '${input.ticketId}' not found.`));
      }

      const createdAt = nowIso();
      const attemptId = makeId(AttemptId, "attempt");
      const workspaceId = makeId(WorkspaceId, "workspace");
      const title = input.title ?? `${ticket.title} Attempt`;
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO presence_attempts (
              attempt_id, ticket_id, workspace_id, title, status, provider, model,
              thread_id, summary, confidence, last_worker_handoff_id, created_at, updated_at
            ) VALUES (
              ${attemptId},
              ${input.ticketId},
              ${workspaceId},
              ${title},
              ${"planned"},
              ${null},
              ${null},
              ${null},
              ${null},
              ${null},
              ${null},
              ${createdAt},
              ${createdAt}
            )
          `;
          yield* sql`
            INSERT INTO presence_workspaces (
              workspace_id, attempt_id, status, branch, worktree_path, created_at, updated_at
            ) VALUES (
              ${workspaceId},
              ${attemptId},
              ${"unprepared"},
              ${null},
              ${null},
              ${createdAt},
              ${createdAt}
            )
          `;
          yield* sql`
            UPDATE presence_tickets
            SET assigned_attempt_id = ${attemptId}, status = ${"in_progress"}, updated_at = ${createdAt}
            WHERE ticket_id = ${input.ticketId}
          `;
        }),
      );

      return {
        id: attemptId,
        ticketId: TicketId.make(input.ticketId),
        workspaceId,
        title,
        status: "planned" as const,
        provider: null,
        model: null,
        threadId: null,
        summary: null,
        confidence: null,
        lastWorkerHandoffId: null,
        createdAt,
        updatedAt: createdAt,
      };
    }).pipe(Effect.catch((cause) => Effect.fail(presenceError("Failed to create attempt.", cause))));

  const startAttemptSession: PresenceControlPlaneShape["startAttemptSession"] = (input) =>
    Effect.gen(function* () {
      const attemptRow = yield* sql<any>`
        SELECT
          a.attempt_id as "attemptId",
          a.ticket_id as "ticketId",
          a.title as "attemptTitle",
          t.title as "ticketTitle",
          r.project_id as "projectId",
          r.default_model_selection_json as "defaultModelSelection"
        FROM presence_attempts a
        INNER JOIN presence_tickets t ON t.ticket_id = a.ticket_id
        INNER JOIN presence_boards b ON b.board_id = t.board_id
        INNER JOIN presence_repositories r ON r.repository_id = b.repository_id
        WHERE a.attempt_id = ${input.attemptId}
      `.pipe(Effect.map((rows) => rows[0] ?? null));
      if (!attemptRow) {
        return yield* Effect.fail(presenceError(`Attempt '${input.attemptId}' not found.`));
      }
      if (!attemptRow.projectId) {
        return yield* Effect.fail(presenceError("Attempt repository is missing an orchestration project."));
      }

      const providers = yield* providerRegistry.getProviders;
      const fallbackSelection =
        chooseDefaultModelSelection(providers) ??
        decodeJson<ModelSelection | null>(attemptRow.defaultModelSelection, null);
      const selection =
        input.provider && input.model
          ? ({ provider: input.provider, model: input.model } as ModelSelection)
          : fallbackSelection;
      if (!selection) {
        return yield* Effect.fail(
          presenceError("No provider/model is available to start an attempt session."),
        );
      }

      const threadId = makeId(ThreadId, "presence_thread");
      const createdAt = nowIso();
      yield* orchestrationEngine.dispatch({
        type: "thread.create",
        commandId: CommandId.make(`presence_thread_create_${crypto.randomUUID()}`),
        threadId,
        projectId: ProjectId.make(attemptRow.projectId),
        title: `${attemptRow.ticketTitle} - ${attemptRow.attemptTitle}`,
        modelSelection: selection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt,
      });
      yield* sql`
        UPDATE presence_attempts
        SET
          thread_id = ${threadId},
          provider = ${selection.provider},
          model = ${selection.model},
          status = ${"in_progress"},
          updated_at = ${createdAt}
        WHERE attempt_id = ${input.attemptId}
      `;
      return {
        attemptId: AttemptId.make(input.attemptId),
        threadId,
        provider: selection.provider,
        model: selection.model,
        attachedAt: createdAt,
      };
    }).pipe(
      Effect.catch((cause) => Effect.fail(presenceError("Failed to start attempt session.", cause))),
    );

  const attachThreadToAttempt: PresenceControlPlaneShape["attachThreadToAttempt"] = (input) =>
    Effect.gen(function* () {
      const updatedAt = nowIso();
      yield* sql`
        UPDATE presence_attempts
        SET thread_id = ${input.threadId}, updated_at = ${updatedAt}
        WHERE attempt_id = ${input.attemptId}
      `;
      const row = yield* sql<any>`
        SELECT
          attempt_id as id, ticket_id as "ticketId", workspace_id as "workspaceId",
          title, status, provider, model, thread_id as "threadId", summary, confidence,
          last_worker_handoff_id as "lastWorkerHandoffId",
          created_at as "createdAt", updated_at as "updatedAt"
        FROM presence_attempts
        WHERE attempt_id = ${input.attemptId}
      `.pipe(Effect.map((rows) => rows[0] ?? null));
      if (!row) {
        return yield* Effect.fail(presenceError(`Attempt '${input.attemptId}' not found.`));
      }
      return mapAttempt(row);
    }).pipe(Effect.catch((cause) => Effect.fail(presenceError("Failed to attach thread.", cause))));

  const saveSupervisorHandoff: PresenceControlPlaneShape["saveSupervisorHandoff"] = (input) =>
    Effect.gen(function* () {
      const handoffId = makeId(HandoffId, "handoff");
      const createdAt = nowIso();
      yield* sql`
        INSERT INTO presence_handoffs (
          handoff_id, board_id, attempt_id, role, payload_json, created_at
        ) VALUES (
          ${handoffId},
          ${input.boardId},
          ${null},
          ${"supervisor"},
          ${encodeJson({
            topPriorities: input.topPriorities,
            activeAttemptIds: input.activeAttemptIds,
            blockedTicketIds: input.blockedTicketIds,
            recentDecisions: input.recentDecisions,
            nextBoardActions: input.nextBoardActions,
            resumeProtocol: DEFAULT_PRESENCE_RESUME_PROTOCOL.supervisorReadOrder,
          })},
          ${createdAt}
        )
      `;
      return {
        id: handoffId,
        boardId: input.boardId,
        topPriorities: input.topPriorities,
        activeAttemptIds: input.activeAttemptIds,
        blockedTicketIds: input.blockedTicketIds,
        recentDecisions: input.recentDecisions,
        nextBoardActions: input.nextBoardActions,
        createdAt,
      };
    }).pipe(
      Effect.catch((cause) => Effect.fail(presenceError("Failed to save supervisor handoff.", cause))),
    );

  const saveWorkerHandoff: PresenceControlPlaneShape["saveWorkerHandoff"] = (input) =>
    Effect.gen(function* () {
      const handoffId = makeId(HandoffId, "handoff");
      const createdAt = nowIso();
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO presence_handoffs (
              handoff_id, board_id, attempt_id, role, payload_json, created_at
            ) VALUES (
              ${handoffId},
              ${null},
              ${input.attemptId},
              ${"worker"},
              ${encodeJson({
                completedWork: input.completedWork,
                currentHypothesis: input.currentHypothesis ?? null,
                changedFiles: input.changedFiles,
                testsRun: input.testsRun,
                blockers: input.blockers,
                nextStep: input.nextStep ?? null,
                confidence: input.confidence ?? null,
                evidenceIds: input.evidenceIds,
                resumeProtocol: DEFAULT_PRESENCE_RESUME_PROTOCOL.workerReadOrder,
              })},
              ${createdAt}
            )
          `;
          yield* sql`
            UPDATE presence_attempts
            SET
              summary = ${input.completedWork[0] ?? null},
              confidence = ${input.confidence ?? null},
              last_worker_handoff_id = ${handoffId},
              updated_at = ${createdAt}
            WHERE attempt_id = ${input.attemptId}
          `;
        }),
      );
      return {
        id: handoffId,
        attemptId: input.attemptId,
        completedWork: input.completedWork,
        currentHypothesis: input.currentHypothesis ?? null,
        changedFiles: input.changedFiles,
        testsRun: input.testsRun,
        blockers: input.blockers,
        nextStep: input.nextStep ?? null,
        confidence: input.confidence ?? null,
        evidenceIds: input.evidenceIds,
        createdAt,
      };
    }).pipe(
      Effect.catch((cause) => Effect.fail(presenceError("Failed to save worker handoff.", cause))),
    );

  const saveAttemptEvidence: PresenceControlPlaneShape["saveAttemptEvidence"] = (input) =>
    Effect.gen(function* () {
      const evidenceId = makeId(EvidenceId, "evidence");
      const createdAt = nowIso();
      yield* sql`
        INSERT INTO presence_attempt_evidence (
          evidence_id, attempt_id, title, kind, content, created_at
        ) VALUES (
          ${evidenceId},
          ${input.attemptId},
          ${input.title},
          ${input.kind},
          ${input.content},
          ${createdAt}
        )
      `;
      return {
        id: evidenceId,
        attemptId: input.attemptId,
        title: input.title,
        kind: input.kind,
        content: input.content,
        createdAt,
      };
    }).pipe(
      Effect.catch((cause) => Effect.fail(presenceError("Failed to save attempt evidence.", cause))),
    );

  const upsertKnowledgePage: PresenceControlPlaneShape["upsertKnowledgePage"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* sql<any>`
        SELECT knowledge_page_id as id, created_at as "createdAt"
        FROM presence_knowledge_pages
        WHERE board_id = ${input.boardId} AND family = ${input.family} AND slug = ${input.slug}
      `.pipe(Effect.map((rows) => rows[0] ?? null));
      const knowledgePageId = existing?.id
        ? KnowledgePageId.make(existing.id)
        : makeId(KnowledgePageId, "knowledge");
      const createdAt = existing?.createdAt ?? nowIso();
      const updatedAt = nowIso();
      yield* sql`
        INSERT INTO presence_knowledge_pages (
          knowledge_page_id, board_id, family, slug, title, compiled_truth, timeline,
          linked_ticket_ids_json, created_at, updated_at
        ) VALUES (
          ${knowledgePageId},
          ${input.boardId},
          ${input.family},
          ${input.slug},
          ${input.title},
          ${input.compiledTruth},
          ${input.timeline},
          ${encodeJson(input.linkedTicketIds)},
          ${createdAt},
          ${updatedAt}
        )
        ON CONFLICT (board_id, family, slug)
        DO UPDATE SET
          title = excluded.title,
          compiled_truth = excluded.compiled_truth,
          timeline = excluded.timeline,
          linked_ticket_ids_json = excluded.linked_ticket_ids_json,
          updated_at = excluded.updated_at
      `;
      return {
        id: knowledgePageId,
        boardId: input.boardId,
        family: input.family,
        slug: input.slug,
        title: input.title,
        compiledTruth: input.compiledTruth,
        timeline: input.timeline,
        linkedTicketIds: input.linkedTicketIds,
        createdAt,
        updatedAt,
      };
    }).pipe(
      Effect.catch((cause) => Effect.fail(presenceError("Failed to upsert knowledge page.", cause))),
    );

  const createPromotionCandidate: PresenceControlPlaneShape["createPromotionCandidate"] = (input) =>
    Effect.gen(function* () {
      const candidateId = makeId(PromotionCandidateId, "promotion");
      const createdAt = nowIso();
      yield* sql`
        INSERT INTO presence_promotion_candidates (
          promotion_candidate_id, source_ticket_id, source_attempt_id, family, title, slug,
          compiled_truth, timeline_entry, status, created_at, updated_at
        ) VALUES (
          ${candidateId},
          ${input.sourceTicketId},
          ${input.sourceAttemptId ?? null},
          ${input.family},
          ${input.title},
          ${input.slug},
          ${input.compiledTruth},
          ${input.timelineEntry},
          ${"pending"},
          ${createdAt},
          ${createdAt}
        )
      `;
      return {
        id: candidateId,
        sourceTicketId: input.sourceTicketId,
        sourceAttemptId: input.sourceAttemptId ?? null,
        family: input.family,
        title: input.title,
        slug: input.slug,
        compiledTruth: input.compiledTruth,
        timelineEntry: input.timelineEntry,
        status: "pending" as const,
        createdAt,
        updatedAt: createdAt,
      };
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(presenceError("Failed to create promotion candidate.", cause)),
      ),
    );

  const reviewPromotionCandidate: PresenceControlPlaneShape["reviewPromotionCandidate"] = (input) =>
    Effect.gen(function* () {
      const updatedAt = nowIso();
      yield* sql`
        UPDATE presence_promotion_candidates
        SET status = ${input.status}, updated_at = ${updatedAt}
        WHERE promotion_candidate_id = ${input.promotionCandidateId}
      `;
      const row = yield* sql<any>`
        SELECT
          promotion_candidate_id as id, source_ticket_id as "sourceTicketId",
          source_attempt_id as "sourceAttemptId", family, title, slug, compiled_truth as "compiledTruth",
          timeline_entry as "timelineEntry", status, created_at as "createdAt", updated_at as "updatedAt"
        FROM presence_promotion_candidates
        WHERE promotion_candidate_id = ${input.promotionCandidateId}
      `.pipe(Effect.map((rows) => rows[0] ?? null));
      if (!row) {
        return yield* Effect.fail(
          presenceError(`Promotion candidate '${input.promotionCandidateId}' not found.`),
        );
      }
      return mapPromotionCandidate(row);
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(presenceError("Failed to review promotion candidate.", cause)),
      ),
    );

  const createDeterministicJob: PresenceControlPlaneShape["createDeterministicJob"] = (input) =>
    Effect.gen(function* () {
      const jobId = makeId(DeterministicJobId, "job");
      const createdAt = nowIso();
      yield* sql`
        INSERT INTO presence_deterministic_jobs (
          deterministic_job_id, board_id, title, kind, status, progress,
          output_summary, error_message, created_at, updated_at
        ) VALUES (
          ${jobId},
          ${input.boardId},
          ${input.title},
          ${input.kind},
          ${"queued"},
          ${0},
          ${null},
          ${null},
          ${createdAt},
          ${createdAt}
        )
      `;
      return {
        id: jobId,
        boardId: input.boardId,
        title: input.title,
        kind: input.kind,
        status: "queued" as const,
        progress: 0,
        outputSummary: null,
        errorMessage: null,
        createdAt,
        updatedAt: createdAt,
      };
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(presenceError("Failed to create deterministic job.", cause)),
      ),
    );

  const submitReviewDecision: PresenceControlPlaneShape["submitReviewDecision"] = (input) =>
    Effect.gen(function* () {
      const decisionId = makeId(ReviewDecisionId, "review");
      const createdAt = nowIso();
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO presence_review_decisions (
              review_decision_id, ticket_id, attempt_id, decision, notes, created_at
            ) VALUES (
              ${decisionId},
              ${input.ticketId},
              ${input.attemptId ?? null},
              ${input.decision},
              ${input.notes},
              ${createdAt}
            )
          `;
          if (input.attemptId) {
            const nextAttemptStatus =
              input.decision === "accept" || input.decision === "merge_approved"
                ? "accepted"
                : input.decision === "request_changes"
                  ? "in_progress"
                  : input.decision === "reject"
                    ? "rejected"
                    : "in_review";
            yield* sql`
              UPDATE presence_attempts
              SET status = ${nextAttemptStatus}, updated_at = ${createdAt}
              WHERE attempt_id = ${input.attemptId}
            `;
          }

          const nextTicketStatus =
            input.decision === "accept" || input.decision === "merge_approved"
              ? "done"
              : input.decision === "request_changes"
                ? "in_progress"
                : input.decision === "reject"
                  ? "blocked"
                  : "in_review";
          yield* sql`
            UPDATE presence_tickets
            SET status = ${nextTicketStatus}, updated_at = ${createdAt}
            WHERE ticket_id = ${input.ticketId}
          `;
        }),
      );

      return {
        id: decisionId,
        ticketId: input.ticketId,
        attemptId: input.attemptId ?? null,
        decision: input.decision,
        notes: input.notes,
        createdAt,
      };
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(presenceError("Failed to submit review decision.", cause)),
      ),
    );

  return {
    listRepositories,
    importRepository,
    getBoardSnapshot,
    createTicket,
    updateTicket,
    createAttempt,
    startAttemptSession,
    attachThreadToAttempt,
    saveSupervisorHandoff,
    saveWorkerHandoff,
    saveAttemptEvidence,
    upsertKnowledgePage,
    createPromotionCandidate,
    reviewPromotionCandidate,
    createDeterministicJob,
    submitReviewDecision,
  } satisfies PresenceControlPlaneShape;
});

export const PresenceControlPlaneLive = Layer.effect(PresenceControlPlane, makePresenceControlPlane);
