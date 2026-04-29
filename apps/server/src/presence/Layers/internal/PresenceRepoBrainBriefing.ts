import type {
  RepoBrainEvidenceRecord,
  RepoBrainMemoryRecord,
  RepoBrainProvenanceSource,
} from "@t3tools/contracts";

import { truncateText } from "./PresenceShared.ts";

type RepoBrainRetrievalCitation = Readonly<{
  evidenceId: string;
  role: RepoBrainEvidenceRecord["role"];
  summary: string;
  source: RepoBrainProvenanceSource;
  observedAt: string;
}>;

type RepoBrainRetrievalBriefingResult = Readonly<{
  memory: RepoBrainMemoryRecord;
  evidence: ReadonlyArray<RepoBrainEvidenceRecord>;
  promptEligible: boolean;
  citations: ReadonlyArray<RepoBrainRetrievalCitation>;
}>;

const scopeLabel = (scope: RepoBrainMemoryRecord["scope"]): string => {
  switch (scope.type) {
    case "repo":
      return "repo";
    case "package":
      return `package:${scope.target}`;
    case "directory":
      return `directory:${scope.target}`;
    case "file":
      return `file:${scope.target}`;
    case "symbol":
      return `symbol:${scope.target}`;
    case "ticket":
      return `ticket:${scope.target}`;
    case "historical_only":
      return "historical";
  }
  return "unknown";
};

const sourceLabel = (source: RepoBrainProvenanceSource): string => {
  if (source.filePath) return source.filePath;
  if (source.command) return source.command;
  if (source.test) return source.test;
  if (source.reviewArtifactId) return `review:${source.reviewArtifactId}`;
  if (source.findingId) return `finding:${source.findingId}`;
  if (source.handoffId) return `handoff:${source.handoffId}`;
  if (source.missionEventId) return `mission:${source.missionEventId}`;
  if (source.attemptId) return `attempt:${source.attemptId}`;
  if (source.ticketId) return `ticket:${source.ticketId}`;
  return "source:unknown";
};

const citationLabel = (citation: RepoBrainRetrievalCitation): string =>
  `${citation.role} via ${sourceLabel(citation.source)}: ${truncateText(citation.summary, 120)}`;

const formatRepoBrainBriefingLine = (result: RepoBrainRetrievalBriefingResult): string => {
  const memory = result.memory;
  const citationSummary =
    result.citations.length > 0
      ? ` Evidence: ${result.citations.slice(0, 2).map(citationLabel).join(" | ")}.`
      : " Evidence: no citation returned.";
  return `[${memory.kind}; ${memory.status}; ${memory.confidence}; ${scopeLabel(memory.scope)}] ${
    memory.title
  }: ${truncateText(memory.body, 260)}${citationSummary}`;
};

const buildRepoBrainBriefingLines = (
  results: ReadonlyArray<RepoBrainRetrievalBriefingResult>,
  options: { limit?: number } = {},
): ReadonlyArray<string> =>
  results
    .filter((result) => result.promptEligible)
    .slice(0, options.limit ?? 5)
    .map(formatRepoBrainBriefingLine);

export { buildRepoBrainBriefingLines };
export type { RepoBrainRetrievalBriefingResult };
