import { existsSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  type ModelSelection,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  type ServerProvider,
  TurnId,
} from "@t3tools/contracts";
import { Effect, Layer, ManagedRuntime, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";

import { ServerConfig } from "../../config.ts";
import { GitCoreLive } from "../../git/Layers/GitCore.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { PresenceControlPlane } from "../Services/PresenceControlPlane.ts";
import { PresenceControlPlaneLive } from "./PresenceControlPlane.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";

const DEFAULT_MODEL_SELECTION = {
  provider: "codex",
  model: "gpt-5.4",
} satisfies ModelSelection;

vi.setConfig({ testTimeout: 30_000 });

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

  return {
    commands,
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
            id: `assistant-message-${sequence}` as never,
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
            id: `activity-${sequence}` as never,
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
            checkpointRef: `checkpoint-${sequence}` as never,
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
    service: {
      getReadModel: () => Effect.succeed(readModel()),
      readEvents: () => Stream.empty,
      streamDomainEvents: Stream.empty,
      dispatch: (command: OrchestrationCommand) =>
        Effect.sync(() => {
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
}) {
  const orchestration = createMockOrchestrationEngine(options?.initialProjects ?? []);
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
  );
  const layer = presenceLayer.pipe(Layer.provide(platformLayer));

  const runtime = ManagedRuntime.make(layer);
  const presence = await runtime.runPromise(Effect.service(PresenceControlPlane));
  return {
    presence,
    commands: orchestration.commands,
    orchestration,
    dispose: () => runtime.dispose(),
  };
}

describe("PresenceControlPlaneLive workspace lifecycle", () => {
  it("prepares a git worktree for an attempt", async () => {
    const repoRoot = await createGitRepository("presence-workspace-prepare-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Check workspace lifecycle",
        description: "Prepare a worktree for this attempt.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      const workspace = await system.presence.prepareWorkspace({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      expect(workspace.status).toBe("ready");
      expect(workspace.branch).toMatch(/^feature\//);
      expect(workspace.worktreePath).not.toBeNull();
      expect(existsSync(workspace.worktreePath ?? "")).toBe(true);
      expect(existsSync(path.join(workspace.worktreePath ?? "", "README.md"))).toBe(true);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(snapshot.workspaces[0]?.status).toBe("ready");
      expect(snapshot.workspaces[0]?.worktreePath).toBe(workspace.worktreePath);
    } finally {
      await system.dispose();
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("starts one thread per attempt and reuses it on reopen", async () => {
    const repoRoot = await createGitRepository("presence-workspace-session-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Check session reuse",
        description: "Reopening should not create a second thread.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      const firstSession = await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      const secondSession = await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      expect(secondSession.threadId).toBe(firstSession.threadId);
      const threadCreates = system.commands.filter((command) => command.type === "thread.create");
      const turnStarts = system.commands.filter((command) => command.type === "thread.turn.start");
      expect(threadCreates).toHaveLength(1);
      expect(turnStarts).toHaveLength(1);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(snapshot.attempts[0]?.threadId).toBe(firstSession.threadId);
      expect(snapshot.workspaces[0]?.status).toBe("busy");
      expect(snapshot.workspaces[0]?.worktreePath).not.toBeNull();
    } finally {
      await system.dispose();
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("bootstraps a fresh attempt session with a worker kickoff packet", async () => {
    const repoRoot = await createGitRepository("presence-workspace-bootstrap-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Investigate renderer spacing",
        description: "Find the main layout issues and tighten the surface without broad redesign.",
        priority: "p1",
        acceptanceChecklist: [
          { id: "check-layout", label: "Layout issues identified", checked: false },
          { id: "check-validation", label: "Validation captured", checked: false },
        ],
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      await system.presence.saveSupervisorHandoff({
        boardId: repository.boardId,
        topPriorities: ["Investigate renderer spacing"],
        activeAttemptIds: [attempt.id],
        blockedTicketIds: [],
        recentDecisions: ["Keep the redesign narrow and preserve current runtime behavior."],
        nextBoardActions: ["Review the first proposed layout pass."],
      }).pipe(Effect.runPromise);

      await system.presence.saveWorkerHandoff({
        attemptId: attempt.id,
        completedWork: ["Reviewed the current board composition and identified oversized empty states."],
        currentHypothesis: "The center board region is too wide for the amount of content shown.",
        changedFiles: ["apps/web/src/components/presence/PresenceDashboard.tsx"],
        testsRun: ["apps/web typecheck"],
        blockers: [],
        nextStep: "Tighten the kanban lane widths and move noisy controls into the inspector.",
        confidence: 0.68,
        evidenceIds: [],
      }).pipe(Effect.runPromise);

      const session = await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      const turnStarts = system.commands.filter(
        (command): command is Extract<OrchestrationCommand, { type: "thread.turn.start" }> =>
          command.type === "thread.turn.start",
      );
      const threadCreates = system.commands.filter(
        (command): command is Extract<OrchestrationCommand, { type: "thread.create" }> =>
          command.type === "thread.create",
      );
      expect(turnStarts).toHaveLength(1);
      expect(threadCreates[0]?.systemPrompt).toContain("Presence worker role");
      expect(threadCreates[0]?.systemPrompt).toContain("Execution loop:");
      expect(threadCreates[0]?.systemPrompt).toContain("Handoff discipline:");
      expect(turnStarts[0]?.threadId).toBe(session.threadId);
      expect(turnStarts[0]?.titleSeed).toBe(ticket.title);
      expect(turnStarts[0]?.message.text).toContain("Investigate renderer spacing");
      expect(turnStarts[0]?.message.text).toContain(ticket.description);
      expect(turnStarts[0]?.message.text).toContain("Layout issues identified");
      expect(turnStarts[0]?.message.text).toContain("Find the main layout issues and tighten the surface");
      expect(turnStarts[0]?.message.text).toContain(
        "Reviewed the current board composition and identified oversized empty states.",
      );
      expect(turnStarts[0]?.message.text).toContain(
        "Keep the redesign narrow and preserve current runtime behavior.",
      );
      expect(turnStarts[0]?.message.text).not.toContain("Top priorities");
      expect(turnStarts[0]?.message.text).not.toContain("Presence worker role");
      expect(turnStarts[0]?.message.text).toContain("Worktree path:");
      expect(turnStarts[0]?.message.text).toContain("[PRESENCE_HANDOFF]");
      expect(turnStarts[0]?.message.text).toContain("Current hypothesis:");
    } finally {
      await system.dispose();
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("reuses the repository default model selection for new attempts", async () => {
    const repoRoot = await createGitRepository("presence-provider-default-");
    const system = await createPresenceSystem({
      providers: [DEFAULT_PROVIDER, CLAUDE_PROVIDER],
      initialProjects: [
        {
          id: "project-seeded-default" as never,
          title: "Seeded default",
          workspaceRoot: repoRoot,
          defaultModelSelection: {
            provider: "claudeAgent",
            model: "claude-sonnet-4",
          },
          scripts: [],
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
          deletedAt: null,
        },
      ],
    });

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Keep provider stable",
        description: "New attempts should keep the repository default selection.",
        priority: "p2",
      }).pipe(Effect.runPromise);

      const firstAttempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);
      const firstSession = await system.presence.startAttemptSession({
        attemptId: firstAttempt.id,
      }).pipe(Effect.runPromise);
      expect(firstSession.provider).toBe("claudeAgent");
      expect(firstSession.model).toBe("claude-sonnet-4");

      const secondAttempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);
      const secondSession = await system.presence.startAttemptSession({
        attemptId: secondAttempt.id,
      }).pipe(Effect.runPromise);
      expect(secondSession.provider).toBe("claudeAgent");
      expect(secondSession.model).toBe("claude-sonnet-4");
    } finally {
      await system.dispose();
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("starts an attempt session for repos that have not made their first commit yet", async () => {
    const repoRoot = await createUnbornGitRepository("presence-workspace-unborn-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Investigate setup issues",
        description: "Start work even if the repo has only been initialized and not committed yet.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      const session = await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      const workspace = snapshot.workspaces[0];
      const turnStarts = system.commands.filter(
        (command): command is Extract<OrchestrationCommand, { type: "thread.turn.start" }> =>
          command.type === "thread.turn.start",
      );

      expect(session.threadId).toBeDefined();
      expect(workspace?.status).toBe("busy");
      expect(workspace?.branch).toMatch(/^feature\//);
      expect(workspace?.worktreePath).not.toBeNull();
      expect(existsSync(workspace?.worktreePath ?? "")).toBe(true);
      expect(turnStarts).toHaveLength(1);
      expect(turnStarts[0]?.threadId).toBe(session.threadId);
    } finally {
      await system.dispose();
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects approving an attempt that never actually started work", async () => {
    const repoRoot = await createGitRepository("presence-review-guard-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Guard empty attempt",
        description: "Do not approve an attempt before it starts.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      await expect(
        system.presence.submitReviewDecision({
          ticketId: ticket.id,
          attemptId: attempt.id,
          decision: "accept",
          notes: "This should fail because the attempt never started.",
        }).pipe(Effect.runPromise),
      ).rejects.toThrow(/Failed to submit review decision\./);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(snapshot.tickets[0]?.status).toBe("in_progress");
      expect(snapshot.attempts[0]?.status).toBe("planned");
    } finally {
      await system.dispose();
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("scans repository capabilities for JavaScript repos and discovers validation commands", async () => {
    const repoRoot = await createGitRepository("presence-capabilities-node-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify(
          {
            name: "presence-node-test",
            scripts: {
              test: "vitest run",
              build: "tsc -b",
              lint: "eslint .",
              dev: "vite",
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add validation scripts"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Node Repo",
      }).pipe(Effect.runPromise);

      const scan = await system.presence.getRepositoryCapabilities({
        repositoryId: repository.id,
      }).pipe(Effect.runPromise);

      expect(scan).not.toBeNull();
      expect(scan?.ecosystems).toContain("node");
      expect(scan?.discoveredCommands.map((command) => command.command)).toContain("npm run test");
      expect(scan?.hasValidationCapability).toBe(true);
    } finally {
      await system.dispose();
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("scans repository capabilities for Rust repos and marks repos without automation as needing a waiver", async () => {
    const rustRepo = await createGitRepository("presence-capabilities-rust-");
    const plainRepo = await createGitRepository("presence-capabilities-plain-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(
        path.join(rustRepo, "Cargo.toml"),
        ['[package]', 'name = "presence-rust-test"', 'version = "0.1.0"', 'edition = "2021"'].join("\n"),
        "utf8",
      );

      const rustRepository = await system.presence.importRepository({
        workspaceRoot: rustRepo,
        title: "Presence Rust Repo",
      }).pipe(Effect.runPromise);
      const plainRepository = await system.presence.importRepository({
        workspaceRoot: plainRepo,
        title: "Presence Plain Repo",
      }).pipe(Effect.runPromise);

      const rustScan = await system.presence.getRepositoryCapabilities({
        repositoryId: rustRepository.id,
      }).pipe(Effect.runPromise);
      const plainScan = await system.presence.getRepositoryCapabilities({
        repositoryId: plainRepository.id,
      }).pipe(Effect.runPromise);

      expect(rustScan?.ecosystems).toContain("rust");
      expect(rustScan?.discoveredCommands.map((command) => command.command)).toContain("cargo test");
      expect(rustScan?.hasValidationCapability).toBe(true);

      expect(plainScan?.hasValidationCapability).toBe(false);
      expect(plainScan?.riskSignals).toContain("No obvious validation command was discovered.");
    } finally {
      await system.dispose();
      await fs.rm(rustRepo, { recursive: true, force: true });
      await fs.rm(plainRepo, { recursive: true, force: true });
    }
  });

  it("blocks approval without validation capability and allows it after a human waiver", async () => {
    const repoRoot = await createGitRepository("presence-waiver-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Plain Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Investigate undocumented flow",
        description: "This repo intentionally has no validation scripts.",
        priority: "p2",
        acceptanceChecklist: [
          { id: "check-1", label: "Mechanism understood", checked: true },
          { id: "check-2", label: "Evidence attached", checked: true },
          { id: "check-3", label: "Validation recorded", checked: true },
        ],
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      const decision = await system.presence.evaluateSupervisorAction({
        action: "approve_attempt",
        ticketId: ticket.id,
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      expect(decision.allowed).toBe(false);
      expect(decision.requiresHumanValidationWaiver).toBe(true);
      expect(decision.reasons.join(" ")).toMatch(/human validation waiver is required/i);

      await expect(
        system.presence.submitReviewDecision({
          ticketId: ticket.id,
          attemptId: attempt.id,
          decision: "accept",
          notes: "This should require a waiver first.",
        }).pipe(Effect.runPromise),
      ).rejects.toThrow(/Failed to submit review decision\./);

      const waiver = await system.presence.recordValidationWaiver({
        ticketId: ticket.id,
        attemptId: attempt.id,
        reason: "Validated manually against the repo's current behavior.",
        grantedBy: "human",
      }).pipe(Effect.runPromise);

      expect(waiver.reason).toContain("Validated manually");

      await system.presence.submitReviewDecision({
        ticketId: ticket.id,
        attemptId: attempt.id,
        decision: "accept",
        notes: "Human waiver recorded.",
      }).pipe(Effect.runPromise);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);

      expect(snapshot.tickets[0]?.status).toBe("ready_to_merge");
      expect(snapshot.attempts[0]?.status).toBe("accepted");
      expect(snapshot.validationWaivers).toHaveLength(1);
    } finally {
      await system.dispose();
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("runs validation in the attempt workspace and auto-completes evidence-related checklist items", async () => {
    const repoRoot = await createGitRepository("presence-validation-pass-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify(
          {
            name: "presence-validation-pass",
            scripts: {
              lint: 'node -e "process.exit(0)"',
              test: 'node -e "process.exit(0)"',
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add validation scripts"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Validation Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Validate attempt output",
        description: "Run validation and capture the result as review evidence.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      const validationRuns = await system.presence.runAttemptValidation({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      expect(validationRuns.length).toBeGreaterThanOrEqual(2);
      expect(validationRuns.every((run) => run.status === "passed")).toBe(true);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      const snapshotTicket = snapshot.tickets.find((candidate) => candidate.id === ticket.id);
      expect(snapshot.validationRuns.length).toBe(validationRuns.length);
      expect(snapshot.evidence.length).toBeGreaterThanOrEqual(validationRuns.length);
      expect(
        snapshotTicket?.acceptanceChecklist.find((item) => /Mechanism understood/i.test(item.label))
          ?.checked,
      ).toBe(false);
      expect(
        snapshotTicket?.acceptanceChecklist.find((item) => /Evidence attached/i.test(item.label))
          ?.checked,
      ).toBe(true);
      expect(
        snapshotTicket?.acceptanceChecklist.find(
          (item) => /Validation recorded|Tests or validation captured/i.test(item.label),
        )?.checked,
      ).toBe(true);

      const blockedDecision = await system.presence.evaluateSupervisorAction({
        action: "approve_attempt",
        ticketId: ticket.id,
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      expect(blockedDecision.allowed).toBe(false);
      expect(blockedDecision.reasons.join(" ")).toMatch(/acceptance checklist items must be completed/i);

      await system.presence.updateTicket({
        ticketId: ticket.id,
        acceptanceChecklist:
          snapshotTicket?.acceptanceChecklist.map((item) =>
            /Mechanism understood/i.test(item.label) ? { ...item, checked: true } : item,
          ) ?? [],
      }).pipe(Effect.runPromise);

      const approvedDecision = await system.presence.evaluateSupervisorAction({
        action: "approve_attempt",
        ticketId: ticket.id,
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      expect(approvedDecision.allowed).toBe(true);
    } finally {
      await system.dispose();
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("blocks approval when the latest validation batch fails", async () => {
    const repoRoot = await createGitRepository("presence-validation-fail-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify(
          {
            name: "presence-validation-fail",
            scripts: {
              lint: 'node -e "process.exit(0)"',
              test: 'node -e "process.exit(1)"',
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add failing validation scripts"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Validation Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Reject failed validation",
        description: "Approval should stay blocked when the latest validation batch fails.",
        priority: "p2",
        acceptanceChecklist: [
          { id: "check-1", label: "Mechanism understood", checked: true },
          { id: "check-2", label: "Evidence attached", checked: true },
          { id: "check-3", label: "Validation recorded", checked: true },
        ],
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      const validationRuns = await system.presence.runAttemptValidation({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      expect(validationRuns.some((run) => run.status === "failed")).toBe(true);

      const decision = await system.presence.evaluateSupervisorAction({
        action: "approve_attempt",
        ticketId: ticket.id,
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      expect(decision.allowed).toBe(false);
      expect(decision.reasons.join(" ")).toMatch(/latest validation run must pass/i);
    } finally {
      await system.dispose();
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("scans dirty and unborn repositories without crashing", async () => {
    const dirtyRepo = await createGitRepository("presence-capabilities-dirty-");
    const unbornRepo = await createUnbornGitRepository("presence-capabilities-unborn-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(path.join(dirtyRepo, "README.md"), "# Presence Test\ndirty\n", "utf8");

      const dirtyRepository = await system.presence.importRepository({
        workspaceRoot: dirtyRepo,
        title: "Dirty Repo",
      }).pipe(Effect.runPromise);
      const unbornRepository = await system.presence.importRepository({
        workspaceRoot: unbornRepo,
        title: "Unborn Repo",
      }).pipe(Effect.runPromise);

      const dirtyScan = await system.presence.getRepositoryCapabilities({
        repositoryId: dirtyRepository.id,
      }).pipe(Effect.runPromise);
      const unbornScan = await system.presence.getRepositoryCapabilities({
        repositoryId: unbornRepository.id,
      }).pipe(Effect.runPromise);

      expect(dirtyScan?.isClean).toBe(false);
      expect(unbornScan).not.toBeNull();
      expect(unbornScan?.baseBranch).toBe("main");
    } finally {
      await system.dispose();
      await fs.rm(dirtyRepo, { recursive: true, force: true });
      await fs.rm(unbornRepo, { recursive: true, force: true });
    }
  });

  it("creates tickets from repo-level goal intake without over-decomposing a simple request", async () => {
    const repoRoot = await createGitRepository("presence-goal-simple-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Goal Repo",
      }).pipe(Effect.runPromise);

      const simple = await system.presence.submitGoalIntake({
        boardId: repository.boardId,
        rawGoal: "Audit the onboarding flow and capture the biggest reliability risk.",
        source: "human_goal",
        priorityHint: "p2",
      }).pipe(Effect.runPromise);

      expect(simple.decomposed).toBe(false);
      expect(simple.createdTickets).toHaveLength(1);

      const decomposed = await system.presence.submitGoalIntake({
        boardId: repository.boardId,
        rawGoal: [
          "- Add a repository AGENTS.md guide",
          "- Tighten the auth validation path",
          "- Capture the new runbook in memory",
        ].join("\n"),
        source: "human_goal",
        priorityHint: "p2",
      }).pipe(Effect.runPromise);

      expect(decomposed.decomposed).toBe(true);
      expect(decomposed.createdTickets).toHaveLength(3);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(snapshot.goalIntakes).toHaveLength(2);
      expect(snapshot.tickets).toHaveLength(4);
    } finally {
      await system.dispose();
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("accepts an attempt for merge and only marks the ticket done after merge approval", async () => {
    const repoRoot = await createGitRepository("presence-workspace-merge-normal-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify({ name: "presence-merge", scripts: { test: 'node -e "process.exit(0)"' } }, null, 2),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add merge validation scripts"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Merge normal attempt",
        description: "Promote an approved attempt back into the main branch.",
        priority: "p2",
        acceptanceChecklist: [
          { id: "check-1", label: "Mechanism understood", checked: true },
          { id: "check-2", label: "Evidence attached", checked: true },
          { id: "check-3", label: "Validation recorded", checked: true },
        ],
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      await system.presence.runAttemptValidation({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      const activeSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      const worktreePath = activeSnapshot.workspaces[0]?.worktreePath;
      if (!worktreePath) throw new Error("Expected a prepared worktree.");

      await fs.writeFile(
        path.join(worktreePath, "README.md"),
        "# Presence Test\nmerged from normal attempt\n",
        "utf8",
      );

      await system.presence.submitReviewDecision({
        ticketId: ticket.id,
        attemptId: attempt.id,
        decision: "accept",
        notes: "Approved and ready for merge.",
      }).pipe(Effect.runPromise);

      const acceptedSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(acceptedSnapshot.tickets[0]?.status).toBe("ready_to_merge");
      expect(acceptedSnapshot.attempts[0]?.status).toBe("accepted");

      await system.presence.submitReviewDecision({
        ticketId: ticket.id,
        attemptId: attempt.id,
        decision: "merge_approved",
        notes: "Merge the approved attempt into the base branch.",
      }).pipe(Effect.runPromise);

      const mergedSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(mergedSnapshot.tickets[0]?.status).toBe("done");
      expect(mergedSnapshot.attempts[0]?.status).toBe("merged");
      expect(mergedSnapshot.workspaces[0]?.status).toBe("cleaned_up");
      expect(mergedSnapshot.workspaces[0]?.worktreePath).toBeNull();
      expect(existsSync(worktreePath)).toBe(false);
      expect(await fs.readFile(path.join(repoRoot, "README.md"), "utf8")).toContain(
        "merged from normal attempt",
      );
    } finally {
      await system.dispose();
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("moves accepted attempts back to in progress when changes are requested", async () => {
    const repoRoot = await createGitRepository("presence-request-changes-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify({ name: "presence-node", scripts: { test: 'node -e "process.exit(0)"' } }, null, 2),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add request-change validation scripts"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Review gating",
        description: "Allow review to send an accepted attempt back for more work.",
        priority: "p2",
        acceptanceChecklist: [
          { id: "check-1", label: "Mechanism understood", checked: true },
          { id: "check-2", label: "Evidence attached", checked: true },
          { id: "check-3", label: "Validation recorded", checked: true },
        ],
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      await system.presence.runAttemptValidation({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      await system.presence.submitReviewDecision({
        ticketId: ticket.id,
        attemptId: attempt.id,
        decision: "accept",
        notes: "Approved first pass.",
      }).pipe(Effect.runPromise);
      await system.presence.submitReviewDecision({
        ticketId: ticket.id,
        attemptId: attempt.id,
        decision: "request_changes",
        notes: "One more iteration needed.",
      }).pipe(Effect.runPromise);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(snapshot.tickets[0]?.status).toBe("in_progress");
      expect(snapshot.attempts[0]?.status).toBe("in_progress");
    } finally {
      await system.dispose();
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("creates findings, follow-up proposals, and repo projections for Presence memory", async () => {
    const repoRoot = await createGitRepository("presence-projections-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify({ name: "presence-projections", scripts: { test: 'node -e "process.exit(0)"' } }, null, 2),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add projection validation scripts"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Projection Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Projection coverage",
        description: "Write the visible Presence memory files into the repository.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      await system.presence.saveSupervisorHandoff({
        boardId: repository.boardId,
        topPriorities: ["Projection coverage"],
        activeAttemptIds: [attempt.id],
        blockedTicketIds: [],
        recentDecisions: ["Keep attempt-local memory separate from board memory."],
        nextBoardActions: ["Validate the attempt and inspect follow-up state."],
      }).pipe(Effect.runPromise);
      await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      await system.presence.saveWorkerHandoff({
        attemptId: attempt.id,
        completedWork: ["Captured the current execution state for projection coverage."],
        currentHypothesis: "The .presence folder should mirror ticket and attempt state.",
        changedFiles: ["README.md"],
        testsRun: ["npm test"],
        blockers: [],
        nextStep: "Run validation and create a follow-up proposal.",
        confidence: 0.74,
        evidenceIds: [],
      }).pipe(Effect.runPromise);
      await system.presence.runAttemptValidation({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      const proposal = await system.presence.createFollowUpProposal({
        parentTicketId: ticket.id,
        originatingAttemptId: attempt.id,
        kind: "child_ticket",
        title: "Follow up projection note",
        description: "Materialize a child ticket from the proposal.",
        priority: "p2",
        findingIds: [],
      }).pipe(Effect.runPromise);
      const childTicket = await system.presence.materializeFollowUp({
        proposalId: proposal.id,
      }).pipe(Effect.runPromise);
      await system.presence.upsertKnowledgePage({
        boardId: repository.boardId,
        family: "runbooks",
        slug: "projection-coverage",
        title: "Projection coverage",
        compiledTruth: "Presence should sync ticket and brain projections into the repo.",
        timeline: "2026-04-21 - Projection test updated the runbook.",
        linkedTicketIds: [ticket.id],
      }).pipe(Effect.runPromise);

      const projectionRoot = path.join(repoRoot, ".presence");
      expect(existsSync(path.join(projectionRoot, "board", "supervisor_handoff.md"))).toBe(true);
      expect(existsSync(path.join(projectionRoot, "tickets", ticket.id, "ticket.md"))).toBe(true);
      expect(existsSync(path.join(projectionRoot, "tickets", ticket.id, "current_summary.md"))).toBe(true);
      expect(
        existsSync(path.join(projectionRoot, "tickets", ticket.id, "attempts", attempt.id, "progress.md")),
      ).toBe(true);
      expect(existsSync(path.join(projectionRoot, "brain", "runbooks", "projection-coverage.md"))).toBe(true);
      expect(await fs.readFile(path.join(projectionRoot, "tickets", ticket.id, "ticket.md"), "utf8")).toContain(
        ticket.title,
      );
      expect(
        await fs.readFile(
          path.join(projectionRoot, "tickets", ticket.id, "attempts", attempt.id, "progress.md"),
          "utf8",
        ),
      ).toContain("Captured the current execution state");
      expect(
        await fs.readFile(path.join(projectionRoot, "brain", "runbooks", "projection-coverage.md"), "utf8"),
      ).toContain("Compiled Truth");

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(snapshot.ticketSummaries.find((summary) => summary.ticketId === ticket.id)).toBeTruthy();
      expect(snapshot.proposedFollowUps.find((candidate) => candidate.id === proposal.id)?.createdTicketId).toBe(
        childTicket.id,
      );
    } finally {
      await system.dispose();
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("creates blocking findings for failed validation and lets humans resolve them explicitly", async () => {
    const repoRoot = await createGitRepository("presence-findings-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify({ name: "presence-findings", scripts: { test: 'node -e "process.exit(1)"' } }, null, 2),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add failing findings scripts"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Findings Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Validation findings",
        description: "Failed validation should become a blocking finding.",
        priority: "p2",
        acceptanceChecklist: [
          { id: "check-1", label: "Mechanism understood", checked: true },
          { id: "check-2", label: "Evidence attached", checked: true },
          { id: "check-3", label: "Validation recorded", checked: true },
        ],
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      await system.presence.runAttemptValidation({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      const finding = snapshot.findings.find(
        (candidate) =>
          candidate.ticketId === ticket.id &&
          candidate.attemptId === attempt.id &&
          candidate.source === "validation" &&
          candidate.status === "open",
      );
      expect(finding?.severity).toBe("blocking");

      const blockedDecision = await system.presence.evaluateSupervisorAction({
        action: "approve_attempt",
        ticketId: ticket.id,
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      expect(blockedDecision.allowed).toBe(false);
      expect(blockedDecision.reasons.join(" ")).toMatch(/blocking findings/i);

      if (!finding) {
        throw new Error("Expected a validation finding to exist.");
      }
      await system.presence.resolveFinding({
        findingId: finding.id,
      }).pipe(Effect.runPromise);

      const resolvedSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(resolvedSnapshot.findings.find((candidate) => candidate.id === finding.id)?.status).toBe(
        "resolved",
      );
    } finally {
      await system.dispose();
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("blocks repeated similar failed attempts and escalates instead of allowing infinite retries", async () => {
    const repoRoot = await createGitRepository("presence-retry-spiral-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify({ name: "presence-retry-spiral", scripts: { test: 'node -e "process.exit(1)"' } }, null, 2),
        "utf8",
      );
      await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}", "utf8");
      await runGit(repoRoot, ["add", "package.json", "package-lock.json"]);
      await runGit(repoRoot, ["commit", "-m", "add retry spiral scripts"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Retry Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Prevent retry spirals",
        description: "Repeated failed validation should escalate before a third retry.",
        priority: "p2",
        acceptanceChecklist: [
          { id: "check-1", label: "Mechanism understood", checked: true },
          { id: "check-2", label: "Evidence attached", checked: true },
          { id: "check-3", label: "Validation recorded", checked: true },
        ],
      }).pipe(Effect.runPromise);

      const attemptOne = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);
      await system.presence.startAttemptSession({
        attemptId: attemptOne.id,
      }).pipe(Effect.runPromise);
      await system.presence.runAttemptValidation({
        attemptId: attemptOne.id,
      }).pipe(Effect.runPromise);

      const attemptTwo = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);
      await system.presence.startAttemptSession({
        attemptId: attemptTwo.id,
      }).pipe(Effect.runPromise);
      await system.presence.runAttemptValidation({
        attemptId: attemptTwo.id,
      }).pipe(Effect.runPromise);

      await expect(
        system.presence.createAttempt({
          ticketId: ticket.id,
        }).pipe(Effect.runPromise),
      ).rejects.toThrow(/Escalate or create follow-up work before another retry attempt/i);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(snapshot.tickets.find((candidate) => candidate.id === ticket.id)?.status).toBe("blocked");
      expect(
        snapshot.findings.some(
          (finding) =>
            finding.ticketId === ticket.id &&
            finding.source === "supervisor" &&
            finding.disposition === "escalate" &&
            finding.status === "open",
        ),
      ).toBe(true);
      expect(snapshot.ticketSummaries.find((summary) => summary.ticketId === ticket.id)?.blocked).toBe(true);
    } finally {
      await system.dispose();
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("starts and cancels a supervisor run while exposing it in the board snapshot", async () => {
    const repoRoot = await createGitRepository("presence-supervisor-run-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Supervisor Repo",
      }).pipe(Effect.runPromise);
      const intake = await system.presence.submitGoalIntake({
        boardId: repository.boardId,
        rawGoal: "Add a repository AGENTS.md guide and tighten the validation path.",
        source: "human_goal",
        priorityHint: "p2",
      }).pipe(Effect.runPromise);

      const run = await system.presence.startSupervisorRun({
        boardId: repository.boardId,
        goalIntakeId: intake.intake.id,
      }).pipe(Effect.runPromise);
      expect(run.scopeTicketIds).toHaveLength(intake.createdTickets.length);
      expect(run.status).toBe("running");

      const runningSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(runningSnapshot.supervisorRuns[0]?.id).toBe(run.id);
      expect(runningSnapshot.supervisorHandoff?.currentRunId).toBe(run.id);

      let advancedSnapshot = runningSnapshot;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (
          advancedSnapshot.supervisorRuns[0]?.stage !== "plan" ||
          advancedSnapshot.attempts.some((item) =>
            run.scopeTicketIds.some((ticketId) => ticketId === item.ticketId),
          )
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
        advancedSnapshot = await system.presence.getBoardSnapshot({
          boardId: repository.boardId,
        }).pipe(Effect.runPromise);
      }
      expect(advancedSnapshot.supervisorRuns[0]?.stage).not.toBe("plan");

      const cancelled = await system.presence.cancelSupervisorRun({
        runId: run.id,
      }).pipe(Effect.runPromise);
      expect(cancelled.status).toBe("cancelled");

      const cancelledSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(cancelledSnapshot.supervisorRuns[0]?.status).toBe("cancelled");
      expect(existsSync(path.join(repoRoot, ".presence", "board", "supervisor_run.md"))).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      await system.dispose();
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  }, 15_000);

  it("records GLM-style supervisor and worker handoff details in repo projections", async () => {
    const repoRoot = await createGitRepository("presence-glm-handoff-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence GLM Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Capture GLM handoff protocol",
        description: "Project the stricter supervisor and worker handoff state into the repo.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      const run = await system.presence.startSupervisorRun({
        boardId: repository.boardId,
        ticketIds: [ticket.id],
      }).pipe(Effect.runPromise);

      await system.presence.saveSupervisorHandoff({
        boardId: repository.boardId,
        topPriorities: [ticket.title],
        activeAttemptIds: [attempt.id],
        blockedTicketIds: [],
        recentDecisions: ["Use work -> test -> log -> advance for this ticket."],
        nextBoardActions: ["Read the current summary, then continue orchestration."],
        currentRunId: run.id,
        stage: "waiting_on_worker",
      }).pipe(Effect.runPromise);
      await system.presence.saveWorkerHandoff({
        attemptId: attempt.id,
        completedWork: ["Captured the latest worker state for GLM projection coverage."],
        currentHypothesis: "The resume order should stay visible in the repo projection.",
        changedFiles: ["README.md"],
        testsRun: ["npm test"],
        blockers: ["Waiting for the next validation pass."],
        nextStep: "Re-read progress, decisions, blockers, and findings before continuing.",
        openQuestions: ["Should the next worker change strategy after another failed validation pass?"],
        retryCount: 2,
        confidence: 0.71,
        evidenceIds: [],
      }).pipe(Effect.runPromise);

      const progressMarkdown = await fs.readFile(
        path.join(repoRoot, ".presence", "tickets", ticket.id, "attempts", attempt.id, "progress.md"),
        "utf8",
      );
      const supervisorMarkdown = await fs.readFile(
        path.join(repoRoot, ".presence", "board", "supervisor_handoff.md"),
        "utf8",
      );
      const supervisorPromptMarkdown = await fs.readFile(
        path.join(repoRoot, ".presence", "board", "supervisor_prompt.md"),
        "utf8",
      );

      expect(progressMarkdown).toContain("Retry count: 2");
      expect(progressMarkdown).toContain("Open Questions");
      expect(supervisorMarkdown).toContain("Operating Contract");
      expect(supervisorMarkdown).toContain("### Memory model");
      expect(supervisorMarkdown).toContain("### Available executors");
      expect(supervisorMarkdown).toContain("Resume Protocol");
      expect(supervisorMarkdown).toContain(run.id);
      expect(supervisorPromptMarkdown).toContain("Presence supervisor role");
      expect(supervisorPromptMarkdown).toContain("Read order:");
      expect(supervisorPromptMarkdown).toContain("Ticket lifecycle:");
      expect(supervisorPromptMarkdown).toContain("Stop conditions:");
    } finally {
      await system.dispose();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  }, 15_000);

  it("refreshes worker handoff and activity projections while a worker thread is still running", async () => {
    const repoRoot = await createGitRepository("presence-live-handoff-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Live Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Keep active handoff warm",
        description: "Update the handoff while the worker is still running.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);
      const session = await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      system.orchestration.setCheckpoint({
        threadId: session.threadId,
        files: ["NOTES.md"],
        completedAt: "2026-04-21T00:00:01.000Z",
      });
      system.orchestration.appendActivity({
        threadId: session.threadId,
        kind: "tool.completed",
        summary: "command: npm test",
        createdAt: "2026-04-21T00:00:02.000Z",
      });
      system.orchestration.pushAssistantMessage({
        threadId: session.threadId,
        updatedAt: "2026-04-21T00:00:03.000Z",
        text: [
          "Progress update.",
          "",
          "[PRESENCE_HANDOFF]",
          "Completed work:",
          "- Inspected the repo and updated the live notes file.",
          "Current hypothesis:",
          "The worker can keep the active handoff current without waiting for the turn to settle.",
          "Next step:",
          "Run validation after one more code pass.",
          "Open questions:",
          "- Should the activity log keep the latest tool milestone?",
          "[/PRESENCE_HANDOFF]",
        ].join("\n"),
      });

      const refreshed = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      const liveHandoff = refreshed.attemptSummaries.find(
        (summaryItem) => summaryItem.attempt.id === attempt.id,
      )?.latestWorkerHandoff;
      expect(liveHandoff?.reasoningSource).toBe("assistant_block");
      expect(liveHandoff?.currentHypothesis).toContain("keep the active handoff current");
      expect(liveHandoff?.changedFiles).toContain("NOTES.md");
      const ticketSummary = refreshed.ticketSummaries.find(
        (summaryItem) => summaryItem.ticketId === ticket.id,
      );
      expect(ticketSummary?.nextStep).toContain("Run validation");
      expect(ticketSummary?.currentMechanism).toContain("keep the active handoff current");
    } finally {
      await system.dispose();
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  }, 20_000);

  it("ignores malformed assistant handoff blocks and keeps newer manual reasoning", async () => {
    const repoRoot = await createGitRepository("presence-handoff-override-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Override Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Preserve manual reasoning",
        description: "Malformed assistant handoff blocks should not overwrite manual state.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);
      const session = await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      await system.presence.saveWorkerHandoff({
        attemptId: attempt.id,
        completedWork: ["Recorded a manual override before the assistant resumed."],
        currentHypothesis: "The saved manual hypothesis should survive malformed assistant output.",
        changedFiles: [],
        testsRun: [],
        blockers: [],
        nextStep: "Wait for a valid structured assistant update.",
        openQuestions: [],
        retryCount: 0,
        evidenceIds: [],
      }).pipe(Effect.runPromise);

      system.orchestration.pushAssistantMessage({
        threadId: session.threadId,
        updatedAt: "2026-04-20T23:59:00.000Z",
        text: [
          "[PRESENCE_HANDOFF]",
          "Completed work:",
          "- This block is malformed because it skips the required next-step heading.",
          "Current hypothesis:",
          "This should be ignored.",
          "Open questions:",
          "- Missing a required section.",
          "[/PRESENCE_HANDOFF]",
        ].join("\n"),
      });

      const refreshed = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      const liveHandoff = refreshed.attemptSummaries.find(
        (summaryItem) => summaryItem.attempt.id === attempt.id,
      )?.latestWorkerHandoff;
      expect(liveHandoff?.reasoningSource).toBe("manual_override");
      expect(liveHandoff?.currentHypothesis).toContain("manual hypothesis should survive");
    } finally {
      await system.dispose();
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  }, 20_000);

  it("classifies repeated environment blockers and keeps blocker projections concise", async () => {
    const repoRoot = await createGitRepository("presence-env-blocker-");
    const system = await createPresenceSystem();

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify(
          {
            name: "presence-env-blocker",
            version: "0.0.0",
            scripts: {
              test: "node -e \"console.error('database or disk is full'); process.exit(1)\"",
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      await runGit(repoRoot, ["add", "package.json"]);
      await runGit(repoRoot, ["commit", "-m", "add failing env validation"]);

      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Env Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Classify environment blocker",
        description: "Summarize repeated environment failures without dumping raw stderr walls.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);
      await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);

      await system.presence.runAttemptValidation({ attemptId: attempt.id }).pipe(Effect.runPromise);
      await system.presence.runAttemptValidation({ attemptId: attempt.id }).pipe(Effect.runPromise);

      const blockersMarkdown = await fs.readFile(
        path.join(repoRoot, ".presence", "tickets", ticket.id, "attempts", attempt.id, "blockers.md"),
        "utf8",
      );
      const summaryMarkdown = await fs.readFile(
        path.join(repoRoot, ".presence", "tickets", ticket.id, "current_summary.md"),
        "utf8",
      );

      expect(blockersMarkdown).toContain("disk_space: Environment blocker: insufficient disk space is preventing progress.");
      expect(blockersMarkdown).toContain("repeated 2 times");
      expect(blockersMarkdown).not.toContain("database or disk is full database or disk is full");
      expect(summaryMarkdown).toContain("## Current Blocker Classes");
      expect(summaryMarkdown).toContain("disk_space");
    } finally {
      await system.dispose();
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  }, 35_000);

  it("merges an approved attempt back into an unborn base branch", async () => {
    const repoRoot = await createUnbornGitRepository("presence-workspace-merge-unborn-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Merge first attempt",
        description: "Let the first approved attempt become the repository history.",
        priority: "p2",
        acceptanceChecklist: [
          { id: "check-1", label: "Mechanism understood", checked: true },
          { id: "check-2", label: "Evidence attached", checked: true },
          { id: "check-3", label: "Validation recorded", checked: true },
        ],
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      await system.presence.recordValidationWaiver({
        ticketId: ticket.id,
        attemptId: attempt.id,
        reason: "Unborn repository was validated manually before the first commit.",
        grantedBy: "human",
      }).pipe(Effect.runPromise);

      const activeSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      const worktreePath = activeSnapshot.workspaces[0]?.worktreePath;
      if (!worktreePath) throw new Error("Expected a prepared worktree.");

      await fs.writeFile(
        path.join(worktreePath, "README.md"),
        "# Presence Test\nmerged from unborn attempt\n",
        "utf8",
      );

      await system.presence.submitReviewDecision({
        ticketId: ticket.id,
        attemptId: attempt.id,
        decision: "accept",
        notes: "Approved and ready for merge.",
      }).pipe(Effect.runPromise);
      await system.presence.submitReviewDecision({
        ticketId: ticket.id,
        attemptId: attempt.id,
        decision: "merge_approved",
        notes: "Merge the approved attempt into the empty base branch.",
      }).pipe(Effect.runPromise);

      const mergedSnapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(mergedSnapshot.tickets[0]?.status).toBe("done");
      expect(mergedSnapshot.attempts[0]?.status).toBe("merged");
      expect(mergedSnapshot.workspaces[0]?.status).toBe("cleaned_up");
      expect(await fs.readFile(path.join(repoRoot, "README.md"), "utf8")).toContain(
        "merged from unborn attempt",
      );
      expect((await runGit(repoRoot, ["branch", "--show-current"])).trim()).toBe("main");
      expect((await runGit(repoRoot, ["rev-parse", "--verify", "HEAD"])).trim().length).toBeGreaterThan(0);
    } finally {
      await system.dispose();
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it("cleans up the worktree and clears thread workspace metadata", async () => {
    const repoRoot = await createGitRepository("presence-workspace-cleanup-");
    const system = await createPresenceSystem();

    try {
      const repository = await system.presence.importRepository({
        workspaceRoot: repoRoot,
        title: "Presence Repo",
      }).pipe(Effect.runPromise);
      const ticket = await system.presence.createTicket({
        boardId: repository.boardId,
        title: "Clean up workspace",
        description: "Remove the prepared worktree after the session exists.",
        priority: "p2",
      }).pipe(Effect.runPromise);
      const attempt = await system.presence.createAttempt({
        ticketId: ticket.id,
      }).pipe(Effect.runPromise);

      const session = await system.presence.startAttemptSession({
        attemptId: attempt.id,
      }).pipe(Effect.runPromise);
      const snapshotBeforeCleanup = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      const worktreePath = snapshotBeforeCleanup.workspaces[0]?.worktreePath;

      const workspace = await system.presence.cleanupWorkspace({
        attemptId: attempt.id,
        force: true,
      }).pipe(Effect.runPromise);

      expect(workspace.status).toBe("cleaned_up");
      expect(workspace.worktreePath).toBeNull();
      expect(existsSync(worktreePath ?? "")).toBe(false);

      const snapshot = await system.presence.getBoardSnapshot({
        boardId: repository.boardId,
      }).pipe(Effect.runPromise);
      expect(snapshot.workspaces[0]?.status).toBe("cleaned_up");
      expect(snapshot.attempts[0]?.status).toBe("interrupted");

      const threadMetaUpdates = system.commands.filter(
        (command): command is Extract<OrchestrationCommand, { type: "thread.meta.update" }> =>
          command.type === "thread.meta.update" && command.threadId === session.threadId,
      );
      expect(threadMetaUpdates.at(-1)?.branch).toBeNull();
      expect(threadMetaUpdates.at(-1)?.worktreePath).toBeNull();
    } finally {
      await system.dispose();
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });
});
