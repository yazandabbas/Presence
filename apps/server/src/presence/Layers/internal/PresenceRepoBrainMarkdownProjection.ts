import nodePath from "node:path";

import type { RepoBrainEvidenceRecord, RepoBrainMemoryRecord } from "@t3tools/contracts";
import { Effect } from "effect";

import { writeFileStringAtomically } from "../../../atomicWrite.ts";
import { sanitizeProjectionSegment } from "./PresenceShared.ts";

type RepoBrainMarkdownProjectionInput = Readonly<{
  repoRoot: string;
  memory: RepoBrainMemoryRecord;
  evidence: ReadonlyArray<RepoBrainEvidenceRecord>;
}>;

const yamlScalar = (value: string | null) =>
  value === null ? "null" : JSON.stringify(value.replace(/\r\n/g, "\n"));

const yamlList = (values: ReadonlyArray<string>) =>
  values.length === 0 ? "[]" : values.map((value) => `  - ${yamlScalar(value)}`).join("\n");

const formatSource = (source: RepoBrainEvidenceRecord["source"]) =>
  [
    source.ticketId ? `ticket=${source.ticketId}` : null,
    source.attemptId ? `attempt=${source.attemptId}` : null,
    source.reviewArtifactId ? `review=${source.reviewArtifactId}` : null,
    source.findingId ? `finding=${source.findingId}` : null,
    source.filePath ? `file=${source.filePath}` : null,
    source.command ? `command=${source.command}` : null,
    source.commitSha ? `commit=${source.commitSha}` : null,
  ]
    .filter((value): value is string => value !== null)
    .join("; ");

function buildRepoBrainMemoryMarkdown(input: {
  memory: RepoBrainMemoryRecord;
  evidence: ReadonlyArray<RepoBrainEvidenceRecord>;
}) {
  const { memory } = input;
  const evidence = [...input.evidence].sort((left, right) =>
    `${right.observedAt}:${right.id}`.localeCompare(`${left.observedAt}:${left.id}`),
  );
  const invalidationTriggers = memory.invalidationTriggers.map(
    (trigger) => `${trigger.kind}:${trigger.target}:${trigger.reason}`,
  );

  return [
    "---",
    `id: ${yamlScalar(memory.id)}`,
    `kind: ${yamlScalar(memory.kind)}`,
    `scope_type: ${yamlScalar(memory.scope.type)}`,
    `scope_target: ${yamlScalar(memory.scope.target)}`,
    `status: ${yamlScalar(memory.status)}`,
    `confidence: ${yamlScalar(memory.confidence)}`,
    `trust_mode: ${yamlScalar(memory.trustMode)}`,
    `created_at: ${yamlScalar(memory.createdAt)}`,
    `updated_at: ${yamlScalar(memory.updatedAt)}`,
    `reviewed_at: ${yamlScalar(memory.reviewedAt)}`,
    "source_evidence_ids:",
    yamlList(memory.sourceEvidenceIds),
    "invalidation_rules:",
    yamlList(invalidationTriggers),
    "---",
    "",
    `# ${memory.title}`,
    "",
    "## Compiled Truth",
    "",
    memory.body.trim().length > 0 ? memory.body.trim() : "No compiled truth has been recorded.",
    "",
    "## Evidence Timeline",
    "",
    evidence.length === 0
      ? "No evidence has been linked to this memory."
      : evidence
          .map((item) =>
            [
              `### ${item.observedAt} - ${item.role}`,
              "",
              item.summary,
              "",
              `Confidence: ${item.confidence}`,
              `Source: ${formatSource(item.source) || "No source recorded."}`,
            ].join("\n"),
          )
          .join("\n\n"),
    "",
  ].join("\n");
}

function repoBrainMemoryMarkdownPath(input: { repoRoot: string; memory: RepoBrainMemoryRecord }) {
  const root = nodePath.resolve(input.repoRoot, ".presence", "repo-brain");
  const fileName = `${sanitizeProjectionSegment(input.memory.title, "memory")}-${sanitizeProjectionSegment(
    input.memory.id,
    "id",
  )}.md`;
  const target = nodePath.resolve(root, input.memory.kind, fileName);
  const relative = nodePath.relative(root, target);
  if (relative.startsWith("..") || nodePath.isAbsolute(relative)) {
    throw new Error(`Repo-brain markdown path escaped projection root: ${target}`);
  }
  return target;
}

const writeRepoBrainMemoryMarkdown = (input: RepoBrainMarkdownProjectionInput) =>
  Effect.gen(function* () {
    const filePath = repoBrainMemoryMarkdownPath(input);
    const contents = buildRepoBrainMemoryMarkdown(input);
    yield* writeFileStringAtomically({ filePath, contents });
    return { filePath, contents };
  });

export { buildRepoBrainMemoryMarkdown, repoBrainMemoryMarkdownPath, writeRepoBrainMemoryMarkdown };
