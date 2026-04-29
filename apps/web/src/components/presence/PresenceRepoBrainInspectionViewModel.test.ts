import type { BoardSnapshot, TicketRecord } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildPresenceRepoBrainInspectionViewModel } from "./PresenceRepoBrainInspectionViewModel";

function board(input: Readonly<Record<string, unknown>>): BoardSnapshot {
  return {
    repoBrainMemories: [],
    repoBrainEvidence: [],
    repoBrainPromotionCandidates: [],
    repoBrainPromotionReviews: [],
    operationLedger: [],
    ...input,
  } as unknown as BoardSnapshot;
}

describe("Presence repo-brain inspection view model", () => {
  it("shows an empty state when no repo-brain records exist", () => {
    const model = buildPresenceRepoBrainInspectionViewModel({
      board: board({}),
      ticket: null,
    });

    expect(model.subline).toContain("has not promoted durable memory");
    expect(model.emptyLabel).toContain("this repository");
    expect(model.memories).toEqual([]);
  });

  it("filters memories, candidates, and evidence to the selected ticket", () => {
    const ticket = { id: "ticket_1" } as TicketRecord;
    const model = buildPresenceRepoBrainInspectionViewModel({
      board: board({
        repoBrainMemories: [
          {
            id: "repo_brain_memory_1",
            repositoryId: "repository_1",
            kind: "workflow",
            status: "accepted",
            title: "Ticket memory",
            body: "This memory belongs to the selected ticket.",
            scope: { type: "ticket", target: "ticket_1" },
            confidence: "high",
            trustMode: "read_write",
            sourceEvidenceIds: ["repo_brain_evidence_1"],
            invalidationTriggers: [],
            createdAt: "2026-04-29T00:00:00.000Z",
            updatedAt: "2026-04-29T00:00:00.000Z",
            reviewedAt: "2026-04-29T00:00:00.000Z",
          },
        ],
        repoBrainEvidence: [
          {
            id: "repo_brain_evidence_1",
            repositoryId: "repository_1",
            memoryId: "repo_brain_memory_1",
            role: "supports",
            source: {
              ticketId: "ticket_1",
              attemptId: "attempt_1",
              reviewArtifactId: null,
              findingId: null,
              missionEventId: null,
              promotionCandidateId: null,
              filePath: "apps/server/src/presence/Layers/internal/PresenceStore.ts",
              symbol: null,
              command: null,
              test: null,
              commitSha: null,
              threadId: null,
              turnId: null,
            },
            summary: "The selected ticket produced this memory.",
            confidence: "high",
            observedAt: "2026-04-29T00:00:00.000Z",
            createdAt: "2026-04-29T00:00:00.000Z",
          },
        ],
        repoBrainPromotionCandidates: [
          {
            id: "promotion_1",
            repositoryId: "repository_1",
            proposedMemoryId: null,
            predecessorCandidateId: null,
            kind: "lesson",
            status: "candidate",
            title: "Candidate memory",
            body: "Pending review.",
            scope: { type: "ticket", target: "ticket_1" },
            confidence: "medium",
            proposedBy: "worker",
            sourceEvidenceIds: ["repo_brain_evidence_1"],
            invalidationTriggers: [],
            createdAt: "2026-04-29T00:00:00.000Z",
            updatedAt: "2026-04-29T00:00:00.000Z",
            reviewedAt: null,
          },
        ],
      }),
      ticket,
    });

    expect(model.memories.map((memory) => memory.title)).toEqual(["Ticket memory"]);
    expect(model.candidates.map((candidate) => candidate.title)).toEqual(["Candidate memory"]);
    expect(model.evidence[0]).toMatchObject({
      role: "supports",
      sourceLabel: "apps/server/src/presence/Layers/internal/PresenceStore.ts",
    });
  });

  it("surfaces failed repo-brain projection state", () => {
    const model = buildPresenceRepoBrainInspectionViewModel({
      board: board({
        operationLedger: [
          {
            id: "presence_operation_1",
            parentOperationId: null,
            boardId: "board_1",
            ticketId: null,
            attemptId: null,
            reviewArtifactId: null,
            supervisorRunId: null,
            threadId: null,
            kind: "repo_brain_projection",
            phase: "project",
            status: "failed",
            dedupeKey: "repo-brain-projection",
            summary: "Projection failed.",
            details: {},
            counters: [],
            error: null,
            startedAt: "2026-04-29T00:00:00.000Z",
            completedAt: "2026-04-29T00:00:01.000Z",
            durationMs: 1000,
            createdAt: "2026-04-29T00:00:00.000Z",
            updatedAt: "2026-04-29T00:00:01.000Z",
          },
        ],
      }),
      ticket: null,
    });

    expect(model.failedProjection).toBe(true);
  });
});
