import {
  BookOpenIcon,
  BotIcon,
  CheckCheckIcon,
  ClipboardListIcon,
  FolderPlusIcon,
  HammerIcon,
  PlayIcon,
  RefreshCcwIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react";
import {
  type BoardSnapshot,
  type PresenceReviewDecisionKind,
  type PresenceTicketStatus,
  type RepositorySummary,
  type TicketRecord,
} from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { readLocalApi } from "~/localApi";
import { usePrimaryEnvironmentId } from "~/environments/primary";
import { readEnvironmentApi } from "~/environmentApi";
import {
  boardSnapshotQueryOptions,
  listRepositoriesQueryOptions,
  presenceQueryKeys,
} from "~/lib/presenceReactQuery";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { Input } from "../ui/input";
import { Separator } from "../ui/separator";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";

const STATUS_COLUMNS: readonly PresenceTicketStatus[] = [
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
];

const STATUS_LABELS: Record<PresenceTicketStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  blocked: "Blocked",
  done: "Done",
};

const PRIORITY_VARIANTS = {
  p0: "destructive",
  p1: "warning",
  p2: "info",
  p3: "secondary",
} as const;

type InspectorMode = "ticket" | "memory" | "ops";

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function PresenceEmptyState({ onImport }: { onImport: () => void }) {
  return (
    <Empty className="min-h-[60vh] rounded-2xl border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BotIcon />
        </EmptyMedia>
        <EmptyTitle>Import a repository to start Presence.</EmptyTitle>
        <EmptyDescription>
          Presence turns one local repository into a supervisor-managed board with attempts,
          handoffs, knowledge, and deterministic jobs.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={onImport}>
          <FolderPlusIcon />
          Import repository
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function DetailSection(props: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card">
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-foreground">{props.title}</div>
          {props.description ? (
            <div className="mt-1 text-xs leading-5 text-muted-foreground">{props.description}</div>
          ) : null}
        </div>
        {props.action}
      </div>
      <Separator />
      <div className="px-4 py-4">{props.children}</div>
    </section>
  );
}

function MetricPill(props: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {props.label}
      </div>
      <div className="mt-1 text-lg font-semibold text-foreground">{props.value}</div>
    </div>
  );
}

