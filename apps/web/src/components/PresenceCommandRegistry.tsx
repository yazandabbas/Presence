import type { ReactNode } from "react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { readEnvironmentApi } from "../environmentApi";
import { readLocalApi } from "../localApi";
import { newCommandId } from "../lib/utils";
import type { Thread } from "../types";
import type { CommandPaletteActionItem } from "./CommandPalette.logic";
import { stackedThreadToast, toastManager } from "./ui/toast";

export type PresenceCommandRisk = "instant" | "confirm";
export type PresenceThemeCommandValue = "dark" | "light" | "system";
export type PresenceCommandConfirmer = (message: string) => Promise<boolean>;

export interface PresenceCommandDefinition {
  readonly id: string;
  readonly title: ReactNode;
  readonly description?: string;
  readonly icon: ReactNode;
  readonly searchTerms: ReadonlyArray<string>;
  readonly risk: PresenceCommandRisk;
  readonly enabled?: boolean;
  readonly disabledReason?: string;
  readonly confirmationMessage?: string;
  readonly run: () => Promise<void>;
}

export interface PresenceCommandIcons {
  readonly moon: ReactNode;
  readonly sun: ReactNode;
  readonly monitor: ReactNode;
  readonly stop: ReactNode;
  readonly archive: ReactNode;
  readonly target: ReactNode;
}

export interface PresenceCommandContext {
  readonly icons: PresenceCommandIcons;
  readonly activeThread: Thread | null;
  readonly goalText: string;
  readonly currentProjectEnvironmentId: EnvironmentId | null;
  readonly currentProjectId: ProjectId | null;
  readonly currentProjectCwd: string | null;
  readonly activeProjectTitle: string | null;
  readonly setTheme: (theme: PresenceThemeCommandValue) => void;
  readonly closePalette: () => void;
}

async function confirmPresenceCommand(message: string): Promise<boolean> {
  const localApi = readLocalApi();
  if (localApi) {
    return localApi.dialogs.confirm(message);
  }
  if (typeof window !== "undefined") {
    return window.confirm(message);
  }
  return true;
}

function buildThemeCommand(input: {
  id: string;
  title: string;
  searchTerms: ReadonlyArray<string>;
  icon: ReactNode;
  theme: PresenceThemeCommandValue;
  setTheme: (theme: PresenceThemeCommandValue) => void;
  closePalette: () => void;
}): PresenceCommandDefinition {
  return {
    id: input.id,
    title: input.title,
    description: "Switch the app theme",
    icon: input.icon,
    risk: "instant",
    searchTerms: input.searchTerms,
    run: async () => {
      input.setTheme(input.theme);
      input.closePalette();
    },
  };
}

