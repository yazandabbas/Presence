import { Effect, Layer } from "effect";

import type { SupervisorPolicyDecision } from "@t3tools/contracts";

import {
  SupervisorPolicy,
  type SupervisorPolicyShape,
  type SupervisorPolicyEvaluationInput,
} from "../Services/SupervisorPolicy.ts";

function makeDecision(
  input: SupervisorPolicyEvaluationInput,
  overrides: Partial<SupervisorPolicyDecision>,
): SupervisorPolicyDecision {
  return {
    action: input.action,
    allowed: true,
    reasons: [],
    requiresHumanMerge: input.action === "merge_attempt",
    recommendedTicketStatus: null,
    recommendedAttemptStatus: input.attemptStatus,
    ...overrides,
  };
}

const makeSupervisorPolicy = Effect.succeed<SupervisorPolicyShape>({
  evaluate: (input: SupervisorPolicyEvaluationInput) =>
    Effect.sync(() => {
      switch (input.action) {
        case "start_attempt":
          if (input.attemptStatus === "accepted" || input.attemptStatus === "merged") {
            return makeDecision(input, {
              allowed: false,
              reasons: ["Accepted or merged attempts cannot start a new work session."],
            });
          }
          if (input.attemptStatus === "rejected") {
            return makeDecision(input, {
              allowed: false,
              reasons: ["Rejected attempts cannot resume without a new attempt."],
            });
          }
          if (input.retryBlocked) {
            return makeDecision(input, {
              allowed: false,
              reasons: [
                "Presence detected repeated similar failed attempts on this ticket.",
                "Choose a materially different approach, propose follow-up work, or escalate before retrying.",
              ],
              recommendedTicketStatus: "blocked",
            });
          }
          return makeDecision(input, {
            recommendedTicketStatus: "in_progress",
            recommendedAttemptStatus: "in_progress",
          });
        case "request_review":
          if (!input.attemptBelongsToTicket || !input.attemptHasExecutionContext) {
            return makeDecision(input, {
              allowed: false,
              reasons: ["Only started attempts attached to this ticket can enter review."],
            });
          }
          return makeDecision(input, {
            recommendedTicketStatus: "in_review",
            recommendedAttemptStatus: "in_review",
          });
        case "request_changes":
          if (!input.attemptBelongsToTicket || !input.attemptHasExecutionContext) {
            return makeDecision(input, {
              allowed: false,
              reasons: ["Only started attempts attached to this ticket can receive review feedback."],
            });
          }
          return makeDecision(input, {
            recommendedTicketStatus: "in_progress",
            recommendedAttemptStatus: "in_progress",
          });
        case "approve_attempt":
          if (!input.attemptBelongsToTicket) {
            return makeDecision(input, {
              allowed: false,
              reasons: ["The selected attempt does not belong to the reviewed ticket."],
            });
          }
          if (!input.attemptHasExecutionContext) {
            return makeDecision(input, {
              allowed: false,
              reasons: ["Only attempts that have actually started work can be approved."],
            });
          }
          if (!input.checklistComplete) {
            return makeDecision(input, {
              allowed: false,
              reasons: ["All acceptance checklist items must be completed before approval."],
            });
          }
          const approvalBlockReasons: string[] = [];
          if (input.unresolvedBlockingFindings > 0) {
            approvalBlockReasons.push("Resolve or dismiss all blocking findings before approval.");
          }
          if (approvalBlockReasons.length > 0) {
            return makeDecision(input, {
              allowed: false,
              reasons: approvalBlockReasons,
            });
          }
          return makeDecision(input, {
            recommendedTicketStatus: "ready_to_merge",
            recommendedAttemptStatus: "accepted",
          });
        case "merge_attempt":
          if (input.attemptStatus !== "accepted") {
            return makeDecision(input, {
              allowed: false,
              reasons: ["Only accepted attempts can be merged."],
              requiresHumanMerge: true,
            });
          }
          if (input.unresolvedBlockingFindings > 0) {
            return makeDecision(input, {
              allowed: false,
              reasons: ["Resolve blocking findings before merge."],
              requiresHumanMerge: true,
            });
          }
          return makeDecision(input, {
            recommendedTicketStatus: "done",
            recommendedAttemptStatus: "merged",
            reasons: ["Merge remains a human-triggered action in v1."],
            requiresHumanMerge: true,
          });
      }
    }),
});

export const SupervisorPolicyLive = Layer.effect(SupervisorPolicy, makeSupervisorPolicy);
