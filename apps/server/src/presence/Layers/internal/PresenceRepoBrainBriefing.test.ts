import { describe, expect, it } from "vitest";

import type { RepoBrainEvidenceRecord, RepoBrainMemoryRecord } from "@t3tools/contracts";

import {
  buildRepoBrainBriefingLines,
  type RepoBrainRetrievalBriefingResult,
} from "./PresenceRepoBrainBriefing.ts";

const makeResult = (
  overrides: Partial<RepoBrainRetrievalBriefingResult> = {},
): RepoBrainRetrievalBriefingResult =>
  ({
    memory: {
      id: "repo_brain_memory_1",
      repositoryId: "repository_1",
      kind: "workflow",
      status: "accepted",
      title: "Use the Presence focused test command",
      body: "Run the focused Presence test command before escalating to the full suite.",
      scope: { type: "file", target: "apps/server/src/presence/Layers/internal/PresenceStore.ts" },
      confidence: "high",
      trustMode: "read_write",
      sourceEvidenceIds: ["repo_brain_evidence_1"],
      invalidationTriggers: [],
      createdAt: "2026-04-29T00:00:00.000Z",
      updatedAt: "2026-04-29T00:00:00.000Z",
      reviewedAt: "2026-04-29T00:00:00.000Z",
    } as unknown as RepoBrainMemoryRecord,
    evidence: [],
    promptEligible: true,
    citations: [
      {
        evidenceId: "repo_brain_evidence_1",
        role: "supports",
        summary: "Focused repo-brain tests passed.",
        source: {
          ticketId: "ticket_1",
          attemptId: "attempt_1",
          reviewArtifactId: "review_artifact_1",
          filePath: "apps/server/src/presence/Layers/internal/PresenceStore.ts",
          command: "bun run --filter t3 test -- PresenceRepoBrainBriefing.test.ts",
        },
        observedAt: "2026-04-29T00:00:00.000Z",
      },
    ],
    ...overrides,
  }) as unknown as RepoBrainRetrievalBriefingResult;

describe("Presence repo-brain briefing", () => {
  it("formats prompt-eligible memories with status, scope, and citations", () => {
    const lines = buildRepoBrainBriefingLines([makeResult()]);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[workflow; accepted; high; file:");
    expect(lines[0]).toContain("Use the Presence focused test command");
    expect(lines[0]).toContain("Evidence: supports via apps/server/src/presence");
  });

  it("excludes prompt-ineligible memories from the briefing", () => {
    const lines = buildRepoBrainBriefingLines([
      makeResult({ promptEligible: false, evidence: [] as ReadonlyArray<RepoBrainEvidenceRecord> }),
    ]);

    expect(lines).toEqual([]);
  });
});
