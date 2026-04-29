import type {
  PresenceAttemptStatus,
  PresenceTicketStatus,
  RepositoryCapabilityScanRecord,
  SupervisorActionKind,
  SupervisorPolicyDecision,
} from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

export interface SupervisorPolicyEvaluationInput {
  readonly action: SupervisorActionKind;
  readonly ticketStatus: PresenceTicketStatus;
  readonly attemptStatus: PresenceAttemptStatus | null;
  readonly attemptBelongsToTicket: boolean;
  readonly attemptHasExecutionContext: boolean;
  readonly checklistComplete: boolean;
  readonly capabilityScan: RepositoryCapabilityScanRecord | null;
  readonly unresolvedBlockingFindings: number;
  readonly retryBlocked: boolean;
}

export interface SupervisorPolicyShape {
  readonly evaluate: (
    input: SupervisorPolicyEvaluationInput,
  ) => Effect.Effect<SupervisorPolicyDecision, never, never>;
}

export class SupervisorPolicy extends Context.Service<SupervisorPolicy, SupervisorPolicyShape>()(
  "presence/Services/SupervisorPolicy",
) {}