function RepositoryRail(props: {
  repositories: readonly RepositorySummary[];
  selectedRepositoryId: string | null;
  onSelect: (repositoryId: string) => void;
}) {
  return (
    <aside className="border-r bg-muted/10">
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b px-4 py-4">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Repositories
          </div>
          <div className="mt-2 text-sm leading-6 text-muted-foreground">
            One board per repo. Runtime sessions stay attached to attempts, not floating chats.
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
          <div className="space-y-2">
            {props.repositories.map((repository) => {
              const selected = props.selectedRepositoryId === repository.id;
              return (
                <button
                  key={repository.id}
                  type="button"
                  className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                    selected
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-transparent bg-background hover:border-border hover:bg-card"
                  }`}
                  onClick={() => props.onSelect(repository.id)}
                >
                  <div className="truncate text-sm font-medium text-foreground">
                    {repository.title}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {repository.workspaceRoot}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="outline">board</Badge>
                    {repository.projectId ? (
                      <Badge variant="secondary">runtime linked</Badge>
                    ) : (
                      <Badge variant="warning">runtime missing</Badge>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}

function TicketTile(props: {
  ticket: TicketRecord;
  board: BoardSnapshot;
  selected: boolean;
  onSelect: () => void;
}) {
  const attempts = props.board.attemptSummaries.filter(
    (attempt) => attempt.attempt.ticketId === props.ticket.id,
  );
  const latestDecision = props.board.reviewDecisions.find(
    (decision) => decision.ticketId === props.ticket.id,
  );

  return (
    <button
      type="button"
      onClick={props.onSelect}
      className={`w-full rounded-xl border px-3 py-3 text-left transition ${
        props.selected
          ? "border-primary bg-primary/6 shadow-sm"
          : "border-border/70 bg-background hover:border-border hover:bg-card"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{props.ticket.title}</div>
          <div className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">
            {props.ticket.description || "No description captured yet."}
          </div>
        </div>
        <Badge variant={PRIORITY_VARIANTS[props.ticket.priority]}>
          {props.ticket.priority.toUpperCase()}
        </Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        <Badge variant="outline">{attempts.length} attempt{attempts.length === 1 ? "" : "s"}</Badge>
        <Badge variant="outline">
          {props.ticket.acceptanceChecklist.filter((item) => item.checked).length}/
          {props.ticket.acceptanceChecklist.length} checks
        </Badge>
        {latestDecision ? <span>Review: {latestDecision.decision}</span> : <span>Awaiting review</span>}
      </div>
    </button>
  );
}

function BoardColumn(props: {
  status: PresenceTicketStatus;
  tickets: readonly TicketRecord[];
  board: BoardSnapshot;
  selectedTicketId: string | null;
  onSelectTicket: (ticketId: string) => void;
}) {
  return (
    <section className="flex h-full w-[320px] shrink-0 flex-col rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-foreground">{STATUS_LABELS[props.status]}</div>
          <div className="text-xs text-muted-foreground">
            {props.tickets.length === 0
              ? "No tickets"
              : `${props.tickets.length} ticket${props.tickets.length === 1 ? "" : "s"}`}
          </div>
        </div>
        <Badge variant="outline">{props.tickets.length}</Badge>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {props.tickets.length === 0 ? (
          <div className="rounded-xl border border-dashed px-3 py-4 text-xs leading-5 text-muted-foreground">
            This lane is clear.
          </div>
        ) : null}
        {props.tickets.map((ticket) => (
          <TicketTile
            key={ticket.id}
            ticket={ticket}
            board={props.board}
            selected={ticket.id === props.selectedTicketId}
            onSelect={() => props.onSelectTicket(ticket.id)}
          />
        ))}
      </div>
    </section>
  );
}

function AttemptInspector(props: {
  board: BoardSnapshot;
  ticket: TicketRecord;
  handoffDraftByAttempt: Record<string, string>;
  onChangeHandoffDraft: (attemptId: string, value: string) => void;
  onCreateAttempt: (ticketId: string) => void;
  onStartAttemptSession: (attemptId: string) => void;
  onRequestChanges: (ticketId: string, attemptId: string | null) => void;
  onAccept: (ticketId: string, attemptId: string | null) => void;
  onSaveWorkerHandoff: (attemptId: string, draft: string) => void;
  onCreatePromotionCandidate: (ticketId: string, attemptId: string | null) => void;
}) {
  const attempts = props.board.attemptSummaries.filter(
    (attempt) => attempt.attempt.ticketId === props.ticket.id,
  );
  const latestDecision = props.board.reviewDecisions.find(
    (decision) => decision.ticketId === props.ticket.id,
  );

  return (
    <div className="space-y-4">
      <DetailSection
        title={props.ticket.title}
        description={props.ticket.description || "No description captured yet."}
        action={
          <Badge variant={PRIORITY_VARIANTS[props.ticket.priority]}>
            {props.ticket.priority.toUpperCase()}
          </Badge>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{STATUS_LABELS[props.ticket.status]}</Badge>
            <Badge variant="outline">
              {props.ticket.acceptanceChecklist.filter((item) => item.checked).length}/
              {props.ticket.acceptanceChecklist.length} checks
            </Badge>
            {latestDecision ? <Badge variant="outline">{latestDecision.decision}</Badge> : null}
          </div>
          <div className="grid gap-2">
            {props.ticket.acceptanceChecklist.length === 0 ? (
              <div className="text-sm text-muted-foreground">No acceptance checklist yet.</div>
            ) : (
              props.ticket.acceptanceChecklist.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 rounded-lg border border-border/70 px-3 py-2 text-sm"
                >
                  <div
                    className={`size-2 rounded-full ${
                      item.checked ? "bg-emerald-500" : "bg-muted-foreground/40"
                    }`}
                  />
                  <span className={item.checked ? "text-foreground" : "text-muted-foreground"}>
                    {item.label}
                  </span>
                </div>
              ))
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => props.onCreateAttempt(props.ticket.id)}>
              <HammerIcon />
              Create attempt
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => props.onRequestChanges(props.ticket.id, attempts[0]?.attempt.id ?? null)}
            >
              <ShieldCheckIcon />
              Request changes
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => props.onAccept(props.ticket.id, attempts[0]?.attempt.id ?? null)}
            >
              <CheckCheckIcon />
              Accept
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                props.onCreatePromotionCandidate(props.ticket.id, attempts[0]?.attempt.id ?? null)
              }
            >
              <SparklesIcon />
              Promote insight
            </Button>
          </div>
        </div>
      </DetailSection>

      <DetailSection
        title="Attempts"
        description="Sessions stay bounded to the selected ticket. Handoffs live here, not in board-level memory."
      >
        <div className="space-y-3">
          {attempts.length === 0 ? (
            <div className="rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground">
              No attempts yet. Create one when the ticket is ready for execution.
            </div>
          ) : null}
          {attempts.map((summary) => (
            <div key={summary.attempt.id} className="rounded-xl border border-border/70 bg-background">
              <div className="flex items-start justify-between gap-3 px-3 py-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    {summary.attempt.title}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {summary.attempt.provider
                      ? `${summary.attempt.provider} · ${summary.attempt.model}`
                      : "No session attached yet"}
                  </div>
                  {summary.latestWorkerHandoff?.nextStep ? (
                    <div className="mt-2 text-xs leading-5 text-muted-foreground">
                      Next step: {summary.latestWorkerHandoff.nextStep}
                    </div>
                  ) : null}
                </div>
                <Badge variant="outline">{summary.attempt.status}</Badge>
              </div>
              <Separator />
              <div className="space-y-3 px-3 py-3">
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => props.onStartAttemptSession(summary.attempt.id)}
                  >
                    {summary.attempt.threadId ? <RefreshCcwIcon /> : <PlayIcon />}
                    {summary.attempt.threadId ? "Open session" : "Start session"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => props.onRequestChanges(props.ticket.id, summary.attempt.id)}
                  >
                    <ShieldCheckIcon />
                    Request changes
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => props.onAccept(props.ticket.id, summary.attempt.id)}
                  >
                    <CheckCheckIcon />
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      props.onCreatePromotionCandidate(props.ticket.id, summary.attempt.id)
                    }
                  >
                    <SparklesIcon />
                    Promote insight
                  </Button>
                </div>
                <div className="space-y-2">
                  <Textarea
                    value={props.handoffDraftByAttempt[summary.attempt.id] ?? ""}
                    onChange={(event) =>
                      props.onChangeHandoffDraft(summary.attempt.id, event.target.value)
                    }
                    rows={4}
                    placeholder="Capture completed work, hypothesis, tests, blockers, and next step."
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      const draft = props.handoffDraftByAttempt[summary.attempt.id] ?? "";
                      if (!draft.trim()) return;
                      props.onSaveWorkerHandoff(summary.attempt.id, draft);
                    }}
                  >
                    <ClipboardListIcon />
                    Save handoff
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </DetailSection>
    </div>
  );
}

