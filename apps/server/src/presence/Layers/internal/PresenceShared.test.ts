import { describe, expect, it } from "vitest";

import {
  chooseDefaultModelSelection,
  formatPresenceErrorMessage,
  isThreadSettled,
  isModelSelectionAvailable,
  parsePresenceHandoffBlock,
  parsePresenceReviewResultBlock,
  reviewResultHasValidationEvidence,
  stableHash,
  stableStringify,
} from "./PresenceShared.ts";

describe("PresenceShared", () => {
  it("creates stable hashes for equivalent object payloads", () => {
    const left = {
      summary: "Worker updated the repository guide.",
      details: "Inspected the existing docs first.",
      nextAction: "Ask for review.",
    };
    const right = {
      nextAction: "Ask for review.",
      details: "Inspected the existing docs first.",
      summary: "Worker updated the repository guide.",
    };

    expect(stableStringify(left)).toBe(stableStringify(right));
    expect(stableHash(left)).toBe(stableHash(right));
  });

  it("parses the latest structured worker handoff block", () => {
    const result = parsePresenceHandoffBlock(
      [
        "Some prose before the update.",
        "[PRESENCE_HANDOFF]",
        "Completed work:",
        "- added projection health tracking",
        "Current hypothesis:",
        "The stale projection is caused by a failed retry.",
        "Next step:",
        "Re-run the worker after the filesystem recovers.",
        "Open questions:",
        "- Should we back off more aggressively?",
        "[/PRESENCE_HANDOFF]",
      ].join("\n"),
      "2026-04-22T01:00:00.000Z",
    );

    expect(result).toEqual({
      completedWork: ["added projection health tracking"],
      currentHypothesis: "The stale projection is caused by a failed retry.",
      nextStep: "Re-run the worker after the filesystem recovers.",
      openQuestions: ["Should we back off more aggressively?"],
      source: "assistant_block",
      updatedAt: "2026-04-22T01:00:00.000Z",
    });
  });

  it("parses the latest valid structured review result block", () => {
    const result = parsePresenceReviewResultBlock(
      [
        "Reviewer context",
        "[PRESENCE_REVIEW_RESULT]",
        JSON.stringify(
          {
            decision: "accept",
            summary: "The ticket intent and changed files line up.",
            checklistAssessment: [
              {
                label: "Mechanism understood",
                satisfied: true,
                notes: "The handoff explains the mechanism and the code reflects it.",
              },
            ],
            findings: [],
            evidence: [
              {
                kind: "file_inspection",
                target: "apps/server/src/presence/Layers/internal/PresenceShared.ts",
                outcome: "passed",
                relevant: true,
                summary: "Reviewed src/presence/Layers/internal/PresenceShared.ts",
                details: "The parser handles the structured review result block as expected.",
              },
            ],
            changedFilesReviewed: [
              "apps/server/src/presence/Layers/internal/PresenceShared.ts",
              "apps/server/src/presence/Layers/internal/PresencePrompting.ts",
            ],
          },
          null,
          2,
        ),
        "[/PRESENCE_REVIEW_RESULT]",
      ].join("\n"),
      "2026-04-22T01:05:00.000Z",
    );

    expect(result?.decision).toBe("accept");
    expect(result?.checklistAssessment[0]?.satisfied).toBe(true);
    expect(result?.changedFilesReviewed).toEqual([
      "apps/server/src/presence/Layers/internal/PresenceShared.ts",
      "apps/server/src/presence/Layers/internal/PresencePrompting.ts",
    ]);
  });

  it("requires concrete reviewer validation evidence for accept recommendations", () => {
    expect(
      reviewResultHasValidationEvidence(
        {
          decision: "accept",
          summary: "Looks good.",
          checklistAssessment: [
            { label: "Mechanism understood", satisfied: true, notes: "Covered." },
          ],
          findings: [],
          evidence: [
            {
              kind: "reasoning",
              target: null,
              outcome: "inconclusive",
              relevant: true,
              summary: "The change appears reasonable.",
              details: null,
            },
          ],
          changedFilesReviewed: [],
          updatedAt: "2026-04-22T01:05:00.000Z",
        },
        null,
      ),
    ).toBe(false);

    expect(
      reviewResultHasValidationEvidence(
        {
          decision: "accept",
          summary: "The changed file satisfies the ticket.",
          checklistAssessment: [
            { label: "Mechanism understood", satisfied: true, notes: "Covered." },
          ],
          findings: [],
          evidence: [
            {
              kind: "file_inspection",
              target: "README.md",
              outcome: "passed",
              relevant: true,
              summary: "Reviewed README.md and confirmed the requested behavior is documented.",
              details: "The changed section directly addresses the ticket.",
            },
          ],
          changedFilesReviewed: ["README.md"],
          updatedAt: "2026-04-22T01:05:00.000Z",
        },
        null,
      ),
    ).toBe(true);
  });

  it("does not treat a thread with an active runtime session as settled", () => {
    expect(
      isThreadSettled({
        latestTurn: { state: "completed" },
        session: { status: "running", activeTurnId: "turn-1" },
      }),
    ).toBe(false);

    expect(
      isThreadSettled({
        latestTurn: { state: "completed" },
        session: { status: "ready", activeTurnId: null },
      }),
    ).toBe(true);
  });

  it("keeps wrapped Presence errors informative without duplicating the same message", () => {
    const detail = new Error("No actionable tickets were available for the supervisor run.");

    expect(formatPresenceErrorMessage("Failed to start the supervisor runtime.", detail)).toBe(
      "Failed to start the supervisor runtime. No actionable tickets were available for the supervisor run.",
    );
    expect(
      formatPresenceErrorMessage(
        "Failed to start the supervisor runtime. No actionable tickets were available for the supervisor run.",
        detail,
      ),
    ).toBe(
      "Failed to start the supervisor runtime. No actionable tickets were available for the supervisor run.",
    );
  });

  it("prefers authenticated ready providers when choosing the default model selection", () => {
    const selection = chooseDefaultModelSelection([
      {
        provider: "claudeAgent",
        enabled: true,
        installed: true,
        status: "warning",
        auth: { status: "unknown" },
        models: [{ slug: "claude-sonnet-4" }],
      },
      {
        provider: "codex",
        enabled: true,
        installed: true,
        status: "ready",
        auth: { status: "authenticated" },
        models: [{ slug: "gpt-5-mini" }],
      },
    ]);

    expect(selection).toEqual({
      provider: "codex",
      model: "gpt-5-mini",
    });
  });

  it("treats warning or unauthenticated providers as unavailable for saved model selections", () => {
    expect(
      isModelSelectionAvailable(
        [
          {
            provider: "claudeAgent",
            enabled: true,
            installed: true,
            status: "warning",
            auth: { status: "unknown" },
            models: [{ slug: "claude-sonnet-4" }],
          },
        ],
        { provider: "claudeAgent", model: "claude-sonnet-4" },
      ),
    ).toBe(false);

    expect(
      isModelSelectionAvailable(
        [
          {
            provider: "codex",
            enabled: true,
            installed: true,
            status: "ready",
            auth: { status: "authenticated" },
            models: [{ slug: "gpt-5-mini" }],
          },
        ],
        { provider: "codex", model: "gpt-5-mini" },
      ),
    ).toBe(true);
  });
});
