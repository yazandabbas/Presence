import { existsSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CheckpointRef,
  EventId,
  type ModelSelection,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  MessageId,
  type ServerProvider,
  TurnId,
} from "@t3tools/contracts";
import { Effect, Layer, ManagedRuntime, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { vi } from "vitest";

import { ServerConfig } from "../../config.ts";
import { GitCoreLive } from "../../git/Layers/GitCore.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { PresenceControlPlane } from "../Services/PresenceControlPlane.ts";
import { PresenceControlPlaneLive } from "./PresenceControlPlane.ts";

const DEFAULT_MODEL_SELECTION = {
  provider: "codex",
  model: "gpt-5.4",
} satisfies ModelSelection;

const DEFAULT_PROVIDER: ServerProvider = {
  provider: "codex",
  enabled: true,
  installed: true,
  version: "0.0.0-test",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-04-21T00:00:00.000Z",
  models: [
    {
      slug: "gpt-5.4",
      name: "GPT-5.4",
      isCustom: false,
      capabilities: null,
    },
  ],
  slashCommands: [],
  skills: [],
};

const CLAUDE_PROVIDER: ServerProvider = {
  provider: "claudeAgent",
  enabled: true,
  installed: true,
  version: "0.0.0-test",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-04-21T00:00:00.000Z",
  models: [
    {
      slug: "claude-sonnet-4",
      name: "Claude Sonnet 4",
      isCustom: false,
      capabilities: null,
    },
  ],
  slashCommands: [],
  skills: [],
};

vi.setConfig({ testTimeout: 30_000 });

async function runGit(cwd: string, args: ReadonlyArray<string>) {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout: 20_000,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `git -C ${cwd} ${args.join(" ")} failed (code=${result.status ?? "null"}). ${result.stderr?.trim() ?? ""}`.trim(),
    );
  }
  return (result.stdout ?? "").trim();
}

async function createGitRepository(prefix: string) {
  const repoRoot = await fs.mkdtemp(path.join(tmpdir(), prefix));
  await runGit(repoRoot, ["init", "--initial-branch=main"]);
  await runGit(repoRoot, ["config", "user.name", "Presence Test"]);
  await runGit(repoRoot, ["config", "user.email", "presence-test@example.com"]);
  await fs.writeFile(path.join(repoRoot, "README.md"), "# Presence Test\n", "utf8");
  await runGit(repoRoot, ["add", "README.md"]);
  await runGit(repoRoot, ["commit", "-m", "initial commit"]);
  return repoRoot;
}

async function createUnbornGitRepository(prefix: string) {
  const repoRoot = await fs.mkdtemp(path.join(tmpdir(), prefix));
  await runGit(repoRoot, ["init", "--initial-branch=main"]);
  await runGit(repoRoot, ["config", "user.name", "Presence Test"]);
  await runGit(repoRoot, ["config", "user.email", "presence-test@example.com"]);
  await fs.writeFile(path.join(repoRoot, "README.md"), "# Presence Test\n", "utf8");
  return repoRoot;
}

