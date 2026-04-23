import { BotIcon, FolderPlusIcon, RefreshCcwIcon, ScanSearchIcon, SparklesIcon } from "lucide-react";
import {
  PROVIDER_DISPLAY_NAMES,
  type AttemptSummary,
  type PresenceReviewDecisionKind,
  type ProjectionHealthRecord,
  type ProposedFollowUpRecord,
  type RepositoryCapabilityScanRecord,
  type RepositorySummary,
  type ServerProvider,
  type TicketRecord,
  type TicketSummaryRecord,
} from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { usePrimaryEnvironmentId } from "~/environments/primary";
import { readEnvironmentApi } from "~/environmentApi";
import {
  boardSnapshotQueryOptions,
  listRepositoriesQueryOptions,
  presenceQueryKeys,
} from "~/lib/presenceReactQuery";
import { readLocalApi } from "~/localApi";
import { useSettings } from "~/hooks/useSettings";
import { useServerProviders } from "~/rpc/serverState";
import { buildThreadRouteParams } from "~/threadRoutes";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import {
  BoardColumn,
  PresenceEmptyState,
  ProjectionHealthIndicator,
  RepositoryRail,
  STATUS_COLUMNS,
  TicketWorkspace,
  ToolsWorkspace,
} from "./PresenceGuidedViews";
import { canReviewAttempt } from "./PresencePresentation";

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isReadyPresenceHarnessProvider(provider: ServerProvider): boolean {
  return (
    provider.enabled &&
    provider.installed &&
    provider.status === "ready" &&
    provider.auth.status !== "unauthenticated" &&
    provider.models.length > 0
  );
}

