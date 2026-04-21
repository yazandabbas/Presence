import {
  type GitActionProgressEvent,
  type GitRunStackedActionInput,
  type GitRunStackedActionResult,
  type GitStatusResult,
  type GitStatusStreamEvent,
  type LocalApi,
  ORCHESTRATION_WS_METHODS,
  type ServerSettingsPatch,
  WS_METHODS,
} from "@t3tools/contracts";
import { applyGitStatusStreamEvent } from "@t3tools/shared/git";
import { Effect, Stream } from "effect";

import { type WsRpcProtocolClient } from "./protocol";
import { resetWsReconnectBackoff } from "./wsConnectionState";
import { WsTransport } from "./wsTransport";

type RpcTag = keyof WsRpcProtocolClient & string;
type RpcMethod<TTag extends RpcTag> = WsRpcProtocolClient[TTag];
type RpcInput<TTag extends RpcTag> = Parameters<RpcMethod<TTag>>[0];

interface StreamSubscriptionOptions {
  readonly onResubscribe?: () => void;
}

type RpcUnaryMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer TSuccess, any, any>
    ? (input: RpcInput<TTag>) => Promise<TSuccess>
    : never;

type RpcUnaryNoArgMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer TSuccess, any, any>
    ? () => Promise<TSuccess>
    : never;

type RpcStreamMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Stream.Stream<infer TEvent, any, any>
    ? (listener: (event: TEvent) => void, options?: StreamSubscriptionOptions) => () => void
    : never;

type RpcInputStreamMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Stream.Stream<infer TEvent, any, any>
    ? (
        input: RpcInput<TTag>,
        listener: (event: TEvent) => void,
        options?: StreamSubscriptionOptions,
      ) => () => void
    : never;

interface GitRunStackedActionOptions {
  readonly onProgress?: (event: GitActionProgressEvent) => void;
}