function createMockOrchestrationEngine(
  initialProjects: Array<OrchestrationReadModel["projects"][number]> = [],
  options?: {
    dispatchDelayMsByType?: Partial<Record<OrchestrationCommand["type"], number>>;
    failDispatchByTypeOnce?: Partial<Record<OrchestrationCommand["type"], string>>;
  },
) {
  let sequence = 0;
  const now = "2026-04-21T00:00:00.000Z";
  const commands: OrchestrationCommand[] = [];
  const projects: Array<OrchestrationReadModel["projects"][number]> = [...initialProjects];
  const threads: Array<OrchestrationReadModel["threads"][number]> = [];

  const readModel = (): OrchestrationReadModel => ({
    snapshotSequence: sequence,
    updatedAt: now,
    projects,
    threads,
  });
  const failDispatchByTypeOnce = { ...(options?.failDispatchByTypeOnce ?? {}) };

  return {
    commands,
    failNextDispatch: (type: OrchestrationCommand["type"], message: string) => {
      failDispatchByTypeOnce[type] = message;
    },
    pushAssistantMessage: (input: {
      threadId: string;
      text: string;
      createdAt?: string;
      updatedAt?: string;
    }) => {
      const index = threads.findIndex((thread) => thread.id === input.threadId);
      if (index < 0) return;
      const thread = threads[index]!;
      sequence += 1;
      const createdAt = input.createdAt ?? now;
      const updatedAt = input.updatedAt ?? createdAt;
      threads[index] = {
        ...thread,
        updatedAt,
        messages: [
          ...thread.messages,
          {
            id: MessageId.make(`assistant-message-${sequence}`),
            turnId: thread.latestTurn?.turnId ?? null,
            role: "assistant",
            text: input.text,
            streaming: false,
            attachments: [],
            createdAt,
            updatedAt,
          },
        ],
      };
    },
    appendActivity: (input: {
      threadId: string;
      kind: string;
      summary: string;
      createdAt?: string;
    }) => {
      const index = threads.findIndex((thread) => thread.id === input.threadId);
      if (index < 0) return;
      const thread = threads[index]!;
      sequence += 1;
      const createdAt = input.createdAt ?? now;
      threads[index] = {
        ...thread,
        updatedAt: createdAt,
        activities: [
          ...thread.activities,
          {
            id: EventId.make(`activity-${sequence}`),
            tone: input.kind.includes("error") ? "error" : input.kind.includes("tool") ? "tool" : "info",
            kind: input.kind,
            summary: input.summary,
            payload: {},
            turnId: thread.latestTurn?.turnId ?? null,
            sequence,
            createdAt,
          },
        ],
      };
    },
    setCheckpoint: (input: {
      threadId: string;
      files: ReadonlyArray<string>;
      completedAt?: string;
    }) => {
      const index = threads.findIndex((thread) => thread.id === input.threadId);
      if (index < 0) return;
      const thread = threads[index]!;
      if (!thread.latestTurn) return;
      sequence += 1;
      const completedAt = input.completedAt ?? now;
      threads[index] = {
        ...thread,
        updatedAt: completedAt,
        checkpoints: [
          ...thread.checkpoints,
          {
            turnId: thread.latestTurn.turnId,
            checkpointTurnCount: thread.checkpoints.length + 1,
            checkpointRef: CheckpointRef.make(`checkpoint-${sequence}`),
            status: "ready",
            files: input.files.map((file) => ({
              path: file,
              kind: "modified",
              additions: 1,
              deletions: 0,
            })),
            assistantMessageId: null,
            completedAt,
          },
        ],
      };
    },
    setLatestTurnState: (input: {
      threadId: string;
      state: "running" | "interrupted" | "completed" | "error";
      completedAt?: string | null;
    }) => {
      const index = threads.findIndex((thread) => thread.id === input.threadId);
      if (index < 0) return;
      const thread = threads[index]!;
      if (!thread.latestTurn) return;
      threads[index] = {
        ...thread,
        updatedAt: input.completedAt ?? now,
        latestTurn: {
          ...thread.latestTurn,
          state: input.state,
          completedAt:
            input.state === "running"
              ? null
              : (input.completedAt ?? thread.latestTurn.completedAt ?? now),
        },
      };
    },
    removeThread: (threadId: string) => {
      const index = threads.findIndex((thread) => thread.id === threadId);
      if (index < 0) return;
      sequence += 1;
      threads.splice(index, 1);
    },
    service: {
      getReadModel: () => Effect.succeed(readModel()),
      readEvents: () => Stream.empty,
      streamDomainEvents: Stream.empty,
      dispatch: (command: OrchestrationCommand) =>
        Effect.gen(function* () {
          const delayMs = options?.dispatchDelayMsByType?.[command.type] ?? 0;
          if (delayMs > 0) {
            yield* Effect.sleep(delayMs);
          }
          const failureMessage = failDispatchByTypeOnce[command.type];
          if (failureMessage) {
            delete failDispatchByTypeOnce[command.type];
            throw new Error(failureMessage);
          }
          commands.push(command);
          sequence += 1;

          switch (command.type) {
            case "project.create":
              projects.push({
                id: command.projectId,
                title: command.title,
                workspaceRoot: command.workspaceRoot,
                defaultModelSelection: command.defaultModelSelection ?? null,
                scripts: [],
                createdAt: command.createdAt,
                updatedAt: command.createdAt,
                deletedAt: null,
              });
              break;
            case "thread.create":
              threads.push({
                id: command.threadId,
                projectId: command.projectId,
                title: command.title,
                systemPrompt: command.systemPrompt ?? null,
                modelSelection: command.modelSelection,
                interactionMode: command.interactionMode,
                runtimeMode: command.runtimeMode,
                branch: command.branch,
                worktreePath: command.worktreePath,
                latestTurn: null,
                createdAt: command.createdAt,
                updatedAt: command.createdAt,
                archivedAt: null,
                deletedAt: null,
                messages: [],
                proposedPlans: [],
                activities: [],
                checkpoints: [],
                session: null,
              });
              break;
            case "thread.meta.update":
              {
                const index = threads.findIndex((thread) => thread.id === command.threadId);
                if (index >= 0) {
                  const thread = threads[index]!;
                  threads[index] = {
                    ...thread,
                    ...(command.branch !== undefined ? { branch: command.branch } : {}),
                    ...(command.worktreePath !== undefined
                      ? { worktreePath: command.worktreePath }
                      : {}),
                  };
                }
              }
              break;
            case "thread.turn.start":
              {
                const index = threads.findIndex((thread) => thread.id === command.threadId);
                if (index >= 0) {
                  const thread = threads[index]!;
                  threads[index] = {
                    ...thread,
                    latestTurn: {
                      turnId: TurnId.make(`turn-${sequence}`),
                      state: "running",
                      requestedAt: command.createdAt,
                      startedAt: null,
                      completedAt: null,
                      assistantMessageId: null,
                    },
                    updatedAt: command.createdAt,
                    messages: [
                      ...thread.messages,
                      {
                        id: command.message.messageId,
                        turnId: null,
                        role: command.message.role,
                        text: command.message.text,
                        streaming: false,
                        attachments: command.message.attachments,
                        createdAt: command.createdAt,
                        updatedAt: command.createdAt,
                      },
                    ],
                  };
                }
              }
              break;
          }
          return { sequence };
        }),
    } satisfies typeof OrchestrationEngineService.Service,
  };
}

