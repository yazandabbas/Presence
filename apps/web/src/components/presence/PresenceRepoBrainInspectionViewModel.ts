import type { BoardSnapshot, TicketRecord } from "@t3tools/contracts";

type RepoBrainInspectionMemory = Readonly<{
  id: string;
  title: string;
  status: string;
  kind: string;
  confidence: string;
  trustMode: string;
  body: string;
  evidenceCount: number;
}>;

type RepoBrainInspectionCandidate = Readonly<{
  id: string;
  title: string;
  status: string;
  proposedBy: string;
  confidence: string;
}>;

type RepoBrainInspectionEvidence = Readonly<{
  id: string;
  role: string;
  summary: string;
  sourceLabel: string;
  observedAt: string;
}>;

type RepoBrainInspectionViewModel = Readonly<{
  headline: string;
  subline: string;
  emptyLabel: string;
  staleProjection: boolean;
  failedProjection: boolean;
  memories: ReadonlyArray<RepoBrainInspectionMemory>;
  candidates: ReadonlyArray<RepoBrainInspectionCandidate>;
  evidence: ReadonlyArray<RepoBrainInspectionEvidence>;
}>;

function sourceMatchesTicket(
  source: BoardSnapshot["repoBrainEvidence"][number]["source"],
  ticket: TicketRecord | null,
) {
  if (!ticket) return true;
  return source.ticketId === ticket.id;
}

function memoryMatchesTicket(
  memory: BoardSnapshot["repoBrainMemories"][number],
  evidence: BoardSnapshot["repoBrainEvidence"],
  ticket: TicketRecord | null,
) {
  if (!ticket) return true;
  if (memory.scope.type === "ticket" && memory.scope.target === ticket.id) return true;
  return evidence.some(
    (item) => item.memoryId === memory.id && sourceMatchesTicket(item.source, ticket),
  );
}

function sourceLabel(source: BoardSnapshot["repoBrainEvidence"][number]["source"]) {
  return (
    source.filePath ??
    source.command ??
    source.reviewArtifactId ??
    source.attemptId ??
    source.ticketId ??
    "source recorded"
  );
}

function buildPresenceRepoBrainInspectionViewModel(input: {
  board: BoardSnapshot;
  ticket: TicketRecord | null;
}): RepoBrainInspectionViewModel {
  const projectionOperations = input.board.operationLedger.filter(
    (operation) => operation.kind === "repo_brain_projection",
  );
  const failedProjection = projectionOperations.some((operation) => operation.status === "failed");
  const staleProjection = projectionOperations.some((operation) => operation.status === "skipped");
  const evidence = input.board.repoBrainEvidence.filter((item) =>
    sourceMatchesTicket(item.source, input.ticket),
  );
  const memories = input.board.repoBrainMemories.filter((memory) =>
    memoryMatchesTicket(memory, input.board.repoBrainEvidence, input.ticket),
  );
  const candidates = input.board.repoBrainPromotionCandidates.filter((candidate) => {
    if (!input.ticket) return true;
    if (candidate.scope.type === "ticket" && candidate.scope.target === input.ticket.id)
      return true;
    return input.board.repoBrainEvidence.some(
      (item) =>
        candidate.sourceEvidenceIds.includes(item.id) &&
        sourceMatchesTicket(item.source, input.ticket),
    );
  });
  const scopeLabel = input.ticket ? "this ticket" : "this repository";
  const activeMemories = memories.filter(
    (memory) => memory.status === "accepted" || memory.status === "edited",
  );
  const deniedCount = memories.filter((memory) => memory.trustMode === "deny").length;
  const pendingCount = candidates.filter((candidate) => candidate.status === "candidate").length;

  return {
    headline: "Repo memory",
    subline:
      activeMemories.length > 0
        ? `${activeMemories.length} reviewed memories are available for ${scopeLabel}.`
        : pendingCount > 0
          ? `${pendingCount} memory candidates are waiting for review.`
          : deniedCount > 0
            ? "Memory exists, but trust settings keep it out of briefing context."
            : `Presence has not promoted durable memory for ${scopeLabel} yet.`,
    emptyLabel: `No repo-brain evidence is available for ${scopeLabel} yet.`,
    staleProjection,
    failedProjection,
    memories: memories.map((memory) => ({
      id: memory.id,
      title: memory.title,
      status: memory.status,
      kind: memory.kind,
      confidence: memory.confidence,
      trustMode: memory.trustMode,
      body: memory.body,
      evidenceCount: memory.sourceEvidenceIds.length,
    })),
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      status: candidate.status,
      proposedBy: candidate.proposedBy,
      confidence: candidate.confidence,
    })),
    evidence: evidence.map((item) => ({
      id: item.id,
      role: item.role,
      summary: item.summary,
      sourceLabel: sourceLabel(item.source),
      observedAt: item.observedAt,
    })),
  };
}

export {
  buildPresenceRepoBrainInspectionViewModel,
  type RepoBrainInspectionCandidate,
  type RepoBrainInspectionEvidence,
  type RepoBrainInspectionMemory,
  type RepoBrainInspectionViewModel,
};