export interface WsRpcClient {
  readonly dispose: () => Promise<void>;
  readonly reconnect: () => Promise<void>;
  readonly terminal: {
    readonly open: RpcUnaryMethod<typeof WS_METHODS.terminalOpen>;
    readonly write: RpcUnaryMethod<typeof WS_METHODS.terminalWrite>;
    readonly resize: RpcUnaryMethod<typeof WS_METHODS.terminalResize>;
    readonly clear: RpcUnaryMethod<typeof WS_METHODS.terminalClear>;
    readonly restart: RpcUnaryMethod<typeof WS_METHODS.terminalRestart>;
    readonly close: RpcUnaryMethod<typeof WS_METHODS.terminalClose>;
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeTerminalEvents>;
  };
  readonly projects: {
    readonly searchEntries: RpcUnaryMethod<typeof WS_METHODS.projectsSearchEntries>;
    readonly writeFile: RpcUnaryMethod<typeof WS_METHODS.projectsWriteFile>;
  };
  readonly presence: {
    readonly listRepositories: RpcUnaryMethod<typeof WS_METHODS.presenceListRepositories>;
    readonly importRepository: RpcUnaryMethod<typeof WS_METHODS.presenceImportRepository>;
    readonly getBoardSnapshot: RpcUnaryMethod<typeof WS_METHODS.presenceGetBoardSnapshot>;
    readonly getRepositoryCapabilities: RpcUnaryMethod<
      typeof WS_METHODS.presenceGetRepositoryCapabilities
    >;
    readonly scanRepositoryCapabilities: RpcUnaryMethod<
      typeof WS_METHODS.presenceScanRepositoryCapabilities
    >;
    readonly createTicket: RpcUnaryMethod<typeof WS_METHODS.presenceCreateTicket>;
    readonly updateTicket: RpcUnaryMethod<typeof WS_METHODS.presenceUpdateTicket>;
    readonly createAttempt: RpcUnaryMethod<typeof WS_METHODS.presenceCreateAttempt>;
    readonly prepareWorkspace: RpcUnaryMethod<typeof WS_METHODS.presencePrepareWorkspace>;
    readonly cleanupWorkspace: RpcUnaryMethod<typeof WS_METHODS.presenceCleanupWorkspace>;
    readonly startAttemptSession: RpcUnaryMethod<typeof WS_METHODS.presenceStartAttemptSession>;
    readonly attachThreadToAttempt: RpcUnaryMethod<
      typeof WS_METHODS.presenceAttachThreadToAttempt
    >;
    readonly saveSupervisorHandoff: RpcUnaryMethod<
      typeof WS_METHODS.presenceSaveSupervisorHandoff
    >;
    readonly saveWorkerHandoff: RpcUnaryMethod<typeof WS_METHODS.presenceSaveWorkerHandoff>;
    readonly saveAttemptEvidence: RpcUnaryMethod<typeof WS_METHODS.presenceSaveAttemptEvidence>;
    readonly runAttemptValidation: RpcUnaryMethod<typeof WS_METHODS.presenceRunAttemptValidation>;
    readonly resolveFinding: RpcUnaryMethod<typeof WS_METHODS.presenceResolveFinding>;
    readonly dismissFinding: RpcUnaryMethod<typeof WS_METHODS.presenceDismissFinding>;
    readonly createFollowUpProposal: RpcUnaryMethod<
      typeof WS_METHODS.presenceCreateFollowUpProposal
    >;
    readonly materializeFollowUp: RpcUnaryMethod<typeof WS_METHODS.presenceMaterializeFollowUp>;
    readonly upsertKnowledgePage: RpcUnaryMethod<typeof WS_METHODS.presenceUpsertKnowledgePage>;
    readonly createPromotionCandidate: RpcUnaryMethod<
      typeof WS_METHODS.presenceCreatePromotionCandidate
    >;
    readonly reviewPromotionCandidate: RpcUnaryMethod<
      typeof WS_METHODS.presenceReviewPromotionCandidate
    >;
    readonly createDeterministicJob: RpcUnaryMethod<
      typeof WS_METHODS.presenceCreateDeterministicJob
    >;
    readonly evaluateSupervisorAction: RpcUnaryMethod<
      typeof WS_METHODS.presenceEvaluateSupervisorAction
    >;
    readonly recordValidationWaiver: RpcUnaryMethod<
      typeof WS_METHODS.presenceRecordValidationWaiver
    >;
    readonly submitGoalIntake: RpcUnaryMethod<typeof WS_METHODS.presenceSubmitGoalIntake>;
    readonly startSupervisorRun: RpcUnaryMethod<typeof WS_METHODS.presenceStartSupervisorRun>;
    readonly cancelSupervisorRun: RpcUnaryMethod<typeof WS_METHODS.presenceCancelSupervisorRun>;
    readonly submitReviewDecision: RpcUnaryMethod<
      typeof WS_METHODS.presenceSubmitReviewDecision
    >;
  };
  readonly filesystem: {
    readonly browse: RpcUnaryMethod<typeof WS_METHODS.filesystemBrowse>;
  };
  readonly shell: {
    readonly openInEditor: (input: {
      readonly cwd: Parameters<LocalApi["shell"]["openInEditor"]>[0];
      readonly editor: Parameters<LocalApi["shell"]["openInEditor"]>[1];
    }) => ReturnType<LocalApi["shell"]["openInEditor"]>;
  };
  readonly git: {
    readonly pull: RpcUnaryMethod<typeof WS_METHODS.gitPull>;
    readonly refreshStatus: RpcUnaryMethod<typeof WS_METHODS.gitRefreshStatus>;
    readonly onStatus: (
      input: RpcInput<typeof WS_METHODS.subscribeGitStatus>,
      listener: (status: GitStatusResult) => void,
      options?: StreamSubscriptionOptions,
    ) => () => void;
    readonly runStackedAction: (
      input: GitRunStackedActionInput,
      options?: GitRunStackedActionOptions,
    ) => Promise<GitRunStackedActionResult>;
    readonly listBranches: RpcUnaryMethod<typeof WS_METHODS.gitListBranches>;
    readonly createWorktree: RpcUnaryMethod<typeof WS_METHODS.gitCreateWorktree>;
    readonly removeWorktree: RpcUnaryMethod<typeof WS_METHODS.gitRemoveWorktree>;
    readonly createBranch: RpcUnaryMethod<typeof WS_METHODS.gitCreateBranch>;
    readonly checkout: RpcUnaryMethod<typeof WS_METHODS.gitCheckout>;
    readonly init: RpcUnaryMethod<typeof WS_METHODS.gitInit>;
    readonly resolvePullRequest: RpcUnaryMethod<typeof WS_METHODS.gitResolvePullRequest>;
    readonly preparePullRequestThread: RpcUnaryMethod<
      typeof WS_METHODS.gitPreparePullRequestThread
    >;
  };
  readonly server: {
    readonly getConfig: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetConfig>;
    readonly refreshProviders: RpcUnaryNoArgMethod<typeof WS_METHODS.serverRefreshProviders>;
    readonly upsertKeybinding: RpcUnaryMethod<typeof WS_METHODS.serverUpsertKeybinding>;
    readonly getSettings: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetSettings>;
    readonly updateSettings: (
      patch: ServerSettingsPatch,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverUpdateSettings>>;
    readonly subscribeConfig: RpcStreamMethod<typeof WS_METHODS.subscribeServerConfig>;
    readonly subscribeLifecycle: RpcStreamMethod<typeof WS_METHODS.subscribeServerLifecycle>;
    readonly subscribeAuthAccess: RpcStreamMethod<typeof WS_METHODS.subscribeAuthAccess>;
  };
  readonly orchestration: {
    readonly dispatchCommand: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.dispatchCommand>;
    readonly getTurnDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getTurnDiff>;
    readonly getFullThreadDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getFullThreadDiff>;
    readonly subscribeShell: RpcStreamMethod<typeof ORCHESTRATION_WS_METHODS.subscribeShell>;
    readonly subscribeThread: RpcInputStreamMethod<typeof ORCHESTRATION_WS_METHODS.subscribeThread>;
  };
}

export function createWsRpcClient(transport: WsTransport): WsRpcClient {
  return {
    dispose: () => transport.dispose(),
    reconnect: async () => {
      resetWsReconnectBackoff();
      await transport.reconnect();
    },
    terminal: {
      open: (input) => transport.request((client) => client[WS_METHODS.terminalOpen](input)),
      write: (input) => transport.request((client) => client[WS_METHODS.terminalWrite](input)),
      resize: (input) => transport.request((client) => client[WS_METHODS.terminalResize](input)),
      clear: (input) => transport.request((client) => client[WS_METHODS.terminalClear](input)),
      restart: (input) => transport.request((client) => client[WS_METHODS.terminalRestart](input)),
      close: (input) => transport.request((client) => client[WS_METHODS.terminalClose](input)),
      onEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeTerminalEvents]({}),
          listener,
          options,
        ),
    },
    projects: {
      searchEntries: (input) =>
        transport.request((client) => client[WS_METHODS.projectsSearchEntries](input)),
      writeFile: (input) =>
        transport.request((client) => client[WS_METHODS.projectsWriteFile](input)),
    },
    presence: {
      listRepositories: (input) =>
        transport.request((client) => client[WS_METHODS.presenceListRepositories](input)),
      importRepository: (input) =>
        transport.request((client) => client[WS_METHODS.presenceImportRepository](input)),
      getBoardSnapshot: (input) =>
        transport.request((client) => client[WS_METHODS.presenceGetBoardSnapshot](input)),
      getRepositoryCapabilities: (input) =>
        transport.request((client) => client[WS_METHODS.presenceGetRepositoryCapabilities](input)),
      scanRepositoryCapabilities: (input) =>
        transport.request((client) => client[WS_METHODS.presenceScanRepositoryCapabilities](input)),
      createTicket: (input) =>
        transport.request((client) => client[WS_METHODS.presenceCreateTicket](input)),
      updateTicket: (input) =>
        transport.request((client) => client[WS_METHODS.presenceUpdateTicket](input)),
      createAttempt: (input) =>
        transport.request((client) => client[WS_METHODS.presenceCreateAttempt](input)),
      prepareWorkspace: (input) =>
        transport.request((client) => client[WS_METHODS.presencePrepareWorkspace](input)),
      cleanupWorkspace: (input) =>
        transport.request((client) => client[WS_METHODS.presenceCleanupWorkspace](input)),
      startAttemptSession: (input) =>
        transport.request((client) => client[WS_METHODS.presenceStartAttemptSession](input)),
      attachThreadToAttempt: (input) =>
        transport.request((client) => client[WS_METHODS.presenceAttachThreadToAttempt](input)),
      saveSupervisorHandoff: (input) =>
        transport.request((client) => client[WS_METHODS.presenceSaveSupervisorHandoff](input)),
      saveWorkerHandoff: (input) =>
        transport.request((client) => client[WS_METHODS.presenceSaveWorkerHandoff](input)),
      saveAttemptEvidence: (input) =>
        transport.request((client) => client[WS_METHODS.presenceSaveAttemptEvidence](input)),
      runAttemptValidation: (input) =>
        transport.request((client) => client[WS_METHODS.presenceRunAttemptValidation](input)),
      resolveFinding: (input) =>
        transport.request((client) => client[WS_METHODS.presenceResolveFinding](input)),
      dismissFinding: (input) =>
        transport.request((client) => client[WS_METHODS.presenceDismissFinding](input)),
      createFollowUpProposal: (input) =>
        transport.request((client) => client[WS_METHODS.presenceCreateFollowUpProposal](input)),
      materializeFollowUp: (input) =>
        transport.request((client) => client[WS_METHODS.presenceMaterializeFollowUp](input)),
      upsertKnowledgePage: (input) =>
        transport.request((client) => client[WS_METHODS.presenceUpsertKnowledgePage](input)),
      createPromotionCandidate: (input) =>
        transport.request((client) => client[WS_METHODS.presenceCreatePromotionCandidate](input)),
      reviewPromotionCandidate: (input) =>
        transport.request((client) => client[WS_METHODS.presenceReviewPromotionCandidate](input)),
      createDeterministicJob: (input) =>
        transport.request((client) => client[WS_METHODS.presenceCreateDeterministicJob](input)),
      evaluateSupervisorAction: (input) =>
        transport.request((client) => client[WS_METHODS.presenceEvaluateSupervisorAction](input)),
      recordValidationWaiver: (input) =>
        transport.request((client) => client[WS_METHODS.presenceRecordValidationWaiver](input)),
      submitGoalIntake: (input) =>
        transport.request((client) => client[WS_METHODS.presenceSubmitGoalIntake](input)),
      startSupervisorRun: (input) =>
        transport.request((client) => client[WS_METHODS.presenceStartSupervisorRun](input)),
      cancelSupervisorRun: (input) =>
        transport.request((client) => client[WS_METHODS.presenceCancelSupervisorRun](input)),
      submitReviewDecision: (input) =>
        transport.request((client) => client[WS_METHODS.presenceSubmitReviewDecision](input)),
    },
    filesystem: {
      browse: (input) => transport.request((client) => client[WS_METHODS.filesystemBrowse](input)),
    },
    shell: {
      openInEditor: (input) =>
        transport.request((client) => client[WS_METHODS.shellOpenInEditor](input)),
    },
    git: {
      pull: (input) => transport.request((client) => client[WS_METHODS.gitPull](input)),
      refreshStatus: (input) =>
        transport.request((client) => client[WS_METHODS.gitRefreshStatus](input)),
      onStatus: (input, listener, options) => {
        let current: GitStatusResult | null = null;
        return transport.subscribe(
          (client) => client[WS_METHODS.subscribeGitStatus](input),
          (event: GitStatusStreamEvent) => {
            current = applyGitStatusStreamEvent(current, event);
            listener(current);
          },
          options,
        );
      },
      runStackedAction: async (input, options) => {
        let result: GitRunStackedActionResult | null = null;

        await transport.requestStream(
          (client) => client[WS_METHODS.gitRunStackedAction](input),
          (event) => {
            options?.onProgress?.(event);
            if (event.kind === "action_finished") {
              result = event.result;
            }
          },
        );

        if (result) {
          return result;
        }

        throw new Error("Git action stream completed without a final result.");
      },
      listBranches: (input) =>
        transport.request((client) => client[WS_METHODS.gitListBranches](input)),
      createWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.gitCreateWorktree](input)),
      removeWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.gitRemoveWorktree](input)),
      createBranch: (input) =>
        transport.request((client) => client[WS_METHODS.gitCreateBranch](input)),
      checkout: (input) => transport.request((client) => client[WS_METHODS.gitCheckout](input)),
      init: (input) => transport.request((client) => client[WS_METHODS.gitInit](input)),
      resolvePullRequest: (input) =>
        transport.request((client) => client[WS_METHODS.gitResolvePullRequest](input)),
      preparePullRequestThread: (input) =>
        transport.request((client) => client[WS_METHODS.gitPreparePullRequestThread](input)),
    },
    server: {
      getConfig: () => transport.request((client) => client[WS_METHODS.serverGetConfig]({})),
      refreshProviders: () =>
        transport.request((client) => client[WS_METHODS.serverRefreshProviders]({})),
      upsertKeybinding: (input) =>
        transport.request((client) => client[WS_METHODS.serverUpsertKeybinding](input)),
      getSettings: () => transport.request((client) => client[WS_METHODS.serverGetSettings]({})),
      updateSettings: (patch) =>
        transport.request((client) => client[WS_METHODS.serverUpdateSettings]({ patch })),
      subscribeConfig: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeServerConfig]({}),
          listener,
          options,
        ),
      subscribeLifecycle: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeServerLifecycle]({}),
          listener,
          options,
        ),
      subscribeAuthAccess: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeAuthAccess]({}),
          listener,
          options,
        ),
    },
    orchestration: {
      dispatchCommand: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.dispatchCommand](input)),
      getTurnDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getTurnDiff](input)),
      getFullThreadDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getFullThreadDiff](input)),
      subscribeShell: (listener, options) =>
        transport.subscribe(
          (client) => client[ORCHESTRATION_WS_METHODS.subscribeShell]({}),
          listener,
          options,
        ),
      subscribeThread: (input, listener, options) =>
        transport.subscribe(
          (client) => client[ORCHESTRATION_WS_METHODS.subscribeThread](input),
          listener,
          options,
        ),
    },
  };
}