function MemoryInspector(props: {
  board: BoardSnapshot;
  supervisorPriorities: string;
  supervisorActions: string;
  onSupervisorPrioritiesChange: (value: string) => void;
  onSupervisorActionsChange: (value: string) => void;
  onSaveSupervisorHandoff: () => void;
  knowledgeTitle: string;
  knowledgeCompiledTruth: string;
  knowledgeTimeline: string;
  onKnowledgeTitleChange: (value: string) => void;
  onKnowledgeCompiledTruthChange: (value: string) => void;
  onKnowledgeTimelineChange: (value: string) => void;
  onSaveKnowledgePage: () => void;
}) {
  return (
    <div className="space-y-4">
      <DetailSection
        title="Supervisor handoff"
        description="Board-level continuity for the next supervisor session."
      >
        <div className="space-y-3">
          <Textarea
            value={props.supervisorPriorities}
            onChange={(event) => props.onSupervisorPrioritiesChange(event.target.value)}
            rows={4}
            placeholder="One priority per line"
          />
          <Textarea
            value={props.supervisorActions}
            onChange={(event) => props.onSupervisorActionsChange(event.target.value)}
            rows={4}
            placeholder="Next board actions, one per line"
          />
          <Button size="sm" onClick={props.onSaveSupervisorHandoff}>
            <ClipboardListIcon />
            Save supervisor handoff
          </Button>
        </div>
      </DetailSection>

      <DetailSection
        title="Knowledge pages"
        description="Reviewed truth stays durable. Scratch state should not leak into the project memory."
      >
        <div className="space-y-3">
          <Input
            value={props.knowledgeTitle}
            onChange={(event) => props.onKnowledgeTitleChange(event.target.value)}
            placeholder="Runbook / pattern title"
          />
          <Textarea
            value={props.knowledgeCompiledTruth}
            onChange={(event) => props.onKnowledgeCompiledTruthChange(event.target.value)}
            rows={3}
            placeholder="Compiled truth"
          />
          <Textarea
            value={props.knowledgeTimeline}
            onChange={(event) => props.onKnowledgeTimelineChange(event.target.value)}
            rows={3}
            placeholder="Timeline / evidence"
          />
          <Button size="sm" disabled={!props.knowledgeTitle.trim()} onClick={props.onSaveKnowledgePage}>
            <BookOpenIcon />
            Save knowledge page
          </Button>
        </div>

        <Separator className="my-4" />

        <div className="space-y-2">
          {props.board.knowledgePages.length === 0 ? (
            <div className="rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground">
              No knowledge pages yet.
            </div>
          ) : null}
          {props.board.knowledgePages.map((page) => (
            <div key={page.id} className="rounded-xl border border-border/70 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-foreground">{page.title}</div>
                <Badge variant="outline">{page.family}</Badge>
              </div>
              <div className="mt-2 text-xs leading-5 text-muted-foreground">
                {page.compiledTruth || "No compiled truth yet."}
              </div>
            </div>
          ))}
        </div>
      </DetailSection>
    </div>
  );
}

