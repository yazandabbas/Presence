import type {
  GitCheckoutInput,
  GitCheckoutResult,
  GitCreateBranchInput,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullRequestRefInput,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitPullInput,
  GitPullResult,
  GitRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitStatusInput,
  GitStatusResult,
  GitCreateBranchResult,
} from "./git.ts";
import type { FilesystemBrowseInput, FilesystemBrowseResult } from "./filesystem.ts";
import type {
  BoardSnapshot,
  DeterministicJobRecord,
  FindingRecord,
  GoalIntakeResult,
  GoalIntakeRecord,
  PresenceAttachThreadInput,
  PresenceCleanupWorkspaceInput,
  PresenceCreateFollowUpProposalInput,
  PresenceCreateAttemptInput,
  PresenceCreateDeterministicJobInput,
  PresenceCreatePromotionCandidateInput,
  PresenceCancelSupervisorRunInput,
  PresenceDismissFindingInput,
  PresenceEvaluateSupervisorActionInput,
  PresenceGetRepositoryCapabilitiesInput,
  PresenceMaterializeFollowUpInput,
  PresencePrepareWorkspaceInput,
  PresenceResolveFindingInput,
  PresenceScanRepositoryCapabilitiesInput,
  PresenceCreateTicketInput,
  PresenceGetBoardSnapshotInput,
  PresenceImportRepositoryInput,
  PresenceListRepositoriesInput,
  PresenceReviewPromotionCandidateInput,
  PresenceSaveAttemptEvidenceInput,
  PresenceSaveSupervisorHandoffInput,
  PresenceSaveWorkerHandoffInput,
  PresenceHumanDirectionResult,
  PresenceSetControllerModeInput,
  PresenceSetControllerModeResult,
  PresenceSubmitHumanDirectionInput,
  PresenceSubmitGoalIntakeInput,
  PresenceStartSupervisorRunInput,
  PresenceStartAttemptSessionInput,
  PresenceSubmitReviewDecisionInput,
  PresenceUpdateTicketInput,
  PromotionCandidateRecord,
  ProposedFollowUpRecord,
  RepositoryCapabilityScanRecord,
  RepositorySummary,
  ReviewDecisionRecord,
  SupervisorRunRecord,
  SupervisorPolicyDecision,
  SupervisorHandoffRecord,
  WorkerHandoffRecord,
  AttemptEvidenceRecord,
  AttemptRecord,
  TicketRecord,
  KnowledgePageRecord,
  AgentSessionRecord,
  PresenceUpsertKnowledgePageInput,
  WorkspaceRecord,
} from "./presence.ts";
import type {
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project.ts";
import type {
  ServerConfig,
  ServerProviderUpdatedPayload,
  ServerUpsertKeybindingResult,
} from "./server.ts";
import type {
  TerminalClearInput,
  TerminalCloseInput,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal.ts";
import type { ServerUpsertKeybindingInput } from "./server.ts";
import type {
  ClientOrchestrationCommand,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetFullThreadDiffResult,
  OrchestrationGetTurnDiffInput,
  OrchestrationGetTurnDiffResult,
  OrchestrationShellStreamItem,
  OrchestrationSubscribeThreadInput,
  OrchestrationThreadStreamItem,
} from "./orchestration.ts";
import type { EnvironmentId } from "./baseSchemas.ts";
import { EditorId } from "./editor.ts";
import { ServerSettings, type ClientSettings, type ServerSettingsPatch } from "./settings.ts";

export interface ContextMenuItem<T extends string = string> {
  id: T;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  children?: readonly ContextMenuItem<T>[];
}

export type DesktopUpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export type DesktopRuntimeArch = "arm64" | "x64" | "other";
export type DesktopTheme = "light" | "dark" | "system";
export type DesktopUpdateChannel = "latest" | "nightly";
export type DesktopAppStageLabel = "Alpha" | "Dev" | "Nightly";

export interface DesktopAppBranding {
  baseName: string;
  stageLabel: DesktopAppStageLabel;
  displayName: string;
}

export interface DesktopRuntimeInfo {
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
}

export interface DesktopUpdateState {
  enabled: boolean;
  status: DesktopUpdateStatus;
  channel: DesktopUpdateChannel;
  currentVersion: string;
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
  availableVersion: string | null;
  downloadedVersion: string | null;
  downloadPercent: number | null;
  checkedAt: string | null;
  message: string | null;
  errorContext: "check" | "download" | "install" | null;
  canRetry: boolean;
}

export interface DesktopUpdateActionResult {
  accepted: boolean;
  completed: boolean;
  state: DesktopUpdateState;
}

export interface DesktopUpdateCheckResult {
  checked: boolean;
  state: DesktopUpdateState;
}

export interface DesktopEnvironmentBootstrap {
  label: string;
  httpBaseUrl: string | null;
  wsBaseUrl: string | null;
  bootstrapToken?: string;
}

export interface PersistedSavedEnvironmentRecord {
  environmentId: EnvironmentId;
  label: string;
  wsBaseUrl: string;
  httpBaseUrl: string;
  createdAt: string;
  lastConnectedAt: string | null;
}

export type DesktopServerExposureMode = "local-only" | "network-accessible";

export interface DesktopServerExposureState {
  mode: DesktopServerExposureMode;
  endpointUrl: string | null;
  advertisedHost: string | null;
}

export interface PickFolderOptions {
  initialPath?: string | null;
}

export interface DesktopBridge {
  getAppBranding: () => DesktopAppBranding | null;
  getLocalEnvironmentBootstrap: () => DesktopEnvironmentBootstrap | null;
  getClientSettings: () => Promise<ClientSettings | null>;
  setClientSettings: (settings: ClientSettings) => Promise<void>;
  getSavedEnvironmentRegistry: () => Promise<readonly PersistedSavedEnvironmentRecord[]>;
  setSavedEnvironmentRegistry: (
    records: readonly PersistedSavedEnvironmentRecord[],
  ) => Promise<void>;
  getSavedEnvironmentSecret: (environmentId: EnvironmentId) => Promise<string | null>;
  setSavedEnvironmentSecret: (environmentId: EnvironmentId, secret: string) => Promise<boolean>;
  removeSavedEnvironmentSecret: (environmentId: EnvironmentId) => Promise<void>;
  getServerExposureState: () => Promise<DesktopServerExposureState>;
  setServerExposureMode: (mode: DesktopServerExposureMode) => Promise<DesktopServerExposureState>;
  pickFolder: (options?: PickFolderOptions) => Promise<string | null>;
  confirm: (message: string) => Promise<boolean>;
  setTheme: (theme: DesktopTheme) => Promise<void>;
  showContextMenu: <T extends string>(
    items: readonly ContextMenuItem<T>[],
    position?: { x: number; y: number },
  ) => Promise<T | null>;
  openExternal: (url: string) => Promise<boolean>;
  onMenuAction: (listener: (action: string) => void) => () => void;
  getUpdateState: () => Promise<DesktopUpdateState>;
  setUpdateChannel: (channel: DesktopUpdateChannel) => Promise<DesktopUpdateState>;
  checkForUpdate: () => Promise<DesktopUpdateCheckResult>;
  downloadUpdate: () => Promise<DesktopUpdateActionResult>;
  installUpdate: () => Promise<DesktopUpdateActionResult>;
  onUpdateState: (listener: (state: DesktopUpdateState) => void) => () => void;
}

/**
 * APIs bound to the local app shell, not to any particular backend environment.
 *
 * These capabilities describe the desktop/browser host that the user is
 * currently running: dialogs, editor/external-link opening, context menus, and
 * app-level settings/config access. They must not be used as a proxy for
 * "whatever environment the user is targeting", because in a multi-environment
 * world the local shell and a selected backend environment are distinct
 * concepts.
 */
export interface LocalApi {
  dialogs: {
    pickFolder: (options?: PickFolderOptions) => Promise<string | null>;
    confirm: (message: string) => Promise<boolean>;
  };
  shell: {
    openInEditor: (cwd: string, editor: EditorId) => Promise<void>;
    openExternal: (url: string) => Promise<void>;
  };
  contextMenu: {
    show: <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ) => Promise<T | null>;
  };
  persistence: {
    getClientSettings: () => Promise<ClientSettings | null>;
    setClientSettings: (settings: ClientSettings) => Promise<void>;
    getSavedEnvironmentRegistry: () => Promise<readonly PersistedSavedEnvironmentRecord[]>;
    setSavedEnvironmentRegistry: (
      records: readonly PersistedSavedEnvironmentRecord[],
    ) => Promise<void>;
    getSavedEnvironmentSecret: (environmentId: EnvironmentId) => Promise<string | null>;
    setSavedEnvironmentSecret: (environmentId: EnvironmentId, secret: string) => Promise<boolean>;
    removeSavedEnvironmentSecret: (environmentId: EnvironmentId) => Promise<void>;
  };
  server: {
    getConfig: () => Promise<ServerConfig>;
    refreshProviders: () => Promise<ServerProviderUpdatedPayload>;
    upsertKeybinding: (input: ServerUpsertKeybindingInput) => Promise<ServerUpsertKeybindingResult>;
    getSettings: () => Promise<ServerSettings>;
    updateSettings: (patch: ServerSettingsPatch) => Promise<ServerSettings>;
  };
}

/**
 * APIs bound to a specific backend environment connection.
 *
 * These operations must always be routed with explicit environment context.
 * They represent remote stateful capabilities such as orchestration, terminal,
 * project, and git operations. In multi-environment mode, each environment gets
 * its own instance of this surface, and callers should resolve it by
 * `environmentId` rather than reaching through the local desktop bridge.
 */
export interface EnvironmentApi {
  terminal: {
    open: (input: typeof TerminalOpenInput.Encoded) => Promise<TerminalSessionSnapshot>;
    write: (input: typeof TerminalWriteInput.Encoded) => Promise<void>;
    resize: (input: typeof TerminalResizeInput.Encoded) => Promise<void>;
    clear: (input: typeof TerminalClearInput.Encoded) => Promise<void>;
    restart: (input: typeof TerminalRestartInput.Encoded) => Promise<TerminalSessionSnapshot>;
    close: (input: typeof TerminalCloseInput.Encoded) => Promise<void>;
    onEvent: (callback: (event: TerminalEvent) => void) => () => void;
  };
  projects: {
    searchEntries: (input: ProjectSearchEntriesInput) => Promise<ProjectSearchEntriesResult>;
    writeFile: (input: ProjectWriteFileInput) => Promise<ProjectWriteFileResult>;
  };
  presence: {
    listRepositories: (
      input?: PresenceListRepositoriesInput,
    ) => Promise<readonly RepositorySummary[]>;
    importRepository: (input: PresenceImportRepositoryInput) => Promise<RepositorySummary>;
    getBoardSnapshot: (input: PresenceGetBoardSnapshotInput) => Promise<BoardSnapshot>;
    getRepositoryCapabilities: (
      input: PresenceGetRepositoryCapabilitiesInput,
    ) => Promise<RepositoryCapabilityScanRecord | null>;
    scanRepositoryCapabilities: (
      input: PresenceScanRepositoryCapabilitiesInput,
    ) => Promise<RepositoryCapabilityScanRecord>;
    createTicket: (input: PresenceCreateTicketInput) => Promise<TicketRecord>;
    updateTicket: (input: PresenceUpdateTicketInput) => Promise<TicketRecord>;
    createAttempt: (input: PresenceCreateAttemptInput) => Promise<AttemptRecord>;
    prepareWorkspace: (input: PresencePrepareWorkspaceInput) => Promise<WorkspaceRecord>;
    cleanupWorkspace: (input: PresenceCleanupWorkspaceInput) => Promise<WorkspaceRecord>;
    startAttemptSession: (input: PresenceStartAttemptSessionInput) => Promise<AgentSessionRecord>;
    attachThreadToAttempt: (input: PresenceAttachThreadInput) => Promise<AttemptRecord>;
    saveSupervisorHandoff: (
      input: PresenceSaveSupervisorHandoffInput,
    ) => Promise<SupervisorHandoffRecord>;
    saveWorkerHandoff: (input: PresenceSaveWorkerHandoffInput) => Promise<WorkerHandoffRecord>;
    saveAttemptEvidence: (
      input: PresenceSaveAttemptEvidenceInput,
    ) => Promise<AttemptEvidenceRecord>;
    resolveFinding: (input: PresenceResolveFindingInput) => Promise<FindingRecord>;
    dismissFinding: (input: PresenceDismissFindingInput) => Promise<FindingRecord>;
    createFollowUpProposal: (
      input: PresenceCreateFollowUpProposalInput,
    ) => Promise<ProposedFollowUpRecord>;
    materializeFollowUp: (input: PresenceMaterializeFollowUpInput) => Promise<TicketRecord>;
    upsertKnowledgePage: (input: PresenceUpsertKnowledgePageInput) => Promise<KnowledgePageRecord>;
    createPromotionCandidate: (
      input: PresenceCreatePromotionCandidateInput,
    ) => Promise<PromotionCandidateRecord>;
    reviewPromotionCandidate: (
      input: PresenceReviewPromotionCandidateInput,
    ) => Promise<PromotionCandidateRecord>;
    createDeterministicJob: (
      input: PresenceCreateDeterministicJobInput,
    ) => Promise<DeterministicJobRecord>;
    evaluateSupervisorAction: (
      input: PresenceEvaluateSupervisorActionInput,
    ) => Promise<SupervisorPolicyDecision>;
    submitGoalIntake: (input: PresenceSubmitGoalIntakeInput) => Promise<GoalIntakeResult>;
    submitHumanDirection: (
      input: PresenceSubmitHumanDirectionInput,
    ) => Promise<PresenceHumanDirectionResult>;
    setControllerMode: (
      input: PresenceSetControllerModeInput,
    ) => Promise<PresenceSetControllerModeResult>;
    startSupervisorRun: (input: PresenceStartSupervisorRunInput) => Promise<SupervisorRunRecord>;
    cancelSupervisorRun: (input: PresenceCancelSupervisorRunInput) => Promise<SupervisorRunRecord>;
    submitReviewDecision: (
      input: PresenceSubmitReviewDecisionInput,
    ) => Promise<ReviewDecisionRecord>;
  };
  filesystem: {
    browse: (input: FilesystemBrowseInput) => Promise<FilesystemBrowseResult>;
  };
  git: {
    listBranches: (input: GitListBranchesInput) => Promise<GitListBranchesResult>;
    createWorktree: (input: GitCreateWorktreeInput) => Promise<GitCreateWorktreeResult>;
    removeWorktree: (input: GitRemoveWorktreeInput) => Promise<void>;
    createBranch: (input: GitCreateBranchInput) => Promise<GitCreateBranchResult>;
    checkout: (input: GitCheckoutInput) => Promise<GitCheckoutResult>;
    init: (input: GitInitInput) => Promise<void>;
    resolvePullRequest: (input: GitPullRequestRefInput) => Promise<GitResolvePullRequestResult>;
    preparePullRequestThread: (
      input: GitPreparePullRequestThreadInput,
    ) => Promise<GitPreparePullRequestThreadResult>;
    pull: (input: GitPullInput) => Promise<GitPullResult>;
    refreshStatus: (input: GitStatusInput) => Promise<GitStatusResult>;
    onStatus: (
      input: GitStatusInput,
      callback: (status: GitStatusResult) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
  };
  orchestration: {
    dispatchCommand: (command: ClientOrchestrationCommand) => Promise<{ sequence: number }>;
    getTurnDiff: (input: OrchestrationGetTurnDiffInput) => Promise<OrchestrationGetTurnDiffResult>;
    getFullThreadDiff: (
      input: OrchestrationGetFullThreadDiffInput,
    ) => Promise<OrchestrationGetFullThreadDiffResult>;
    subscribeShell: (
      callback: (event: OrchestrationShellStreamItem) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
    subscribeThread: (
      input: OrchestrationSubscribeThreadInput,
      callback: (event: OrchestrationThreadStreamItem) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
  };
}