async function createPresenceSystem(options?: {
  providers?: ReadonlyArray<ServerProvider>;
  initialProjects?: Array<OrchestrationReadModel["projects"][number]>;
  dispatchDelayMsByType?: Partial<Record<OrchestrationCommand["type"], number>>;
  failDispatchByTypeOnce?: Partial<Record<OrchestrationCommand["type"], string>>;
}) {
  const orchestration = createMockOrchestrationEngine(
    options?.initialProjects ?? [],
    options?.dispatchDelayMsByType || options?.failDispatchByTypeOnce
      ? {
          ...(options?.dispatchDelayMsByType
            ? { dispatchDelayMsByType: options.dispatchDelayMsByType }
            : {}),
          ...(options?.failDispatchByTypeOnce
            ? { failDispatchByTypeOnce: options.failDispatchByTypeOnce }
            : {}),
        }
      : undefined,
  );
  const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
    prefix: "t3-presence-control-plane-test-",
  });
  const platformLayer = serverConfigLayer.pipe(Layer.provideMerge(NodeServices.layer));
  const providerRegistryLayer = Layer.succeed(ProviderRegistry, {
    getProviders: Effect.succeed([...((options?.providers ?? [DEFAULT_PROVIDER]) as ReadonlyArray<ServerProvider>)]),
    refresh: () =>
      Effect.succeed([...((options?.providers ?? [DEFAULT_PROVIDER]) as ReadonlyArray<ServerProvider>)]),
    streamChanges: Stream.empty,
  });
  const gitCoreLayer = GitCoreLive.pipe(Layer.provide(platformLayer));
  const sqliteLayer = SqlitePersistenceMemory.pipe(Layer.provide(platformLayer));
  const presenceLayer = PresenceControlPlaneLive.pipe(
    Layer.provideMerge(sqliteLayer),
    Layer.provideMerge(gitCoreLayer),
    Layer.provideMerge(Layer.succeed(OrchestrationEngineService, orchestration.service)),
    Layer.provideMerge(providerRegistryLayer),
    Layer.provideMerge(ServerSettingsService.layerTest()),
  );
  const layer = presenceLayer.pipe(Layer.provide(platformLayer));

  const runtime = ManagedRuntime.make(layer);
  const presence = await runtime.runPromise(Effect.service(PresenceControlPlane));
  const sql = await runtime.runPromise(Effect.service(SqlClient.SqlClient));
  return {
    presence,
    sql,
    commands: orchestration.commands,
    orchestration,
    dispose: () => runtime.dispose(),
  };
}

function normalizeProjectionPath(filePath: unknown): string {
  return String(filePath ?? "").replace(/\\/g, "/");
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 5_000,
  intervalMs = 100,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for condition.");
}

async function removeTempRepo(repoRoot: string) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await fs.rm(path.join(repoRoot, ".presence"), { recursive: true, force: true });
      await fs.rm(repoRoot, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try {
    await fs.rm(path.join(repoRoot, ".presence"), { recursive: true, force: true });
    await fs.rm(repoRoot, { recursive: true, force: true });
  } catch {
    // Best effort cleanup is enough for temp repos in this suite.
  }
}

function buildReviewResultBlock(input: {
  decision: "accept" | "request_changes" | "escalate";
  summary: string;
  checklistAssessment: Array<{ label: string; satisfied: boolean; notes: string }>;
  findings?: Array<{
    severity: "blocking" | "warning" | "info";
    disposition: "same_ticket" | "child_ticket" | "blocker_ticket" | "escalate";
    summary: string;
    rationale: string;
  }>;
  evidence?: Array<{ summary: string }>;
  changedFilesReviewed?: string[];
}) {
  return [
    "[PRESENCE_REVIEW_RESULT]",
    JSON.stringify(
      {
        decision: input.decision,
        summary: input.summary,
        checklistAssessment: input.checklistAssessment,
        findings: input.findings ?? [],
        evidence: input.evidence ?? [],
        changedFilesReviewed: input.changedFilesReviewed ?? [],
      },
      null,
      2,
    ),
    "[/PRESENCE_REVIEW_RESULT]",
  ].join("\n");
}

export {
  buildReviewResultBlock,
  CLAUDE_PROVIDER,
  createGitRepository,
  createPresenceSystem,
  createUnbornGitRepository,
  DEFAULT_MODEL_SELECTION,
  DEFAULT_PROVIDER,
  normalizeProjectionPath,
  removeTempRepo,
  runGit,
  waitFor,
};