function OpsInspector(props: {
  board: BoardSnapshot;
  jobTitle: string;
  jobKind: string;
  onJobTitleChange: (value: string) => void;
  onJobKindChange: (value: string) => void;
  onCreateJob: () => void;
}) {
  return (
    <div className="space-y-4">
      <DetailSection
        title="Deterministic jobs"
        description="Queue repeatable maintenance without burning reasoning tokens."
      >
        <div className="space-y-3">
          <Input
            value={props.jobTitle}
            onChange={(event) => props.onJobTitleChange(event.target.value)}
            placeholder="Nightly repo scan"
          />
          <Input
            value={props.jobKind}
            onChange={(event) => props.onJobKindChange(event.target.value)}
            placeholder="repo_scan"
          />
          <Button size="sm" disabled={!props.jobTitle.trim()} onClick={props.onCreateJob}>
            <HammerIcon />
            Queue deterministic job
          </Button>
        </div>

        <Separator className="my-4" />

        <div className="space-y-2">
          {props.board.jobs.length === 0 ? (
            <div className="rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground">
              No deterministic jobs queued yet.
            </div>
          ) : null}
          {props.board.jobs.map((job) => (
            <div key={job.id} className="rounded-xl border border-border/70 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">{job.title}</div>
                  <div className="text-xs text-muted-foreground">{job.kind}</div>
                </div>
                <Badge variant="outline">{job.status}</Badge>
              </div>
            </div>
          ))}
        </div>
      </DetailSection>

      <DetailSection
        title="Promotion candidates"
        description="Workers can suggest durable insights. Supervisors still decide what becomes institutional memory."
      >
        <div className="space-y-2">
          {props.board.promotionCandidates.length === 0 ? (
            <div className="rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground">
              No promotion candidates yet.
            </div>
          ) : null}
          {props.board.promotionCandidates.map((candidate) => (
            <div key={candidate.id} className="rounded-xl border border-border/70 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">{candidate.title}</div>
                  <div className="text-xs text-muted-foreground">{candidate.family}</div>
                </div>
                <Badge variant="outline">{candidate.status}</Badge>
              </div>
              <div className="mt-2 text-xs leading-5 text-muted-foreground">
                {candidate.compiledTruth}
              </div>
            </div>
          ))}
        </div>
      </DetailSection>
    </div>
  );
}

