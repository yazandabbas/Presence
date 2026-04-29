import {
  type AttemptSummary,
  type ProjectionHealthRecord,
  type RepositoryCapabilityScanRecord,
  type RepositorySummary,
  type TicketRecord,
  type TicketSummaryRecord,
} from "@t3tools/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { usePrimaryEnvironmentId } from "~/environments/primary";
import { readEnvironmentApi } from "~/environmentApi";
import { useSettings } from "~/hooks/useSettings";
import { useServerProviders } from "~/rpc/serverState";
import { canReviewAttempt } from "~/components/presence/PresencePresentation";
import {
  boardSnapshotQueryOptions,
  listRepositoriesQueryOptions,
  presenceQueryKeys,
} from "./presenceReactQuery";
import { resolvePresenceHarnessReadiness } from "./providerReadiness";

const EMPTY_REPOSITORIES: RepositorySummary[] = [];

export function usePresenceBoard() {
  const environmentId = usePrimaryEnvironmentId();
  const api = environmentId ? (readEnvironmentApi(environmentId) ?? null) : null;
  const queryClient = useQueryClient();
  const serverProviders = useServerProviders();
  const presenceModelSelection = useSettings((settings) => settings.presence.modelSelection);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  const repositoriesQuery = useQuery({
    ...listRepositoriesQueryOptions(environmentId),
    enabled: environmentId !== null && api !== null,
  });
  const repositories = repositoriesQuery.data ?? EMPTY_REPOSITORIES;

  useEffect(() => {
    if (!selectedRepositoryId && repositories[0]) {
      setSelectedRepositoryId(repositories[0].id);
    }
  }, [repositories, selectedRepositoryId]);

  const selectedRepository = useMemo<RepositorySummary | null>(
    () => repositories.find((repository) => repository.id === selectedRepositoryId) ?? null,
    [repositories, selectedRepositoryId],
  );
  const presenceHarnessReadiness = useMemo(
    () => resolvePresenceHarnessReadiness(serverProviders, presenceModelSelection?.provider),
    [presenceModelSelection?.provider, serverProviders],
  );

  const boardQuery = useQuery({
    ...boardSnapshotQueryOptions(environmentId, selectedRepository?.boardId ?? null),
    enabled: environmentId !== null && api !== null && selectedRepository !== null,
  });
  const board = boardQuery.data;
  const latestSupervisorRun = useMemo(() => board?.supervisorRuns[0] ?? null, [board]);
  const hasActivePresenceRuntimeThread = useMemo(() => {
    if (!board) {
      return false;
    }
    const latestByThread = new Map<string, (typeof board.missionEvents)[number]>();
    for (const event of board.missionEvents) {
      if (
        !event.threadId ||
        !event.threadId.startsWith("presence_") ||
        ![
          "turn_started",
          "turn_completed",
          "turn_failed",
          "tool_started",
          "tool_completed",
          "runtime_warning",
          "runtime_error",
          "approval_requested",
          "user_input_requested",
        ].includes(event.kind)
      ) {
        continue;
      }
      const previous = latestByThread.get(event.threadId);
      if (!previous || event.createdAt.localeCompare(previous.createdAt) > 0) {
        latestByThread.set(event.threadId, event);
      }
    }
    return [...latestByThread.values()].some(
      (event) =>
        event.kind !== "turn_completed" &&
        event.kind !== "turn_failed" &&
        event.kind !== "runtime_error",
    );
  }, [board]);

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
      board?.attemptSummaries.filter(
        (attempt) => attempt.attempt.ticketId === selectedTicket?.id,
      ) ?? [],
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
      return api.presence.getRepositoryCapabilities({
        repositoryId: selectedRepository.id as never,
      });
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

  const invalidatePresence = async (boardId?: string | null) => {
    await queryClient.invalidateQueries({
      queryKey: presenceQueryKeys.repositories(environmentId),
    });
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

  return {
    environmentId,
    api,
    repositoriesQuery,
    repositories,
    selectedRepositoryId,
    setSelectedRepositoryId,
    selectedRepository,
    boardQuery,
    board,
    latestSupervisorRun,
    hasActivePresenceRuntimeThread,
    selectedTicketId,
    setSelectedTicketId,
    selectedTicket,
    selectedTicketAttempts,
    selectedTicketSummary,
    selectedTicketProjectionHealth,
    primaryAttemptSummary,
    mergeableAttemptSummary,
    capabilityScanQuery,
    approveDecisionQuery,
    mergeDecisionQuery,
    currentPresenceHarnessUnavailable: presenceHarnessReadiness.selectedProviderUnavailable,
    invalidatePresence,
  };
}
