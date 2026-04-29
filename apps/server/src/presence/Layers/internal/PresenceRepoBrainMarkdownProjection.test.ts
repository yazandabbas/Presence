import nodePath from "node:path";

import type { RepoBrainEvidenceRecord, RepoBrainMemoryRecord } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildRepoBrainMemoryMarkdown,
  repoBrainMemoryMarkdownPath,
} from "./PresenceRepoBrainMarkdownProjection.ts";

const memory = {
  id: "repo_brain_memory_1",
  repositoryId: "repository_1",
  kind: "workflow",
  status: "accepted",
  title: "Run Windows-safe validation",
  body: "Use `bun run test` and avoid shell syntax that only works on Unix.",
  scope: { type: "repo", target: "Presence" },
  confidence: "high",
  trustMode: "read_write",
  sourceEvidenceIds: ["repo_brain_evidence_1"],
  invalidationTriggers: [
    {
      kind: "command_removed",
      target: "bun run test",
      reason: "The validation command changed.",
    },
  ],
  createdAt: "2026-04-29T00:00:00.000Z",
  updatedAt: "2026-04-29T00:00:00.000Z",
  reviewedAt: "2026-04-29T00:00:00.000Z",
} as unknown as RepoBrainMemoryRecord;

const evidence = {
  id: "repo_brain_evidence_1",
  repositoryId: "repository_1",
  memoryId: "repo_brain_memory_1",
  role: "supports",
  source: {
    ticketId: "ticket_1",
    attemptId: "attempt_1",
    reviewArtifactId: "review_artifact_1",
    findingId: null,
    missionEventId: null,
    promotionCandidateId: "promotion_1",
    filePath: "apps/server/src/presence/Layers/internal/PresenceStore.ts",
    symbol: null,
    command: "bun run test",
    test: "PresenceRepoBrainPromotionLifecycle.test.ts",
    commitSha: "abc123",
    threadId: null,
    turnId: null,
  },
  summary: "Validated the repo-brain lifecycle on Windows.",
  confidence: "high",
  observedAt: "2026-04-29T00:00:00.000Z",
  createdAt: "2026-04-29T00:00:00.000Z",
} as unknown as RepoBrainEvidenceRecord;

describe("Presence repo-brain markdown projection", () => {
  it("renders deterministic front matter, compiled truth, and evidence timeline", () => {
    const markdown = buildRepoBrainMemoryMarkdown({ memory, evidence: [evidence] });

    expect(markdown).toContain('id: "repo_brain_memory_1"');
    expect(markdown).toContain('trust_mode: "read_write"');
    expect(markdown).toContain("## Compiled Truth");
    expect(markdown).toContain("Use `bun run test`");
    expect(markdown).toContain("## Evidence Timeline");
    expect(markdown).toContain("Validated the repo-brain lifecycle on Windows.");
    expect(markdown).toContain("Source: ticket=ticket_1; attempt=attempt_1");
  });

  it("keeps projected paths contained under the repo-brain root", () => {
    const repoRoot = nodePath.resolve("C:/tmp/presence-repo");
    const filePath = repoBrainMemoryMarkdownPath({ repoRoot, memory });
    const root = nodePath.resolve(repoRoot, ".presence", "repo-brain");

    expect(filePath.startsWith(root)).toBe(true);
    expect(filePath).toContain(`${nodePath.sep}workflow${nodePath.sep}`);
    expect(filePath.endsWith(".md")).toBe(true);
  });
});
