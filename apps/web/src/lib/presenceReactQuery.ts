import type { BoardId, EnvironmentId, RepositoryId } from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";

import { ensureEnvironmentApi } from "~/environmentApi";

export const presenceQueryKeys = {
  all: ["presence"] as const,
  repositories: (environmentId: EnvironmentId | null) =>
    ["presence", "repositories", environmentId] as const,
  boardSnapshot: (environmentId: EnvironmentId | null, boardId: BoardId | null) =>
    ["presence", "board", environmentId, boardId] as const,
  repositorySelection: (repositoryId: RepositoryId | null) =>
    ["presence", "repository-selection", repositoryId] as const,
};

export function listRepositoriesQueryOptions(environmentId: EnvironmentId | null) {
  return queryOptions({
    queryKey: presenceQueryKeys.repositories(environmentId),
    queryFn: async () => {
      if (!environmentId) {
        throw new Error("Presence repository listing requires an environment.");
      }
      return ensureEnvironmentApi(environmentId).presence.listRepositories({});
    },
    enabled: environmentId !== null,
  });
}

export function boardSnapshotQueryOptions(
  environmentId: EnvironmentId | null,
  boardId: BoardId | null,
) {
  return queryOptions({
    queryKey: presenceQueryKeys.boardSnapshot(environmentId, boardId),
    queryFn: async () => {
      if (!environmentId || !boardId) {
        throw new Error("Presence board snapshot requires both environment and board.");
      }
      return ensureEnvironmentApi(environmentId).presence.getBoardSnapshot({ boardId });
    },
    enabled: environmentId !== null && boardId !== null,
  });
}
