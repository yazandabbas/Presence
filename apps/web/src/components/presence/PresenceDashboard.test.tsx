import {
  AttemptId,
  BoardId,
  CapabilityScanId,
  HandoffId,
  RepositoryId,
  SupervisorRunId,
  ThreadId,
  TicketId,
  WorkspaceId,
  type BoardSnapshot,
  type RepositorySummary,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.fn();
const mockInvalidateQueries = vi.fn();

function buildRepository(): RepositorySummary {
  const repositoryId = RepositoryId.make("repo-1");
  const boardId = BoardId.make("board-1");
  return {
    id: repositoryId,
    boardId,
    projectId: null,
    title: "Presence repo",
    workspaceRoot: "C:/repo",
    defaultModelSelection: null,
    createdAt: "2026-04-22T09:00:00.000Z",
    updatedAt: "2026-04-22T09:00:00.000Z",
  };
}

function buildBoard(repository: RepositorySummary): BoardSnapshot {
  const ticketId = TicketId.make("ticket-1");
  const attemptId = AttemptId.make("attempt-1");
  const workspaceId = WorkspaceId.make("workspace-1");
  const handoffId = HandoffId.make("handoff-1");
  const threadId = ThreadId.make("thread-1");

  return {
    repository,
    board: {
      id: repository.boardId,
      repositoryId: repository.id,
      title: "Presence board",
      sprintFocus: "Clarify the next move",
      topPrioritySummary: null,
      createdAt: "2026-04-22T09:00:00.000Z",
      updatedAt: "2026-04-22T09:00:00.000Z",
    },
    tickets: [
      {
        id: ticketId,
        boardId: repository.boardId,
        parentTicketId: null,
        title: "Ship guided cockpit",
        description: "Make Presence feel alive and actionable.",
        status: "in_progress",
        priority: "p1",
        acceptanceChecklist: [
          { id: "check-1", label: "Board shows stage clearly", checked: true },
          { id: "check-2", label: "Failures are actionable", checked: false },
        ],
        assignedAttemptId: attemptId,
        createdAt: "2026-04-22T09:00:00.000Z",
        updatedAt: "2026-04-22T10:00:00.000Z",
      },
    ],
    dependencies: [],
    attempts: [
      {
        id: attemptId,
        ticketId,
        workspaceId,
        title: "Guided cockpit attempt",
        status: "in_progress",
        provider: "codex",
        model: "gpt-5.4",
        threadId,
        summary: "Working on the board redesign.",
        confidence: 0.8,
        lastWorkerHandoffId: handoffId,
        createdAt: "2026-04-22T09:20:00.000Z",
        updatedAt: "2026-04-22T10:10:00.000Z",
      },
    ],
    workspaces: [
      {
        id: workspaceId,
        attemptId,
        status: "ready",
        branch: "presence-guided-cockpit",
        worktreePath: "C:/repo/.presence/attempt",
        createdAt: "2026-04-22T09:20:00.000Z",
        updatedAt: "2026-04-22T09:20:00.000Z",
      },
    ],
    attemptSummaries: [
      {
        attempt: {
          id: attemptId,
          ticketId,
          workspaceId,
          title: "Guided cockpit attempt",
          status: "in_progress",
          provider: "codex",
          model: "gpt-5.4",
          threadId,
          summary: "Working on the board redesign.",
          confidence: 0.8,
          lastWorkerHandoffId: handoffId,
          createdAt: "2026-04-22T09:20:00.000Z",
          updatedAt: "2026-04-22T10:10:00.000Z",
        },
        workspace: {
          id: workspaceId,
          attemptId,
          status: "ready",
          branch: "presence-guided-cockpit",
          worktreePath: "C:/repo/.presence/attempt",
          createdAt: "2026-04-22T09:20:00.000Z",
          updatedAt: "2026-04-22T09:20:00.000Z",
        },
        latestWorkerHandoff: {
          id: handoffId,
          attemptId,
          completedWork: ["Board cards now surface stage and next move."],
          currentHypothesis: "The ticket workspace will reduce cognitive load.",
          changedFiles: ["apps/web/src/components/presence/PresenceDashboard.tsx"],
          testsRun: [],
          blockers: [],
          nextStep: "Finish the evidence and history sections.",
          openQuestions: [],
          retryCount: 0,
          reasoningSource: "assistant_block",
          reasoningUpdatedAt: "2026-04-22T10:10:00.000Z",
          confidence: 0.8,
          evidenceIds: [],
          createdAt: "2026-04-22T10:10:00.000Z",
        },
      },
    ],
    supervisorHandoff: null,
    evidence: [],
    promotionCandidates: [],
    knowledgePages: [],
    jobs: [],
    findings: [],
    reviewArtifacts: [],
    mergeOperations: [],
    proposedFollowUps: [],
    ticketSummaries: [
      {
        ticketId,
        currentMechanism: "Board cards and ticket workspace derive from shared presence presentation helpers.",
        triedAcrossAttempts: [],
        failedWhy: [],
        openFindings: [],
        nextStep: "Finish the evidence and history sections.",
        activeAttemptId: attemptId,
        blocked: false,
        escalated: false,
        hasFollowUpProposal: false,
        hasMergeFailure: false,
        hasCleanupPending: false,
      },
    ],
    attemptOutcomes: [],
    reviewDecisions: [],
    supervisorRuns: [
      {
        id: SupervisorRunId.make("supervisor-run-1"),
        boardId: repository.boardId,
        sourceGoalIntakeId: null,
        scopeTicketIds: [ticketId],
        status: "running",
        stage: "waiting_on_worker",
        currentTicketId: ticketId,
        activeThreadIds: [threadId],
        summary: "Presence is waiting on the active worker session.",
        createdAt: "2026-04-22T10:00:00.000Z",
        updatedAt: "2026-04-22T10:12:00.000Z",
      },
    ],
    boardProjectionHealth: null,
    ticketProjectionHealth: [],
    hasStaleProjections: false,
    capabilityScan: {
      id: CapabilityScanId.make("capability-scan-1"),
      repositoryId: repository.id,
      boardId: repository.boardId,
      baseBranch: "main",
      upstreamRef: "origin/main",
      hasRemote: true,
      isClean: true,
      ecosystems: ["node"],
      markers: ["package.json"],
      discoveredCommands: [{ kind: "test", command: "npm run test:web", source: "package.json" }],
      riskSignals: [],
      scannedAt: "2026-04-22T09:30:00.000Z",
    },
    goalIntakes: [],
    missionBriefing: null,
    ticketBriefings: [],
    missionEvents: [],
  };
}

const repository = buildRepository();
const board = buildBoard(repository);

vi.mock("~/environments/primary", () => ({
  usePrimaryEnvironmentId: () => "env-1",
}));

vi.mock("~/environmentApi", () => ({
  readEnvironmentApi: () => ({
    presence: {
      importRepository: vi.fn(),
      submitGoalIntake: vi.fn(),
      startSupervisorRun: vi.fn(),
      createAttempt: vi.fn(),
      startAttemptSession: vi.fn(),
      submitReviewDecision: vi.fn(),
      resolveFinding: vi.fn(),
      dismissFinding: vi.fn(),
      createFollowUpProposal: vi.fn(),
      materializeFollowUp: vi.fn(),
      scanRepositoryCapabilities: vi.fn(),
      saveSupervisorHandoff: vi.fn(),
      saveWorkerHandoff: vi.fn(),
      createPromotionCandidate: vi.fn(),
      upsertKnowledgePage: vi.fn(),
      createDeterministicJob: vi.fn(),
      updateTicket: vi.fn(),
      getRepositoryCapabilities: vi.fn(),
      evaluateSupervisorAction: vi.fn(),
    },
  }),
}));

vi.mock("~/localApi", () => ({
  readLocalApi: () => ({ dialogs: { pickFolder: vi.fn() } }),
}));

vi.mock("~/threadRoutes", () => ({
  buildThreadRouteParams: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
    useMutation: () => ({ mutate: vi.fn(), variables: null }),
    useQuery: (options: { queryKey: readonly unknown[] }) => {
      const key = options.queryKey.join(":");
      if (key.includes("repositories")) {
        return { data: [repository], isLoading: false };
      }
      if (key.includes("board")) {
        return { data: board, isLoading: false };
      }
      if (key.includes("capability-scan")) {
        return { data: board.capabilityScan, isLoading: false, refetch: vi.fn() };
      }
      if (key.includes("policy")) {
        return { data: { allowed: true, reasons: [], requiresHumanMerge: false, recommendedTicketStatus: null, recommendedAttemptStatus: null, action: "approve_attempt" }, isLoading: false };
      }
      return { data: null, isLoading: false };
    },
  };
});

describe("PresenceDashboard", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockInvalidateQueries.mockReset();
  });

  it("renders the guided cockpit shell", async () => {
    const { PresenceDashboard } = await import("./PresenceDashboard");
    const markup = renderToStaticMarkup(<PresenceDashboard />);

    expect(markup).toContain("Executive repo supervision");
    expect(markup).toContain("Ship guided cockpit");
    expect(markup).toContain("Presence briefing");
    expect(markup).toContain("Presence harness");
    expect(markup).toContain("Tools");
  }, 15000);
});