function InspectorTabs(props: {
  mode: InspectorMode;
  onModeChange: (mode: InspectorMode) => void;
}) {
  const tabs: Array<{ id: InspectorMode; label: string }> = [
    { id: "ticket", label: "Ticket" },
    { id: "memory", label: "Memory" },
    { id: "ops", label: "Ops" },
  ];

  return (
    <div className="flex gap-2 rounded-xl border bg-background p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
            props.mode === tab.id
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted"
          }`}
          onClick={() => props.onModeChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function PresenceDashboard() {
  const environmentId = usePrimaryEnvironmentId();
  const api = environmentId ? readEnvironmentApi(environmentId) ?? null : null;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const localApi = readLocalApi();

  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>("ticket");
  const [ticketTitle, setTicketTitle] = useState("");
  const [ticketDescription, setTicketDescription] = useState("");
  const [handoffDraftByAttempt, setHandoffDraftByAttempt] = useState<Record<string, string>>({});
  const [supervisorPriorities, setSupervisorPriorities] = useState(
    "Contain active work\nPreserve continuity\nPromote reviewed knowledge",
  );
  const [supervisorActions, setSupervisorActions] = useState(
    "Review open attempts\nReject weak work\nQueue deterministic scans",
  );
  const [knowledgeTitle, setKnowledgeTitle] = useState("");
  const [knowledgeCompiledTruth, setKnowledgeCompiledTruth] = useState("");
  const [knowledgeTimeline, setKnowledgeTimeline] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [jobKind, setJobKind] = useState("repo_scan");

  const repositoriesQuery = useQuery({
    ...listRepositoriesQueryOptions(environmentId),
    enabled: environmentId !== null && api !== null,
  });
  const repositories = repositoriesQuery.data ?? [];

  useEffect(() => {
    if (!selectedRepositoryId && repositories[0]) {
      setSelectedRepositoryId(repositories[0].id);
    }
  }, [repositories, selectedRepositoryId]);

  const selectedRepository = useMemo<RepositorySummary | null>(
    () => repositories.find((repository) => repository.id === selectedRepositoryId) ?? null,
    [repositories, selectedRepositoryId],
  );

  const boardQuery = useQuery({
    ...boardSnapshotQueryOptions(environmentId, selectedRepository?.boardId ?? null),
    enabled: environmentId !== null && api !== null && selectedRepository !== null,
  });
  const board = boardQuery.data;

  useEffect(() => {
    if (!board || board.tickets.length === 0) {
      setSelectedTicketId(null);
      return;
    }

    const selectedStillExists = selectedTicketId
      ? board.tickets.some((ticket) => ticket.id === selectedTicketId)
      : false;
    if (selectedStillExists) {
      return;
    }

    const preferredTicket =
      board.tickets.find((ticket) => ticket.status !== "done") ?? board.tickets[0] ?? null;
    setSelectedTicketId(preferredTicket?.id ?? null);
  }, [board, selectedTicketId]);

  const selectedTicket = useMemo<TicketRecord | null>(
    () => board?.tickets.find((ticket) => ticket.id === selectedTicketId) ?? null,
    [board, selectedTicketId],
  );

  if (environmentId && !api) {
    return (
      <Empty className="min-h-[60vh] rounded-2xl border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BotIcon />
          </EmptyMedia>
          <EmptyTitle>Connecting to Presence...</EmptyTitle>
          <EmptyDescription>
            The local environment exists, but its API connection is not ready yet.
            Keep the dev server running and refresh once the desktop or web session finishes booting.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const invalidatePresence = async (boardId?: string | null) => {
    await queryClient.invalidateQueries({ queryKey: presenceQueryKeys.repositories(environmentId) });
    if (boardId) {
      await queryClient.invalidateQueries({
        queryKey: presenceQueryKeys.boardSnapshot(environmentId, boardId as never),
      });
    }
  };

  const importRepositoryMutation = useMutation({
    mutationFn: async () => {
      if (!api) throw new Error("Primary environment is unavailable.");
      const workspaceRoot = await localApi?.dialogs.pickFolder?.();
      if (!workspaceRoot) return null;
      return api.presence.importRepository({ workspaceRoot });
    },
    onSuccess: async (repository) => {
      if (!repository) return;
      setSelectedRepositoryId(repository.id);
      await invalidatePresence(repository.boardId);
      toastManager.add({
        type: "success",
        title: "Repository imported",
        description: repository.title,
      });
    },
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: "Import failed",
        description: error instanceof Error ? error.message : "Unable to import repository.",
      }),
  });

  const createTicketMutation = useMutation({
    mutationFn: async () => {
      if (!api || !selectedRepository) throw new Error("Select a repository first.");
      return api.presence.createTicket({
        boardId: selectedRepository.boardId,
        title: ticketTitle.trim(),
        description: ticketDescription.trim(),
        priority: "p2",
        acceptanceChecklist: [
          { id: crypto.randomUUID(), label: "Mechanism understood", checked: false },
          { id: crypto.randomUUID(), label: "Evidence attached", checked: false },
          { id: crypto.randomUUID(), label: "Validation recorded", checked: false },
        ],
      });
    },
    onSuccess: async (ticket) => {
      setTicketTitle("");
      setTicketDescription("");
      setSelectedTicketId(ticket.id);
      setInspectorMode("ticket");
      await invalidatePresence(selectedRepository?.boardId);
    },
  });

  const createAttemptMutation = useMutation({
    mutationFn: async (ticketId: string) => {
      if (!api) throw new Error("Primary environment is unavailable.");
      return api.presence.createAttempt({ ticketId: ticketId as never });
    },
    onSuccess: async (attempt) => {
      setSelectedTicketId(attempt.ticketId);
      setInspectorMode("ticket");
      await invalidatePresence(selectedRepository?.boardId);
    },
  });

  const startAttemptSessionMutation = useMutation({
    mutationFn: async (attemptId: string) => {
      if (!api || !environmentId) throw new Error("Primary environment is unavailable.");
      return api.presence.startAttemptSession({ attemptId: attemptId as never });
    },
    onSuccess: async (session) => {
      await invalidatePresence(selectedRepository?.boardId);
      if (!environmentId) return;
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: session.threadId },
      });
    },
  });

  const submitReviewDecisionMutation = useMutation({
    mutationFn: async (input: {
      ticketId: string;
      attemptId: string | null;
      decision: PresenceReviewDecisionKind;
    }) => {
      if (!api) throw new Error("Primary environment is unavailable.");
      return api.presence.submitReviewDecision({
        ticketId: input.ticketId as never,
        attemptId: input.attemptId as never,
        decision: input.decision,
        notes:
          input.decision === "accept"
            ? "Accepted against the current ticket checklist."
            : "Supervisor requested another iteration.",
      });
    },
    onSuccess: async () => {
      await invalidatePresence(selectedRepository?.boardId);
    },
  });

  const saveSupervisorHandoffMutation = useMutation({
    mutationFn: async () => {
      if (!api || !selectedRepository || !board) throw new Error("Select a repository first.");
      return api.presence.saveSupervisorHandoff({
        boardId: selectedRepository.boardId,
        topPriorities: splitLines(supervisorPriorities),
        activeAttemptIds: board.attempts.map((attempt) => attempt.id),
        blockedTicketIds: board.tickets
          .filter((ticket) => ticket.status === "blocked")
          .map((ticket) => ticket.id),
        recentDecisions: [
          "Workers never write directly to board memory",
          "Tickets require explicit review",
        ],
        nextBoardActions: splitLines(supervisorActions),
      });
    },
    onSuccess: async () => {
      setInspectorMode("memory");
      await invalidatePresence(selectedRepository?.boardId);
    },
  });

  const saveWorkerHandoffMutation = useMutation({
    mutationFn: async (input: { attemptId: string; draft: string }) => {
      if (!api) throw new Error("Primary environment is unavailable.");
      const lines = splitLines(input.draft);
      return api.presence.saveWorkerHandoff({
        attemptId: input.attemptId as never,
        completedWork: lines.length > 0 ? [lines[0]!] : ["Captured the current execution state in Presence."],
        currentHypothesis:
          lines[1] ??
          "The next worker should resume from the linked ticket, evidence, and handoff.",
        changedFiles: [],
        testsRun: [],
        blockers: [],
        nextStep: lines.at(-1) ?? "Open the attempt session and continue the task.",
        confidence: 0.7,
        evidenceIds: [],
      });
    },
    onSuccess: async (_result, variables) => {
      setHandoffDraftByAttempt((current) => {
        const next = { ...current };
        delete next[variables.attemptId];
        return next;
      });
      await invalidatePresence(selectedRepository?.boardId);
    },
  });

  const createPromotionCandidateMutation = useMutation({
    mutationFn: async (input: { ticketId: string; attemptId: string | null }) => {
      if (!api) throw new Error("Primary environment is unavailable.");
      const ticket = board?.tickets.find((candidate) => candidate.id === input.ticketId);
      return api.presence.createPromotionCandidate({
        sourceTicketId: input.ticketId as never,
        sourceAttemptId: input.attemptId as never,
        family: "bug-patterns",
        title: ticket ? `${ticket.title} pattern` : "Observed pattern",
        slug: `pattern-${crypto.randomUUID().slice(0, 8)}`,
        compiledTruth:
          "Reviewed findings should become durable knowledge only after supervisor approval.",
        timelineEntry: `${new Date().toISOString()} - Promotion candidate created from Presence dashboard.`,
      });
    },
    onSuccess: async () => {
      setInspectorMode("ops");
      await invalidatePresence(selectedRepository?.boardId);
    },
  });

  const upsertKnowledgePageMutation = useMutation({
    mutationFn: async () => {
      if (!api || !selectedRepository || !knowledgeTitle.trim()) {
        throw new Error("A board and title are required.");
      }
      return api.presence.upsertKnowledgePage({
        boardId: selectedRepository.boardId,
        family: "runbooks",
        slug: knowledgeTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        title: knowledgeTitle.trim(),
        compiledTruth: knowledgeCompiledTruth.trim(),
        timeline: knowledgeTimeline.trim(),
        linkedTicketIds: board?.tickets.slice(0, 2).map((ticket) => ticket.id) ?? [],
      });
    },
    onSuccess: async () => {
      setKnowledgeTitle("");
      setKnowledgeCompiledTruth("");
      setKnowledgeTimeline("");
      setInspectorMode("memory");
      await invalidatePresence(selectedRepository?.boardId);
    },
  });

  const createJobMutation = useMutation({
    mutationFn: async () => {
      if (!api || !selectedRepository) throw new Error("Select a repository first.");
      return api.presence.createDeterministicJob({
        boardId: selectedRepository.boardId,
        title: jobTitle.trim(),
        kind: jobKind.trim(),
      });
    },
    onSuccess: async () => {
      setJobTitle("");
      setInspectorMode("ops");
      await invalidatePresence(selectedRepository?.boardId);
    },
  });

  const handleChangeHandoffDraft = (attemptId: string, value: string) => {
    setHandoffDraftByAttempt((current) => ({
      ...current,
      [attemptId]: value,
    }));
  };

  if (repositoriesQuery.isLoading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading Presence repositories...</div>;
  }

  if (!repositories.length) {
    return <PresenceEmptyState onImport={() => importRepositoryMutation.mutate()} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="border-b px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Presence v1
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight">
              Supervisor-managed repo organization
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Board-first workflow with bounded attempts, explicit handoffs, and durable knowledge.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => importRepositoryMutation.mutate()}>
              <FolderPlusIcon />
              Import repository
            </Button>
            {selectedRepository ? (
              <Button
                variant="outline"
                onClick={() => void invalidatePresence(selectedRepository.boardId)}
              >
                <RefreshCcwIcon />
                Refresh board
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 xl:grid-cols-[248px_minmax(0,1fr)_380px]">
        <RepositoryRail
          repositories={repositories}
          selectedRepositoryId={selectedRepositoryId}
          onSelect={(repositoryId) => {
            setSelectedRepositoryId(repositoryId);
            setInspectorMode("ticket");
          }}
        />

        <main className="min-h-0 border-t xl:border-t-0">
          {board ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-lg font-semibold text-foreground">{board.board.title}</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {board.repository.workspaceRoot}
                      {board.board.sprintFocus ? ` · ${board.board.sprintFocus}` : ""}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <MetricPill label="Tickets" value={board.tickets.length} />
                    <MetricPill label="Attempts" value={board.attempts.length} />
                    <MetricPill label="Knowledge" value={board.knowledgePages.length} />
                    <MetricPill label="Jobs" value={board.jobs.length} />
                  </div>
                </div>

                <div className="mt-4 rounded-xl border bg-card">
                  <div className="grid gap-3 p-3 lg:grid-cols-[minmax(220px,0.9fr)_minmax(0,1.5fr)_auto]">
                    <Input
                      value={ticketTitle}
                      onChange={(event) => setTicketTitle(event.target.value)}
                      placeholder="New ticket title"
                    />
                    <Textarea
                      value={ticketDescription}
                      onChange={(event) => setTicketDescription(event.target.value)}
                      placeholder="Problem, acceptance checks, or desired outcome."
                      rows={2}
                    />
                    <Button
                      className="lg:self-stretch"
                      disabled={!ticketTitle.trim()}
                      onClick={() => createTicketMutation.mutate()}
                    >
                      <ClipboardListIcon />
                      Add ticket
                    </Button>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
                <div className="flex min-h-full gap-3 overflow-x-auto pb-2">
                  {STATUS_COLUMNS.map((status) => (
                    <BoardColumn
                      key={status}
                      status={status}
                      tickets={board.tickets.filter((ticket) => ticket.status === status)}
                      board={board}
                      selectedTicketId={selectedTicketId}
                      onSelectTicket={(ticketId) => {
                        setSelectedTicketId(ticketId);
                        setInspectorMode("ticket");
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
              Select a repository to load its Presence board.
            </div>
          )}
        </main>

        <aside className="border-l bg-muted/10">
          <div className="flex h-full min-h-0 flex-col">
            <div className="border-b px-4 py-4">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Inspector
              </div>
              <div className="mt-2">
                <InspectorTabs mode={inspectorMode} onModeChange={setInspectorMode} />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
              {!board ? (
                <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                  Pick a repository to open the Presence inspector.
                </div>
              ) : inspectorMode === "ticket" ? (
                selectedTicket ? (
                  <AttemptInspector
                    board={board}
                    ticket={selectedTicket}
                    handoffDraftByAttempt={handoffDraftByAttempt}
                    onChangeHandoffDraft={handleChangeHandoffDraft}
                    onCreateAttempt={(ticketId) => createAttemptMutation.mutate(ticketId)}
                    onStartAttemptSession={(attemptId) =>
                      startAttemptSessionMutation.mutate(attemptId)
                    }
                    onRequestChanges={(ticketId, attemptId) =>
                      submitReviewDecisionMutation.mutate({
                        ticketId,
                        attemptId,
                        decision: "request_changes",
                      })
                    }
                    onAccept={(ticketId, attemptId) =>
                      submitReviewDecisionMutation.mutate({
                        ticketId,
                        attemptId,
                        decision: "accept",
                      })
                    }
                    onSaveWorkerHandoff={(attemptId, draft) =>
                      saveWorkerHandoffMutation.mutate({ attemptId, draft })
                    }
                    onCreatePromotionCandidate={(ticketId, attemptId) =>
                      createPromotionCandidateMutation.mutate({ ticketId, attemptId })
                    }
                  />
                ) : (
                  <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                    Select a ticket to review attempts, capture handoffs, and manage acceptance.
                  </div>
                )
              ) : inspectorMode === "memory" ? (
                <MemoryInspector
                  board={board}
                  supervisorPriorities={supervisorPriorities}
                  supervisorActions={supervisorActions}
                  onSupervisorPrioritiesChange={setSupervisorPriorities}
                  onSupervisorActionsChange={setSupervisorActions}
                  onSaveSupervisorHandoff={() => saveSupervisorHandoffMutation.mutate()}
                  knowledgeTitle={knowledgeTitle}
                  knowledgeCompiledTruth={knowledgeCompiledTruth}
                  knowledgeTimeline={knowledgeTimeline}
                  onKnowledgeTitleChange={setKnowledgeTitle}
                  onKnowledgeCompiledTruthChange={setKnowledgeCompiledTruth}
                  onKnowledgeTimelineChange={setKnowledgeTimeline}
                  onSaveKnowledgePage={() => upsertKnowledgePageMutation.mutate()}
                />
              ) : (
                <OpsInspector
                  board={board}
                  jobTitle={jobTitle}
                  jobKind={jobKind}
                  onJobTitleChange={setJobTitle}
                  onJobKindChange={setJobKind}
                  onCreateJob={() => createJobMutation.mutate()}
                />
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