export function PresenceDashboard() {
  const environmentId = usePrimaryEnvironmentId();
  const api = environmentId ? readEnvironmentApi(environmentId) ?? null : null;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const localApi = readLocalApi();
  const serverProviders = useServerProviders();
  const presenceModelSelection = useSettings((settings) => settings.presence.modelSelection);

  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [goalDraft, setGoalDraft] = useState("");
  const [handoffDraftByAttempt, setHandoffDraftByAttempt] = useState<Record<string, string>>({});
  const [expandedHandoffAttemptId, setExpandedHandoffAttemptId] = useState<string | null>(null);
  const [supervisorPriorities, setSupervisorPriorities] = useState(
    "Contain active work\nPreserve continuity\nPromote reviewed knowledge",
  );
  const [supervisorActions, setSupervisorActions] = useState(
    "Review open attempts\nReject weak work\nQueue deterministic scans",
  );
  const [knowledgeTitle, setKnowledgeTitle] = useState("");
  const [knowledgeCompiledTruth, setKnowledgeCompiledTruth] = useState("");
  const [knowledgeTimeline, setKnowledgeTimeline] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [jobKind, setJobKind] = useState("repo_scan");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [activeToolPanel, setActiveToolPanel] = useState<"memory" | "ops">("memory");

  const repositoriesQuery = useQuery({
    ...listRepositoriesQueryOptions(environmentId),
    enabled: environmentId !== null && api !== null,
  });
  const repositories = repositoriesQuery.data ?? [];

  useEffect(() => {
    if (!selectedRepositoryId && repositories[0]) {
      setSelectedRepositoryId(repositories[0].id);
    }
  }, [repositories, selectedRepositoryId]);

  const selectedRepository = useMemo<RepositorySummary | null>(
    () => repositories.find((repository) => repository.id === selectedRepositoryId) ?? null,
    [repositories, selectedRepositoryId],
  );
  const availablePresenceHarnessProviders = useMemo(
    () => serverProviders.filter(isReadyPresenceHarnessProvider),
    [serverProviders],
  );
  const currentPresenceHarnessUnavailable = useMemo(() => {
    if (!presenceModelSelection) {
      return false;
    }
    return !availablePresenceHarnessProviders.some(
      (provider) => provider.provider === presenceModelSelection.provider,
    );
  }, [availablePresenceHarnessProviders, presenceModelSelection]);

  const boardQuery = useQuery({
    ...boardSnapshotQueryOptions(environmentId, selectedRepository?.boardId ?? null),
    enabled: environmentId !== null && api !== null && selectedRepository !== null,
  });
  const board = boardQuery.data;
  const latestSupervisorRun = useMemo(() => board?.supervisorRuns[0] ?? null, [board]);

  useEffect(() => {
    if (!board || board.tickets.length === 0) {
      setSelectedTicketId(null);
      return;
    }

    const selectedStillExists = selectedTicketId
      ? board.tickets.some((ticket) => ticket.id === selectedTicketId)
      : false;
    if (selectedStillExists) {
      return;
    }

    const preferredTicket =
      board.tickets.find((ticket) => ticket.status !== "done") ?? board.tickets[0] ?? null;
    setSelectedTicketId(preferredTicket?.id ?? null);
  }, [board, selectedTicketId]);

  const selectedTicket = useMemo<TicketRecord | null>(
    () => board?.tickets.find((ticket) => ticket.id === selectedTicketId) ?? null,
    [board, selectedTicketId],
  );

  const selectedTicketAttempts = useMemo(
    () =>
      board?.attemptSummaries.filter((attempt) => attempt.attempt.ticketId === selectedTicket?.id) ?? [],
    [board, selectedTicket],
  );
  const selectedTicketSummary = useMemo<TicketSummaryRecord | null>(
    () => board?.ticketSummaries.find((summary) => summary.ticketId === selectedTicket?.id) ?? null,
    [board, selectedTicket],
  );
  const selectedTicketProjectionHealth = useMemo<ProjectionHealthRecord | null>(
    () =>
      board?.ticketProjectionHealth.find((health) => health.scopeId === selectedTicket?.id) ?? null,
    [board, selectedTicket],
  );
  const primaryAttemptSummary = useMemo<AttemptSummary | null>(
    () => selectedTicketAttempts.find(canReviewAttempt) ?? selectedTicketAttempts[0] ?? null,
    [selectedTicketAttempts],
  );
  const mergeableAttemptSummary = useMemo<AttemptSummary | null>(
    () =>
      selectedTicketAttempts.find(
        (summary) => summary.attempt.status === "accepted" && canReviewAttempt(summary),
      ) ?? null,
    [selectedTicketAttempts],
  );

  const capabilityScanQuery = useQuery({
    queryKey: ["presence", environmentId, "capability-scan", selectedRepository?.id ?? null],
    enabled: environmentId !== null && api !== null && selectedRepository !== null,
    queryFn: async (): Promise<RepositoryCapabilityScanRecord | null> => {
      if (!api || !selectedRepository) return null;
      return api.presence.getRepositoryCapabilities({ repositoryId: selectedRepository.id as never });
    },
  });

  const approveDecisionQuery = useQuery({
    queryKey: [
      "presence",
      environmentId,
      "policy",
      "approve",
      selectedTicket?.id ?? null,
      primaryAttemptSummary?.attempt.id ?? null,
      board?.capabilityScan?.scannedAt ?? capabilityScanQuery.data?.scannedAt ?? null,
    ],
    enabled:
      environmentId !== null &&
      api !== null &&
      selectedTicket !== null &&
      primaryAttemptSummary !== null,
    queryFn: async () => {
      if (!api || !selectedTicket || !primaryAttemptSummary) return null;
      return api.presence.evaluateSupervisorAction({
        action: "approve_attempt",
        ticketId: selectedTicket.id as never,
        attemptId: primaryAttemptSummary.attempt.id as never,
      });
    },
  });

  const mergeDecisionQuery = useQuery({
    queryKey: [
      "presence",
      environmentId,
      "policy",
      "merge",
      selectedTicket?.id ?? null,
      mergeableAttemptSummary?.attempt.id ?? null,
      board?.capabilityScan?.scannedAt ?? capabilityScanQuery.data?.scannedAt ?? null,
    ],
    enabled:
      environmentId !== null &&
      api !== null &&
      selectedTicket !== null &&
      mergeableAttemptSummary !== null,
    queryFn: async () => {
      if (!api || !selectedTicket || !mergeableAttemptSummary) return null;
      return api.presence.evaluateSupervisorAction({
        action: "merge_attempt",
        ticketId: selectedTicket.id as never,
        attemptId: mergeableAttemptSummary.attempt.id as never,
      });
    },
  });

  if (environmentId && !api) {
    return (
      <Empty className="min-h-[60vh] rounded-2xl border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BotIcon />
          </EmptyMedia>
          <EmptyTitle>Connecting to Presence...</EmptyTitle>
          <EmptyDescription>
            The local environment exists, but its API connection is not ready yet.
            Keep the dev server running and refresh once the desktop or web session finishes booting.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const invalidatePresence = async (boardId?: string | null) => {
    await queryClient.invalidateQueries({ queryKey: presenceQueryKeys.repositories(environmentId) });
    if (boardId) {
      await queryClient.invalidateQueries({
        queryKey: presenceQueryKeys.boardSnapshot(environmentId, boardId as never),
      });
    }
    await queryClient.invalidateQueries({
      queryKey: ["presence", environmentId, "policy"],
    });
    await queryClient.invalidateQueries({
      queryKey: ["presence", environmentId, "capability-scan"],
    });
  };

  const importRepositoryMutation = useMutation({
    mutationFn: async () => {
      if (!api) throw new Error("Primary environment is unavailable.");
      const workspaceRoot = await localApi?.dialogs.pickFolder?.();
      if (!workspaceRoot) return null;
      return api.presence.importRepository({ workspaceRoot });
    },
    onSuccess: async (repository) => {
      if (!repository) return;
      setSelectedRepositoryId(repository.id);
      await invalidatePresence(repository.boardId);
      toastManager.add({
        type: "success",
        title: "Repository imported",
        description: repository.title,
      });
    },
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: "Import failed",
        description: error instanceof Error ? error.message : "Unable to import repository.",
      }),
  });

  const updateTicketMutation = useMutation({
    mutationFn: async (input: {
      ticketId: string;
      acceptanceChecklist: TicketRecord["acceptanceChecklist"];
    }) => {
      if (!api) throw new Error("Primary environment is unavailable.");
      return api.presence.updateTicket({
        ticketId: input.ticketId as never,
        acceptanceChecklist: input.acceptanceChecklist,
      });
    },
    onSuccess: async () => {
      await invalidatePresence(selectedRepository?.boardId);
    },
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: "Checklist update failed",
        description:
          error instanceof Error ? error.message : "Presence could not update the checklist.",
      }),
  });

  const submitGoalIntakeMutation = useMutation({
    mutationFn: async () => {
      if (!api || !selectedRepository || !goalDraft.trim()) {
        throw new Error("Select a repository and describe the repo-level goal first.");
      }
      return api.presence.submitGoalIntake({
        boardId: selectedRepository.boardId,
        rawGoal: goalDraft.trim(),
        source: "human_goal",
        priorityHint: "p2",
      });
    },
    onSuccess: async (result) => {
      setGoalDraft("");
      setSelectedTicketId(result.createdTickets[0]?.id ?? null);
      await invalidatePresence(selectedRepository?.boardId);
      toastManager.add({
        type: "success",
        title: "Goal queued",
        description: result.intake.summary,
      });
    },
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: "Goal intake failed",
        description:
          error instanceof Error ? error.message : "Presence could not queue the goal for planning.",
      }),
  });

  const startSupervisorRunMutation = useMutation({
    mutationFn: async () => {
      if (!api || !selectedRepository) {
        throw new Error("Select a repository first.");
      }
      return api.presence.startSupervisorRun({
        boardId: selectedRepository.boardId,
      });
    },
    onSuccess: async () => {
      await invalidatePresence(selectedRepository?.boardId);
      toastManager.add({
        type: "success",
        title: "Supervisor started",
        description: "Presence is now driving the current board loop in the background.",
      });
    },
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: "Supervisor could not start",
        description:
          error instanceof Error ? error.message : "Presence could not start the supervisor runtime.",
      }),
  });

  const createAttemptMutation = useMutation({
    mutationFn: async (ticketId: string) => {
      if (!api) throw new Error("Primary environment is unavailable.");
      return api.presence.createAttempt({ ticketId: ticketId as never });
    },
    onSuccess: async (attempt) => {
      setSelectedTicketId(attempt.ticketId);
      await invalidatePresence(selectedRepository?.boardId);
    },
  });

  const startAttemptSessionMutation = useMutation({
    mutationFn: async (attemptId: string) => {
      if (!api || !environmentId) throw new Error("Primary environment is unavailable.");
      return api.presence.startAttemptSession({ attemptId: attemptId as never });
    },
    onSuccess: async (session) => {
      if (!environmentId) return;
      toastManager.add({
        type: "success",
        title: "Session opened",
        description: "The attempt thread is ready.",
      });
      await navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams({
          environmentId,
          threadId: session.threadId,
        }),
      });
      void invalidatePresence(selectedRepository?.boardId);
    },
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: "Could not start session",
        description: error instanceof Error ? error.message : "Unable to open the attempt session.",
      }),
  });

  const submitReviewDecisionMutation = useMutation({
    mutationFn: async (input: {
      ticketId: string;
      attemptId: string | null;
      decision: PresenceReviewDecisionKind;
    }) => {
      if (!api) throw new Error("Primary environment is unavailable.");
      return api.presence.submitReviewDecision({
        ticketId: input.ticketId as never,
        attemptId: input.attemptId as never,
        decision: input.decision,
        notes:
          input.decision === "accept"
            ? "Accepted against the current ticket checklist and moved to merge-ready."
            : input.decision === "merge_approved"
              ? "Merged into the repository base branch and cleaned up the attempt workspace."
              : "Supervisor requested another iteration.",
      });
    },
    onSuccess: async () => {
      await invalidatePresence(selectedRepository?.boardId);
    },
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: "Review action failed",
        description:
          error instanceof Error ? error.message : "Presence could not apply the review decision.",
      }),
  });

  const resolveFindingMutation = useMutation({
    mutationFn: async (findingId: string) => {
      if (!api) throw new Error("Primary environment is unavailable.");
      return api.presence.resolveFinding({ findingId: findingId as never });
    },
    onSuccess: async () => {
      await invalidatePresence(selectedRepository?.boardId);
    },
  });

  const dismissFindingMutation = useMutation({
    mutationFn: async (findingId: string) => {
      if (!api) throw new Error("Primary environment is unavailable.");
      return api.presence.dismissFinding({ findingId: findingId as never });
    },
    onSuccess: async () => {
      await invalidatePresence(selectedRepository?.boardId);
    },
  });

  const createFollowUpProposalMutation = useMutation({
    mutationFn: async (input: {
      parentTicketId: string;
      originatingAttemptId: string | null;
      kind: ProposedFollowUpRecord["kind"];
      title: string;
      description: string;
      findingIds: readonly string[];
    }) => {
      if (!api) throw new Error("Primary environment is unavailable.");
      return api.presence.createFollowUpProposal({
        parentTicketId: input.parentTicketId as never,
        originatingAttemptId: input.originatingAttemptId as never,
        kind: input.kind,
        title: input.title,
        description: input.description,
        priority: input.kind === "blocker_ticket" ? "p1" : "p2",
        findingIds: [...input.findingIds] as never,
      });
    },
    onSuccess: async () => {
      await invalidatePresence(selectedRepository?.boardId);
    },
  });

  const materializeFollowUpMutation = useMutation({
    mutationFn: async (proposalId: string) => {
      if (!api) throw new Error("Primary environment is unavailable.");
      return api.presence.materializeFollowUp({ proposalId: proposalId as never });
    },
    onSuccess: async (ticket) => {
      setSelectedTicketId(ticket.id);
      await invalidatePresence(selectedRepository?.boardId);
    },
  });

  const scanCapabilitiesMutation = useMutation({
    mutationFn: async () => {
      if (!api || !selectedRepository) {
        throw new Error("Select a repository first.");
      }
      return api.presence.scanRepositoryCapabilities({
        repositoryId: selectedRepository.id as never,
      });
    },
    onSuccess: async () => {
      await invalidatePresence(selectedRepository?.boardId);
      await capabilityScanQuery.refetch();
    },
  });

  const saveSupervisorHandoffMutation = useMutation({
    mutationFn: async () => {
      if (!api || !selectedRepository || !board) throw new Error("Select a repository first.");
      return api.presence.saveSupervisorHandoff({
        boardId: selectedRepository.boardId,
        topPriorities: splitLines(supervisorPriorities),
        activeAttemptIds: board.attempts.map((attempt) => attempt.id),
        blockedTicketIds: board.tickets
          .filter((ticket) => ticket.status === "blocked")
          .map((ticket) => ticket.id),
        recentDecisions: [
          "Workers never write directly to board memory",
          "Tickets require explicit review",
        ],
        nextBoardActions: splitLines(supervisorActions),
      });
    },
    onSuccess: async () => {
      setToolsOpen(true);
      setActiveToolPanel("memory");
      await invalidatePresence(selectedRepository?.boardId);
    },
  });

  const saveWorkerHandoffMutation = useMutation({
    mutationFn: async (input: { attemptId: string; draft: string }) => {
      if (!api) throw new Error("Primary environment is unavailable.");
      const lines = splitLines(input.draft);
      return api.presence.saveWorkerHandoff({
        attemptId: input.attemptId as never,
        completedWork: lines.length > 0 ? [lines[0]!] : ["Captured the current execution state in Presence."],
        currentHypothesis:
          lines[1] ??
          "The next worker should resume from the linked ticket, evidence, and handoff.",
        changedFiles: [],
        testsRun: [],
        blockers: [],
        nextStep: lines.at(-1) ?? "Open the attempt session and continue the task.",
        confidence: 0.7,
        evidenceIds: [],
      });
    },
    onSuccess: async (_result, variables) => {
      setHandoffDraftByAttempt((current) => {
        const next = { ...current };
        delete next[variables.attemptId];
        return next;
      });
      setExpandedHandoffAttemptId((current) =>
        current === variables.attemptId ? null : current,
      );
      await invalidatePresence(selectedRepository?.boardId);
    },
  });

  const createPromotionCandidateMutation = useMutation({
    mutationFn: async (input: { ticketId: string; attemptId: string | null }) => {
      if (!api) throw new Error("Primary environment is unavailable.");
      const ticket = board?.tickets.find((candidate) => candidate.id === input.ticketId);
      return api.presence.createPromotionCandidate({
        sourceTicketId: input.ticketId as never,
        sourceAttemptId: input.attemptId as never,
        family: "bug-patterns",
        title: ticket ? `${ticket.title} pattern` : "Observed pattern",
        slug: `pattern-${crypto.randomUUID().slice(0, 8)}`,
        compiledTruth:
          "Reviewed findings should become durable knowledge only after supervisor approval.",
        timelineEntry: `${new Date().toISOString()} - Promotion candidate created from Presence dashboard.`,
      });
    },
    onSuccess: async () => {
      setToolsOpen(true);
      setActiveToolPanel("ops");
      await invalidatePresence(selectedRepository?.boardId);
    },
  });

  const upsertKnowledgePageMutation = useMutation({
    mutationFn: async () => {
      if (!api || !selectedRepository || !knowledgeTitle.trim()) {
        throw new Error("A board and title are required.");
      }
      return api.presence.upsertKnowledgePage({
        boardId: selectedRepository.boardId,
        family: "runbooks",
        slug: knowledgeTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        title: knowledgeTitle.trim(),
        compiledTruth: knowledgeCompiledTruth.trim(),
        timeline: knowledgeTimeline.trim(),
        linkedTicketIds: board?.tickets.slice(0, 2).map((ticket) => ticket.id) ?? [],
      });
    },
    onSuccess: async () => {
      setKnowledgeTitle("");
      setKnowledgeCompiledTruth("");
      setKnowledgeTimeline("");
      setToolsOpen(true);
      setActiveToolPanel("memory");
      await invalidatePresence(selectedRepository?.boardId);
    },
  });

  const createJobMutation = useMutation({
    mutationFn: async () => {
      if (!api || !selectedRepository) throw new Error("Select a repository first.");
      return api.presence.createDeterministicJob({
        boardId: selectedRepository.boardId,
        title: jobTitle.trim(),
        kind: jobKind.trim(),
      });
    },
    onSuccess: async () => {
      setJobTitle("");
      setToolsOpen(true);
      setActiveToolPanel("ops");
      await invalidatePresence(selectedRepository?.boardId);
    },
  });

  const handleChangeHandoffDraft = (attemptId: string, value: string) => {
    setHandoffDraftByAttempt((current) => ({
      ...current,
      [attemptId]: value,
    }));
  };

  if (repositoriesQuery.isLoading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading Presence repositories...</div>;
  }

  if (!repositories.length) {
    return <PresenceEmptyState onImport={() => importRepositoryMutation.mutate()} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.10),transparent_30%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.10),transparent_30%),var(--background)] text-foreground">
      <header className="border-b border-border/70 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Presence
            </div>
            <div className="mt-1 text-xl font-semibold tracking-tight">
              Executive repo supervision
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              Presence handles the work, recovery, and routing. It only asks you for direction when the board truly needs it.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => importRepositoryMutation.mutate()}>
              <FolderPlusIcon />
              Import repository
            </Button>
            {selectedRepository ? (
              <Button
                variant="outline"
                onClick={() => void invalidatePresence(selectedRepository.boardId)}
              >
                <RefreshCcwIcon />
                Refresh board
              </Button>
            ) : null}
            {selectedRepository ? (
              <Button variant="outline" onClick={() => scanCapabilitiesMutation.mutate()}>
                <ScanSearchIcon />
                Rescan repo
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[188px_minmax(0,1fr)_390px]">
        <RepositoryRail
          repositories={repositories}
          selectedRepositoryId={selectedRepositoryId}
          onSelect={(repositoryId) => {
            setSelectedRepositoryId(repositoryId);
            setToolsOpen(false);
          }}
        />

        <main className="min-h-0 overflow-hidden border-t border-border/70 xl:border-t-0">
          {board ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-border/70 px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 max-w-4xl">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                      Presence command
                    </div>
                    <div className="mt-2 text-xl font-semibold tracking-tight text-foreground">
                      {board.tickets.some(
                        (ticket) =>
                          ticket.status === "ready_to_merge" ||
                          ticket.status === "blocked" ||
                          ticket.status === "in_review",
                      )
                        ? `Presence needs direction on ${
                            board.tickets.filter(
                              (ticket) =>
                                ticket.status === "ready_to_merge" ||
                                ticket.status === "blocked" ||
                                ticket.status === "in_review",
                            ).length
                          } ticket${
                            board.tickets.filter(
                              (ticket) =>
                                ticket.status === "ready_to_merge" ||
                                ticket.status === "blocked" ||
                                ticket.status === "in_review",
                            ).length === 1
                              ? ""
                              : "s"
                          }.`
                        : board.tickets.some((ticket) => ticket.status === "in_progress")
                          ? `Presence is actively moving ${
                              board.tickets.filter((ticket) => ticket.status === "in_progress").length
                            } ticket${
                              board.tickets.filter((ticket) => ticket.status === "in_progress").length === 1
                                ? ""
                                : "s"
                            }.`
                          : "Presence is ready for the next repo goal."}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {board.repository.workspaceRoot}
                      {board.board.sprintFocus ? ` · ${board.board.sprintFocus}` : ""}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge variant="outline">
                        {(capabilityScanQuery.data ?? board.capabilityScan)?.baseBranch ?? "no branch"}
                      </Badge>
                      <Badge variant="secondary">
                        reviewer validates
                      </Badge>
                      <Badge variant={presenceModelSelection ? "secondary" : "outline"}>
                        {presenceModelSelection
                          ? `Presence harness: ${
                              PROVIDER_DISPLAY_NAMES[presenceModelSelection.provider]
                            }`
                          : "Presence harness: Automatic"}
                      </Badge>
                      {latestSupervisorRun ? (
                        <Badge variant={latestSupervisorRun.status === "running" ? "info" : "outline"}>
                          {latestSupervisorRun.status}
                        </Badge>
                      ) : null}
                    </div>
                    <ProjectionHealthIndicator health={board.boardProjectionHealth} />
                  </div>
                </div>

                <div className="mt-4 rounded-[24px] border border-border/70 bg-card/90 p-4 shadow-sm">
                  <div className="mb-3 flex flex-wrap gap-2">
                    <Badge
                      variant={
                        board.tickets.some(
                          (ticket) =>
                            ticket.status === "ready_to_merge" ||
                            ticket.status === "blocked" ||
                            ticket.status === "in_review",
                        )
                          ? "warning"
                          : "secondary"
                      }
                    >
                      {board.tickets.some(
                        (ticket) =>
                          ticket.status === "ready_to_merge" ||
                          ticket.status === "blocked" ||
                          ticket.status === "in_review",
                      )
                        ? `${
                            board.tickets.filter(
                              (ticket) =>
                                ticket.status === "ready_to_merge" ||
                                ticket.status === "blocked" ||
                                ticket.status === "in_review",
                            ).length
                          } need your decision`
                        : "No immediate human decisions"}
                    </Badge>
                    <Badge variant="outline">
                      {board.tickets.filter((ticket) => ticket.status === "in_progress").length} active
                    </Badge>
                    <Badge variant="outline">{board.tickets.length} total tickets</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={goalDraft}
                      onChange={(event) => setGoalDraft(event.target.value)}
                      placeholder="Tell Presence what you want done in this repo."
                      className="min-w-[280px] flex-1"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={Boolean(latestSupervisorRun && latestSupervisorRun.status === "running")}
                      onClick={() => startSupervisorRunMutation.mutate()}
                    >
                      <BotIcon />
                      Run supervisor
                    </Button>
                    <Button
                      size="sm"
                      disabled={!goalDraft.trim()}
                      onClick={() => submitGoalIntakeMutation.mutate()}
                    >
                      <SparklesIcon />
                      Submit goal
                    </Button>
                  </div>
                  {latestSupervisorRun ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <Badge variant="outline">{latestSupervisorRun.status}</Badge>
                      <span className="uppercase tracking-[0.14em]">{latestSupervisorRun.stage}</span>
                      <span className="truncate">{latestSupervisorRun.summary}</span>
                    </div>
                  ) : (
                    <div className="mt-3 text-[11px] text-muted-foreground">
                      Presence will turn a repo goal into ticket activity and only pull you in when direction is required.
                    </div>
                  )}
                  {currentPresenceHarnessUnavailable && presenceModelSelection ? (
                    <div className="mt-2 text-[11px] text-amber-300">
                      The selected Presence harness is currently unavailable. Open Settings and
                      switch Presence to Automatic or another ready harness before starting the
                      supervisor again.
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
                <div className="flex min-h-full gap-3 overflow-x-auto pb-2">
                  {STATUS_COLUMNS.map((status) => (
                    <BoardColumn
                      key={status}
                      status={status}
                      tickets={board.tickets.filter((ticket) => ticket.status === status)}
                      board={board}
                      capabilityScan={capabilityScanQuery.data ?? board.capabilityScan}
                      selectedTicketId={selectedTicketId}
                      onSelectTicket={(ticketId) => {
                        setSelectedTicketId(ticketId);
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
              Select a repository to load its Presence board.
            </div>
          )}
        </main>

        <aside className="min-h-0 overflow-hidden border-l border-border/70 bg-gradient-to-b from-muted/20 to-background/80">
          <div className="flex h-full min-h-0 flex-col">
            <div className="border-b border-border/70 px-4 py-4">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Presence briefing
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                What Presence is handling, whether it needs you, and the next recommended move.
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
              {!board ? (
                <div className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
                  Pick a repository.
                </div>
              ) : (
                <div className="space-y-4">
                  {selectedTicket ? (
                    <TicketWorkspace
                      board={board}
                      ticket={selectedTicket}
                      ticketSummary={selectedTicketSummary}
                      ticketProjectionHealth={selectedTicketProjectionHealth}
                      capabilityScan={capabilityScanQuery.data ?? board.capabilityScan}
                      primaryAttempt={primaryAttemptSummary}
                      mergeableAttempt={mergeableAttemptSummary}
                      approveDecision={approveDecisionQuery.data ?? null}
                      mergeDecision={mergeDecisionQuery.data ?? null}
                      handoffDraftByAttempt={handoffDraftByAttempt}
                      expandedHandoffAttemptId={expandedHandoffAttemptId}
                      startingAttemptId={startAttemptSessionMutation.variables ?? null}
                      onChangeHandoffDraft={handleChangeHandoffDraft}
                      onToggleHandoffEditor={(attemptId) =>
                        setExpandedHandoffAttemptId((current) => (current === attemptId ? null : attemptId))
                      }
                      onToggleChecklistItem={(ticketId, itemId, checked) => {
                        const ticket = board.tickets.find((candidate) => candidate.id === ticketId);
                        if (!ticket) return;
                        updateTicketMutation.mutate({
                          ticketId,
                          acceptanceChecklist: ticket.acceptanceChecklist.map((item) =>
                            item.id === itemId ? { ...item, checked } : item,
                          ),
                        });
                      }}
                      onCreateAttempt={(ticketId) => createAttemptMutation.mutate(ticketId)}
                      onStartAttemptSession={(attemptId) => startAttemptSessionMutation.mutate(attemptId)}
                      onResolveFinding={(findingId) => resolveFindingMutation.mutate(findingId)}
                      onDismissFinding={(findingId) => dismissFindingMutation.mutate(findingId)}
                      onCreateFollowUpProposal={(finding, kind) =>
                        createFollowUpProposalMutation.mutate({
                          parentTicketId: selectedTicket.id,
                          originatingAttemptId: finding.attemptId ?? null,
                          kind,
                          title:
                            kind === "blocker_ticket"
                              ? `Blocker: ${finding.summary}`
                              : `Follow-up: ${finding.summary}`,
                          description: `${finding.summary}\n\n${finding.rationale}`,
                          findingIds: [finding.id],
                        })
                      }
                      onMaterializeFollowUp={(proposalId) => materializeFollowUpMutation.mutate(proposalId)}
                      onRequestChanges={(ticketId, attemptId) =>
                        submitReviewDecisionMutation.mutate({
                          ticketId,
                          attemptId,
                          decision: "request_changes",
                        })
                      }
                      onAccept={(ticketId, attemptId) =>
                        submitReviewDecisionMutation.mutate({
                          ticketId,
                          attemptId,
                          decision: "accept",
                        })
                      }
                      onMerge={(ticketId, attemptId) =>
                        submitReviewDecisionMutation.mutate({
                          ticketId,
                          attemptId,
                          decision: "merge_approved",
                        })
                      }
                      onSaveWorkerHandoff={(attemptId, draft) =>
                        saveWorkerHandoffMutation.mutate({ attemptId, draft })
                      }
                      onCreatePromotionCandidate={(ticketId, attemptId) =>
                        createPromotionCandidateMutation.mutate({ ticketId, attemptId })
                      }
                    />
                  ) : (
                    <div className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
                      Select a ticket to open the guided workspace.
                    </div>
                  )}

                  <ToolsWorkspace
                    board={board}
                    capabilityScan={capabilityScanQuery.data ?? board.capabilityScan}
                    supervisorPriorities={supervisorPriorities}
                    supervisorActions={supervisorActions}
                    knowledgeTitle={knowledgeTitle}
                    knowledgeCompiledTruth={knowledgeCompiledTruth}
                    knowledgeTimeline={knowledgeTimeline}
                    jobTitle={jobTitle}
                    jobKind={jobKind}
                    toolsOpen={toolsOpen}
                    activeToolPanel={activeToolPanel}
                    onToolsOpenChange={setToolsOpen}
                    onActiveToolPanelChange={setActiveToolPanel}
                    onSupervisorPrioritiesChange={setSupervisorPriorities}
                    onSupervisorActionsChange={setSupervisorActions}
                    onSaveSupervisorHandoff={() => saveSupervisorHandoffMutation.mutate()}
                    onKnowledgeTitleChange={setKnowledgeTitle}
                    onKnowledgeCompiledTruthChange={setKnowledgeCompiledTruth}
                    onKnowledgeTimelineChange={setKnowledgeTimeline}
                    onSaveKnowledgePage={() => upsertKnowledgePageMutation.mutate()}
                    onJobTitleChange={setJobTitle}
                    onJobKindChange={setJobKind}
                    onCreateJob={() => createJobMutation.mutate()}
                    onRescanCapabilities={() => scanCapabilitiesMutation.mutate()}
                  />
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
