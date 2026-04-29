import { BotIcon, FolderPlusIcon, RefreshCcwIcon, ScanSearchIcon } from "lucide-react";
import {
  type AttemptSummary,
  type PresenceHumanDirectionKind,
  type PresenceReviewDecisionKind,
  type ProposedFollowUpRecord,
  type TicketRecord,
} from "@t3tools/contracts";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { usePresenceBoard } from "~/lib/presenceBoard";
import { readLocalApi } from "~/localApi";
import { buildThreadRouteParams } from "~/threadRoutes";
import { canReviewAttempt } from "./PresencePresentation";
import {
  executePresenceCommandDefinition,
  type PresenceCommandDefinition,
} from "../PresenceCommandRegistry";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { toastManager } from "../ui/toast";
import {
  HumanDirectionPanel,
  PresenceBriefingSurface,
  type PresenceCockpitActivity,
  PresenceEmptyState,
  PresenceLiveStatusPanel,
  RepositorySelector,
  TicketWorkspace,
  ToolsWorkspace,
  WorkQueueSurface,
} from "./PresenceGuidedViews";

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function messageFromUnknown(error: unknown, fallback: string, depth = 0): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (!isRecord(error) || depth > 3) {
    return fallback;
  }

  const directMessage = error.message;
  if (typeof directMessage === "string" && directMessage.trim()) {
    return directMessage;
  }

  const description = error.description ?? error.details;
  if (typeof description === "string" && description.trim()) {
    return description;
  }

  const nestedError = error.error ?? error.cause ?? error.reason;
  if (nestedError !== undefined) {
    const nestedMessage = messageFromUnknown(nestedError, "", depth + 1);
    if (nestedMessage.trim()) {
      return nestedMessage;
    }
  }

  const stringified = String(error);
  if (stringified && stringified !== "[object Object]") {
    return stringified;
  }

  try {
    const json = JSON.stringify(error);
    if (json && json !== "{}") {
      return json;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

export function PresenceDashboard() {
  const navigate = useNavigate();
  const localApi = readLocalApi();
  const {
    environmentId,
    api,
    repositoriesQuery,
    repositories,
    selectedRepositoryId,
    setSelectedRepositoryId,
    selectedRepository,
    board,
    latestSupervisorRun,
    hasActivePresenceRuntimeThread,
    selectedTicketId,
    setSelectedTicketId,
    selectedTicket,
    primaryAttemptSummary,
    mergeableAttemptSummary,
    capabilityScanQuery,
    approveDecisionQuery,
    mergeDecisionQuery,
    currentPresenceHarnessUnavailable,
    invalidatePresence,
  } = usePresenceBoard();

  const [goalDraft, setGoalDraft] = useState("");
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
  const [cockpitActivity, setCockpitActivity] = useState<PresenceCockpitActivity | null>(null);
  const [directionActivity, setDirectionActivity] = useState<PresenceCockpitActivity | null>(null);

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

  const submitGoalIntakeMutation = useMutation({
    mutationFn: async () => {
      if (!api || !selectedRepository || !goalDraft.trim()) {
        throw new Error("Select a repository and describe the repo-level goal first.");
      }
      const intakeResult = await api.presence.submitGoalIntake({
        boardId: selectedRepository.boardId,
        rawGoal: goalDraft.trim(),
        source: "human_goal",
        priorityHint: "p2",
        planNow: true,
      });
      return { intakeResult };
    },
    onMutate: () => {
      setCockpitActivity({
        tone: "loading",
        title: "Presence received the mission.",
        detail: "I am saving the goal into the resident controller queue.",
      });
    },
    onSuccess: async (result) => {
      setGoalDraft("");
      setSelectedTicketId(result.intakeResult.createdTickets[0]?.id ?? null);
      await invalidatePresence(selectedRepository?.boardId);
      setCockpitActivity({
        tone: "loading",
        title: "Goal queued for Presence.",
        detail:
          "The resident controller will plan it automatically, then the work queue will move from queued to planning to tickets.",
      });
      toastManager.add({
        type: "success",
        title: "Goal queued",
        description: result.intakeResult.intake.summary,
      });
    },
    onError: (error) => {
      const message = messageFromUnknown(error, "Presence could not queue the goal for planning.");
      setCockpitActivity({
        tone: "error",
        title: "Presence could not take the mission.",
        detail: message,
      });
      toastManager.add({
        type: "error",
        title: "Goal intake failed",
        description: message,
      });
    },
  });

  const submitHumanDirectionMutation = useMutation({
    mutationFn: async (input: {
      ticketId: TicketRecord["id"];
      attemptId: AttemptSummary["attempt"]["id"] | null;
      directionKind: PresenceHumanDirectionKind;
      instructions: string;
    }) => {
      if (!api || !selectedRepository) {
        throw new Error("Select a repository first.");
      }
      return api.presence.submitHumanDirection({
        boardId: selectedRepository.boardId,
        ticketId: input.ticketId,
        attemptId: input.attemptId,
        directionKind: input.directionKind,
        instructions: input.instructions,
        autoContinue: true,
      });
    },
    onMutate: () => {
      setDirectionActivity({
        tone: "loading",
        title: "Presence received your direction.",
        detail:
          "I am recording it into mission state and will resume if no runtime is already active.",
      });
    },
    onSuccess: async (result) => {
      await invalidatePresence(selectedRepository?.boardId);
      setDirectionActivity({
        tone: result.supervisorRun ? "loading" : "success",
        title: result.supervisorRun ? "Presence is resuming." : "Direction saved.",
        detail: result.missionEvent.summary,
      });
      toastManager.add({
        type: "success",
        title: result.supervisorRun ? "Presence resumed" : "Direction saved",
        description: result.missionEvent.summary,
      });
    },
    onError: (error) => {
      const message = messageFromUnknown(error, "Presence could not record your direction.");
      setDirectionActivity({
        tone: "error",
        title: "Presence could not use that direction.",
        detail: message,
      });
      toastManager.add({
        type: "error",
        title: "Direction was not saved",
        description: message,
      });
    },
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
    onMutate: () => {
      setCockpitActivity({
        tone: "loading",
        title: "Presence is starting the supervisor.",
        detail: "I am checking the board state and looking for the next safe action.",
      });
    },
    onSuccess: async () => {
      await invalidatePresence(selectedRepository?.boardId);
      setCockpitActivity({
        tone: "loading",
        title: "Presence is running.",
        detail:
          "The supervisor is active; live mission updates will appear in the queue and briefing.",
      });
      toastManager.add({
        type: "success",
        title: "Supervisor started",
        description: "Presence is now driving the current board loop in the background.",
      });
    },
    onError: (error) => {
      const message = messageFromUnknown(error, "Presence could not start the supervisor runtime.");
      setCockpitActivity({
        tone: "error",
        title: "Presence could not start.",
        detail: message,
      });
      toastManager.add({
        type: "error",
        title: "Supervisor could not start",
        description: message,
      });
    },
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
        title: "Work opened",
        description: "The workspace is ready.",
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
        title: "Could not continue work",
        description: error instanceof Error ? error.message : "Unable to continue the worker run.",
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

  const upsertKnowledgePageMutation = useMutation({
    mutationFn: async () => {
      if (!api || !selectedRepository || !knowledgeTitle.trim()) {
        throw new Error("A board and title are required.");
      }
      return api.presence.upsertKnowledgePage({
        boardId: selectedRepository.boardId,
        family: "runbooks",
        slug: knowledgeTitle
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-"),
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

  const submitHumanDirectionCommand = (input: {
    ticketId: TicketRecord["id"];
    attemptId: AttemptSummary["attempt"]["id"] | null;
    directionKind: PresenceHumanDirectionKind;
    instructions: string;
  }): PresenceCommandDefinition => ({
    id: "presence.human-direction.submit",
    title: "Send direction to Presence",
    description: "Record a human direction and let Presence continue when safe.",
    icon: null,
    searchTerms: ["presence direction", "human direction", "continue presence"],
    risk: "instant",
    enabled: !submitHumanDirectionMutation.isPending,
    disabledReason: "Presence is already recording a direction.",
    run: async () => {
      submitHumanDirectionMutation.mutate(input);
    },
  });

  const reviewDecisionCommand = (input: {
    ticketId: string;
    attemptId: string | null;
    decision: PresenceReviewDecisionKind;
  }): PresenceCommandDefinition => ({
    id: `presence.review.${input.decision}`,
    title:
      input.decision === "merge_approved"
        ? "Approve merge"
        : input.decision === "accept"
          ? "Accept reviewed work"
          : "Request changes",
    description: "Apply a structured Presence review decision.",
    icon: null,
    searchTerms: ["presence review", "review decision", input.decision],
    risk: input.decision === "request_changes" ? "instant" : "confirm",
    confirmationMessage:
      input.decision === "merge_approved"
        ? "Approve merge for this result?"
        : "Approve this result?",
    enabled: !submitReviewDecisionMutation.isPending,
    disabledReason: "Presence is already applying a review decision.",
    run: async () => {
      submitReviewDecisionMutation.mutate(input);
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
            The local environment exists, but its API connection is not ready yet. Keep the dev
            server running and refresh once the desktop or web session finishes booting.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (repositoriesQuery.isLoading) {
    return (
      <div className="p-8 text-sm text-muted-foreground">Loading Presence repositories...</div>
    );
  }

  if (!repositories.length) {
    return <PresenceEmptyState onImport={() => importRepositoryMutation.mutate()} />;
  }

  const humanDirectionBriefing =
    board?.ticketBriefings.find((briefing) => briefing.needsHuman) ?? null;
  const rightPanelTicket =
    board?.tickets.find((ticket) => ticket.id === humanDirectionBriefing?.ticketId) ??
    selectedTicket ??
    null;
  const rightPanelAttempt =
    rightPanelTicket && board
      ? (board.attemptSummaries
          .filter((summary) => summary.attempt.ticketId === rightPanelTicket.id)
          .toSorted((left, right) =>
            right.attempt.createdAt.localeCompare(left.attempt.createdAt),
          )[0]?.attempt ?? null)
      : null;
  const rightPanelNeedsHuman =
    rightPanelTicket && board
      ? board.ticketBriefings.some(
          (briefing) => briefing.ticketId === rightPanelTicket.id && briefing.needsHuman,
        )
      : false;
  const rightPanelTicketSummary =
    rightPanelTicket && board
      ? (board.ticketSummaries.find((summary) => summary.ticketId === rightPanelTicket.id) ?? null)
      : null;
  const rightPanelTicketProjectionHealth =
    rightPanelTicket && board
      ? (board.ticketProjectionHealth.find((health) => health.scopeId === rightPanelTicket.id) ??
        null)
      : null;
  const rightPanelTicketAttempts =
    rightPanelTicket && board
      ? board.attemptSummaries.filter((summary) => summary.attempt.ticketId === rightPanelTicket.id)
      : [];
  const rightPanelPrimaryAttemptSummary =
    rightPanelTicket?.id === selectedTicket?.id
      ? primaryAttemptSummary
      : (rightPanelTicketAttempts.find(canReviewAttempt) ?? rightPanelTicketAttempts[0] ?? null);
  const rightPanelMergeableAttemptSummary =
    rightPanelTicket?.id === selectedTicket?.id
      ? mergeableAttemptSummary
      : (rightPanelTicketAttempts.find(
          (summary) => summary.attempt.status === "accepted" && canReviewAttempt(summary),
        ) ?? null);
  const rightPanelApproveDecision =
    rightPanelTicket?.id === selectedTicket?.id ? (approveDecisionQuery.data ?? null) : null;
  const rightPanelMergeDecision =
    rightPanelTicket?.id === selectedTicket?.id ? (mergeDecisionQuery.data ?? null) : null;
  const humanDirectionCount = board?.missionBriefing?.humanActionTicketIds.length ?? 0;
  const submitGoalCommand: PresenceCommandDefinition = {
    id: "presence.goal.submit",
    title: "Send goal to Presence",
    description: "Plan the current goal into Presence tickets.",
    icon: null,
    searchTerms: ["presence goal", "send to presence", "turn goal into tickets"],
    risk: "instant",
    enabled: Boolean(goalDraft.trim()) && !submitGoalIntakeMutation.isPending,
    disabledReason: submitGoalIntakeMutation.isPending
      ? "Presence is already receiving the mission."
      : "Describe the repo-level goal first.",
    run: async () => {
      submitGoalIntakeMutation.mutate();
    },
  };
  const runSupervisorDisabled =
    startSupervisorRunMutation.isPending ||
    Boolean(latestSupervisorRun && latestSupervisorRun.status === "running") ||
    hasActivePresenceRuntimeThread ||
    currentPresenceHarnessUnavailable ||
    humanDirectionCount > 0;
  const runSupervisorReason = currentPresenceHarnessUnavailable
    ? "Presence cannot run because the selected harness is unavailable."
    : latestSupervisorRun?.status === "running"
      ? "Presence is already running a supervisor pass."
      : hasActivePresenceRuntimeThread
        ? "Presence is waiting on active worker or reviewer runtime activity."
        : humanDirectionCount > 0
          ? "Presence needs your direction before it can continue safely."
          : "Presence is idle and ready to run when you need it.";
  const runSupervisorCommand: PresenceCommandDefinition = {
    id: "presence.supervisor.run",
    title: "Run Presence supervisor",
    description: runSupervisorReason,
    icon: null,
    searchTerms: ["presence supervisor", "run supervisor", "resume presence"],
    risk: "instant",
    enabled: !runSupervisorDisabled,
    disabledReason: runSupervisorReason,
    run: async () => {
      startSupervisorRunMutation.mutate();
    },
  };
  const showRunSupervisor =
    !board ||
    (!hasActivePresenceRuntimeThread && latestSupervisorRun?.status !== "running") ||
    runSupervisorDisabled;

  const ticketInspector =
    board && rightPanelTicket ? (
      <TicketWorkspace
        board={board}
        ticket={rightPanelTicket}
        ticketSummary={rightPanelTicketSummary}
        ticketProjectionHealth={rightPanelTicketProjectionHealth}
        capabilityScan={capabilityScanQuery.data ?? board.capabilityScan}
        primaryAttempt={rightPanelPrimaryAttemptSummary}
        mergeableAttempt={rightPanelMergeableAttemptSummary}
        approveDecision={rightPanelApproveDecision}
        mergeDecision={rightPanelMergeDecision}
        startingAttemptId={startAttemptSessionMutation.variables ?? null}
        onCreateAttempt={(ticketId) => createAttemptMutation.mutate(ticketId)}
        onStartAttemptSession={(attemptId) => startAttemptSessionMutation.mutate(attemptId)}
        onResolveFinding={(findingId) => resolveFindingMutation.mutate(findingId)}
        onDismissFinding={(findingId) => dismissFindingMutation.mutate(findingId)}
        onCreateFollowUpProposal={(finding, kind) =>
          createFollowUpProposalMutation.mutate({
            parentTicketId: rightPanelTicket.id,
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
          void executePresenceCommandDefinition(
            reviewDecisionCommand({
              ticketId,
              attemptId,
              decision: "request_changes",
            }),
          )
        }
        onAccept={(ticketId, attemptId) =>
          void executePresenceCommandDefinition(
            reviewDecisionCommand({
              ticketId,
              attemptId,
              decision: "accept",
            }),
          )
        }
        onMerge={(ticketId, attemptId) =>
          void executePresenceCommandDefinition(
            reviewDecisionCommand({
              ticketId,
              attemptId,
              decision: "merge_approved",
            }),
          )
        }
      />
    ) : null;

  const repositoryToolsPanel =
    board && toolsOpen ? (
      <section className="border-t border-border/70 bg-background/55 px-6 py-4">
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
      </section>
    ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.10),transparent_30%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.10),transparent_30%),var(--background)] text-foreground">
      <header className="border-b border-border/70 px-5 py-4 pr-36">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Presence
            </div>
            <div className="mt-1 text-xl font-semibold tracking-tight">
              Executive repo supervision
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              Presence handles the work, recovery, and routing. It only asks you for direction when
              the board truly needs it.
            </div>
          </div>
          <div className="flex flex-wrap items-start gap-3">
            <RepositorySelector
              repositories={repositories}
              selectedRepositoryId={selectedRepositoryId}
              onSelect={(repositoryId) => {
                setSelectedRepositoryId(repositoryId);
                setToolsOpen(false);
              }}
            />
            <details className="group relative mt-[21px]">
              <summary className="flex h-10 cursor-pointer list-none items-center rounded-xl border border-border/70 bg-background/65 px-3 text-sm font-medium text-foreground transition hover:bg-muted/40">
                Repo tools
              </summary>
              <div className="absolute right-0 z-20 mt-2 grid w-48 gap-1 rounded-2xl border border-border/70 bg-popover p-2 shadow-xl">
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-foreground hover:bg-muted/50"
                  onClick={() => importRepositoryMutation.mutate()}
                >
                  <FolderPlusIcon className="size-4" />
                  Import repository
                </button>
                {selectedRepository ? (
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-foreground hover:bg-muted/50"
                    onClick={() => setToolsOpen((open) => !open)}
                  >
                    <BotIcon className="size-4" />
                    {toolsOpen ? "Hide power tools" : "Open power tools"}
                  </button>
                ) : null}
                {selectedRepository ? (
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-foreground hover:bg-muted/50"
                    onClick={() => void invalidatePresence(selectedRepository.boardId)}
                  >
                    <RefreshCcwIcon className="size-4" />
                    Refresh board
                  </button>
                ) : null}
                {selectedRepository ? (
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-foreground hover:bg-muted/50"
                    onClick={() => scanCapabilitiesMutation.mutate()}
                  >
                    <ScanSearchIcon className="size-4" />
                    Rescan repo
                  </button>
                ) : null}
              </div>
            </details>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_420px]">
        <main className="min-h-0 overflow-hidden border-t border-border/70 xl:border-t-0">
          {board ? (
            <div className="flex h-full min-h-0 flex-col">
              <PresenceBriefingSurface
                board={board}
                goalDraft={goalDraft}
                activity={cockpitActivity}
                onGoalDraftChange={setGoalDraft}
                onSubmitGoal={() => void executePresenceCommandDefinition(submitGoalCommand)}
                submitGoalDisabled={submitGoalCommand.enabled === false}
                submitGoalPending={submitGoalIntakeMutation.isPending}
                onRunSupervisor={() => void executePresenceCommandDefinition(runSupervisorCommand)}
                runSupervisorDisabled={runSupervisorCommand.enabled === false}
                runSupervisorReason={
                  runSupervisorCommand.enabled === false
                    ? (runSupervisorCommand.disabledReason ?? runSupervisorReason)
                    : runSupervisorReason
                }
                showRunSupervisor={showRunSupervisor}
              />
              {repositoryToolsPanel}
              <WorkQueueSurface
                board={board}
                selectedTicketId={selectedTicketId}
                capabilityScan={capabilityScanQuery.data ?? board.capabilityScan}
                onSelectTicket={(ticketId) => setSelectedTicketId(ticketId)}
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
              Select a repository to load its Presence board.
            </div>
          )}
        </main>

        <aside className="min-h-0 overflow-hidden border-l border-border/70 bg-gradient-to-b from-muted/20 to-background/80">
          {!board ? (
            <div className="px-5 py-5 text-sm text-muted-foreground">Pick a repository.</div>
          ) : rightPanelNeedsHuman && rightPanelTicket ? (
            <HumanDirectionPanel
              board={board}
              ticket={rightPanelTicket}
              attemptId={rightPanelAttempt?.id ?? null}
              activity={directionActivity}
              isSubmitting={submitHumanDirectionMutation.isPending}
              onSubmit={(input) =>
                void executePresenceCommandDefinition(
                  submitHumanDirectionCommand({
                    ticketId: rightPanelTicket.id,
                    attemptId: input.attemptId,
                    directionKind: input.directionKind,
                    instructions: input.instructions,
                  }),
                )
              }
            >
              {ticketInspector}
            </HumanDirectionPanel>
          ) : (
            <PresenceLiveStatusPanel board={board} ticket={rightPanelTicket}>
              {ticketInspector}
            </PresenceLiveStatusPanel>
          )}
        </aside>
      </div>
    </div>
  );
}