export function buildPresenceCommandDefinitions(
  context: PresenceCommandContext,
): PresenceCommandDefinition[] {
  const definitions: PresenceCommandDefinition[] = [
    buildThemeCommand({
      id: "theme.dark",
      title: "Set dark theme",
      searchTerms: ["dark theme", "dark mode", "night mode", "make it dark"],
      icon: context.icons.moon,
      theme: "dark",
      setTheme: context.setTheme,
      closePalette: context.closePalette,
    }),
    buildThemeCommand({
      id: "theme.light",
      title: "Set light theme",
      searchTerms: ["light theme", "light mode", "make it light"],
      icon: context.icons.sun,
      theme: "light",
      setTheme: context.setTheme,
      closePalette: context.closePalette,
    }),
    buildThemeCommand({
      id: "theme.system",
      title: "Use system theme",
      searchTerms: ["system theme", "auto theme", "follow system"],
      icon: context.icons.monitor,
      theme: "system",
      setTheme: context.setTheme,
      closePalette: context.closePalette,
    }),
  ];

  const activeThread = context.activeThread;
  if (activeThread) {
    definitions.push({
      id: "thread.stop-current",
      title: "Stop current thread",
      description: activeThread.title,
      icon: context.icons.stop,
      risk: activeThread.session?.status === "running" ? "confirm" : "instant",
      confirmationMessage: "Stop the current running thread?",
      searchTerms: [
        "stop current thread",
        "kill current thread",
        "cancel current thread",
        "interrupt current thread",
      ],
      run: async () => {
        const api = readEnvironmentApi(activeThread.environmentId);
        if (!api) return;
        const createdAt = new Date().toISOString();
        const activeTurnId = activeThread.session?.activeTurnId ?? null;
        if (activeTurnId) {
          await api.orchestration.dispatchCommand({
            type: "thread.turn.interrupt",
            commandId: newCommandId(),
            threadId: activeThread.id,
            turnId: activeTurnId,
            createdAt,
          });
        }
        await api.orchestration.dispatchCommand({
          type: "thread.session.stop",
          commandId: newCommandId(),
          threadId: activeThread.id,
          createdAt: new Date().toISOString(),
        });
        toastManager.add(
          stackedThreadToast({
            type: "success",
            title: "Thread stopped",
            description: activeThread.title,
          }),
        );
        context.closePalette();
      },
    });

    definitions.push({
      id: "thread.archive-current",
      title: "Archive current thread",
      description: activeThread.title,
      icon: context.icons.archive,
      risk: "confirm",
      confirmationMessage: "Archive the current thread?",
      searchTerms: ["archive current thread", "close current thread", "remove current thread"],
      run: async () => {
        const api = readEnvironmentApi(activeThread.environmentId);
        if (!api) return;
        await api.orchestration.dispatchCommand({
          type: "thread.archive",
          commandId: newCommandId(),
          threadId: activeThread.id,
        });
        toastManager.add(
          stackedThreadToast({
            type: "success",
            title: "Thread archived",
            description: activeThread.title,
          }),
        );
        context.closePalette();
      },
    });
  }

  if (
    context.goalText.length >= 12 &&
    context.currentProjectEnvironmentId &&
    context.currentProjectId &&
    context.currentProjectCwd
  ) {
    definitions.push({
      id: "presence.goal.plan-now",
      title: "Turn this goal into Presence tickets",
      description: context.activeProjectTitle ?? context.currentProjectCwd,
      icon: context.icons.target,
      risk: "instant",
      searchTerms: [
        context.goalText,
        "turn this goal into tickets",
        "create presence tickets",
        "plan goal",
        "break down goal",
      ],
      run: async () => {
        const api = readEnvironmentApi(context.currentProjectEnvironmentId!);
        if (!api) return;
        const repositories = await api.presence.listRepositories({});
        const existingRepository =
          repositories.find((repository) => repository.projectId === context.currentProjectId) ??
          repositories.find((repository) => repository.workspaceRoot === context.currentProjectCwd);
        const repository =
          existingRepository ??
          (await api.presence.importRepository({
            workspaceRoot: context.currentProjectCwd!,
            ...(context.activeProjectTitle ? { title: context.activeProjectTitle } : {}),
          }));
        const result = await api.presence.submitGoalIntake({
          boardId: repository.boardId,
          rawGoal: context.goalText,
          source: "human_goal",
          priorityHint: "p2",
          planNow: true,
        });
        toastManager.add(
          stackedThreadToast({
            type: "success",
            title: "Presence planned the goal",
            description:
              result.createdTickets.length === 1
                ? "Created one ticket."
                : `Created ${result.createdTickets.length} tickets.`,
          }),
        );
        context.closePalette();
      },
    });
  }

  return definitions;
}

export async function executePresenceCommandDefinition(
  definition: PresenceCommandDefinition,
  options: { readonly confirm?: PresenceCommandConfirmer } = {},
): Promise<boolean> {
  if (definition.enabled === false) {
    return false;
  }
  const confirm = options.confirm ?? confirmPresenceCommand;
  if (
    definition.risk === "confirm" &&
    !(await confirm(definition.confirmationMessage ?? "Run this Presence command?"))
  ) {
    return false;
  }
  await definition.run();
  return true;
}

export function buildPresenceCommandItems(
  definitions: ReadonlyArray<PresenceCommandDefinition>,
  options: { readonly confirm?: PresenceCommandConfirmer } = {},
): CommandPaletteActionItem[] {
  return definitions.map((definition) => {
    const item: CommandPaletteActionItem = {
      kind: "action",
      value: `presence-command:${definition.id}`,
      title: definition.title,
      ...(definition.disabledReason !== undefined && definition.enabled === false
        ? { description: definition.disabledReason }
        : definition.description !== undefined
          ? { description: definition.description }
          : {}),
      icon: definition.icon,
      searchTerms: [
        definition.id,
        definition.enabled === false ? "disabled unavailable" : "enabled available",
        definition.risk === "confirm" ? "confirm dangerous destructive" : "instant safe",
        ...definition.searchTerms,
      ],
      keepOpen: true,
      run: async () => {
        await executePresenceCommandDefinition(definition, options);
      },
    };
    return item;
  });
}
