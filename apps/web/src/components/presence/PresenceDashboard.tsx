import {
  BookOpenIcon,
  BotIcon,
  CheckCheckIcon,
  ClipboardListIcon,
  FolderPlusIcon,
  GitMergeIcon,
  HammerIcon,
  PlayIcon,
  RefreshCcwIcon,
  ScanSearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react";
import {
  type AttemptSummary,
  type BoardSnapshot,
  type FindingRecord,
  type RepositoryCapabilityScanRecord,
  type PresenceReviewDecisionKind,
  type PresenceTicketStatus,
  type ProposedFollowUpRecord,
  type RepositorySummary,
  type SupervisorPolicyDecision,
  type TicketRecord,
  type TicketSummaryRecord,
  type ValidationRunRecord,
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
import { buildThreadRouteParams } from "~/threadRoutes";

const STATUS_COLUMNS: readonly PresenceTicketStatus[] = [
  "todo",
  "in_progress",
  "in_review",
  "ready_to_merge",
  "blocked",
  "done",
];

const STATUS_LABELS: Record<PresenceTicketStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  ready_to_merge: "Ready to Merge",
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

function canReviewAttempt(summary: AttemptSummary): boolean {
  return Boolean(
    summary.attempt.threadId ||
      summary.attempt.provider ||
      summary.attempt.model ||
      summary.latestWorkerHandoff ||
      summary.workspace?.worktreePath ||
      summary.workspace?.branch ||
      summary.workspace?.status === "ready" ||
      summary.workspace?.status === "busy" ||
      summary.workspace?.status === "cleaned_up",
  );
}

function formatPolicyReasons(decision: SupervisorPolicyDecision | null | undefined): string {
  if (!decision || decision.reasons.length === 0) {
    return "";
  }
  return decision.reasons.join(" ");
}

function latestValidationRunsForAttempt(
  board: BoardSnapshot,
  attemptId: string | null | undefined,
): readonly ValidationRunRecord[] {
  if (!attemptId) return [];
  const runs = board.validationRuns.filter((run) => run.attemptId === attemptId);
  const latestBatchId = runs[0]?.batchId ?? null;
  return latestBatchId ? runs.filter((run) => run.batchId === latestBatchId) : [];
}

function findingBadgeVariant(finding: FindingRecord): "secondary" | "outline" | "warning" {
  if (finding.severity === "blocking") return "warning";
  if (finding.severity === "warning") return "outline";
  return "secondary";
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
          Presence turns a local repository into a board with attempts and review.
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
    <div className="rounded-lg border bg-card px-2.5 py-2">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {props.label}
      </div>
      <div className="mt-0.5 text-base font-semibold text-foreground">{props.value}</div>
    </div>
  );
}

function RepositoryRail(props: {
  repositories: readonly RepositorySummary[];
  selectedRepositoryId: string | null;
  onSelect: (repositoryId: string) => void;
}) {
  return (
    <aside className="min-h-0 overflow-hidden border-r bg-muted/10">
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b px-4 py-4">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Repositories
          </div>
          <div className="mt-2 text-sm text-muted-foreground">
            One repo, one board.
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
                  className={`w-full rounded-xl border px-2.5 py-2.5 text-left transition ${
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
  const summary = props.board.ticketSummaries.find((candidate) => candidate.ticketId === props.ticket.id);
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
            {props.ticket.description || "No description."}
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
        {summary?.openFindings.length ? (
          <Badge variant="warning">{summary.openFindings.length} finding{summary.openFindings.length === 1 ? "" : "s"}</Badge>
        ) : null}
        {latestDecision ? <span>{latestDecision.decision}</span> : null}
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
    <section className="flex h-full w-[286px] shrink-0 flex-col rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2.5">
        <div>
          <div className="text-sm font-semibold text-foreground">{STATUS_LABELS[props.status]}</div>
          <div className="text-xs text-muted-foreground">
            {props.tickets.length === 0
              ? "Empty"
              : `${props.tickets.length} ticket${props.tickets.length === 1 ? "" : "s"}`}
          </div>
        </div>
        <Badge variant="outline">{props.tickets.length}</Badge>
      </div>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-auto p-2.5">
        {props.tickets.length === 0 ? <div className="px-1 text-xs text-muted-foreground">Empty</div> : null}
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
  ticketSummary: TicketSummaryRecord | null;
  capabilityScan: RepositoryCapabilityScanRecord | null;
  primaryAttempt: AttemptSummary | null;
  mergeableAttempt: AttemptSummary | null;
  approveDecision: SupervisorPolicyDecision | null;
  mergeDecision: SupervisorPolicyDecision | null;
  validationWaiverReason: string;
  handoffDraftByAttempt: Record<string, string>;
  expandedHandoffAttemptId: string | null;
  startingAttemptId: string | null;
  runningValidationAttemptId: string | null;
  onValidationWaiverReasonChange: (value: string) => void;
  onRecordValidationWaiver: (ticketId: string, attemptId: string | null) => void;
  onChangeHandoffDraft: (attemptId: string, value: string) => void;
  onToggleHandoffEditor: (attemptId: string) => void;
  onToggleChecklistItem: (ticketId: string, itemId: string, checked: boolean) => void;
  onCreateAttempt: (ticketId: string) => void;
  onStartAttemptSession: (attemptId: string) => void;
  onRunValidation: (attemptId: string) => void;
  onResolveFinding: (findingId: string) => void;
  onDismissFinding: (findingId: string) => void;
  onCreateFollowUpProposal: (
    finding: FindingRecord,
    kind: ProposedFollowUpRecord["kind"],
  ) => void;
  onMaterializeFollowUp: (proposalId: string) => void;
  onRequestChanges: (ticketId: string, attemptId: string | null) => void;
  onAccept: (ticketId: string, attemptId: string | null) => void;
  onMerge: (ticketId: string, attemptId: string | null) => void;
  onSaveWorkerHandoff: (attemptId: string, draft: string) => void;
  onCreatePromotionCandidate: (ticketId: string, attemptId: string | null) => void;
}) {
  const attempts = props.board.attemptSummaries.filter(
    (attempt) => attempt.attempt.ticketId === props.ticket.id,
  );
  const latestDecision = props.board.reviewDecisions.find(
    (decision) => decision.ticketId === props.ticket.id,
  );
  const approvalBlocked = props.approveDecision ? !props.approveDecision.allowed : false;
  const mergeBlocked = props.mergeDecision ? !props.mergeDecision.allowed : false;
  const approvalReason = formatPolicyReasons(props.approveDecision);
  const mergeReason = formatPolicyReasons(props.mergeDecision);
  const ticketFindings = props.board.findings.filter((finding) => finding.ticketId === props.ticket.id);
  const openTicketFindings = ticketFindings.filter((finding) => finding.status === "open");
  const ticketFollowUps = props.board.proposedFollowUps.filter(
    (proposal) => proposal.parentTicketId === props.ticket.id,
  );
  const validationCommands =
    props.capabilityScan?.discoveredCommands.filter((command) => command.kind !== "dev") ?? [];
  const capabilitySummary = props.capabilityScan
    ? props.capabilityScan.hasValidationCapability
      ? "Validation path discovered"
      : "No validation path discovered"
    : "Capability scan pending";

  return (
    <div className="space-y-4">
      <DetailSection
        title={props.ticket.title}
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
                <button
                  type="button"
                  key={item.id}
                  onClick={() => props.onToggleChecklistItem(props.ticket.id, item.id, !item.checked)}
                  className="flex w-full items-center gap-3 rounded-lg border border-border/70 px-3 py-2 text-left text-sm transition hover:border-border hover:bg-muted/20"
                >
                  <div
                    className={`size-2 rounded-full ${
                      item.checked ? "bg-emerald-500" : "bg-muted-foreground/40"
                    }`}
                  />
                  <span className={item.checked ? "text-foreground" : "text-muted-foreground"}>
                    {item.label}
                  </span>
                </button>
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
              disabled={!props.primaryAttempt || !canReviewAttempt(props.primaryAttempt)}
              onClick={() =>
                props.onRequestChanges(props.ticket.id, props.primaryAttempt?.attempt.id ?? null)
              }
            >
              <ShieldCheckIcon />
              Request changes
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={
                !props.primaryAttempt ||
                validationCommands.length === 0 ||
                props.runningValidationAttemptId === props.primaryAttempt.attempt.id
              }
              onClick={() => props.onRunValidation(props.primaryAttempt?.attempt.id ?? "")}
            >
              {props.runningValidationAttemptId === props.primaryAttempt?.attempt.id ? (
                <RefreshCcwIcon className="animate-spin" />
              ) : (
                <ScanSearchIcon />
              )}
              Run validation
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!props.primaryAttempt || approvalBlocked}
              onClick={() => props.onAccept(props.ticket.id, props.primaryAttempt?.attempt.id ?? null)}
            >
              <CheckCheckIcon />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!props.mergeableAttempt || mergeBlocked}
              onClick={() => props.onMerge(props.ticket.id, props.mergeableAttempt?.attempt.id ?? null)}
            >
              <GitMergeIcon />
              Merge
            </Button>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/20 px-3 py-3">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <ScanSearchIcon className="size-4" />
              {capabilitySummary}
            </div>
            <div className="mt-2 text-xs leading-5 text-muted-foreground">
              {props.capabilityScan ? (
                props.capabilityScan.discoveredCommands.length > 0 ? (
                  <>Detected commands: {props.capabilityScan.discoveredCommands.map((command) => command.command).join(" • ")}</>
                ) : (
                  <>No runnable test, build, or lint commands were found automatically.</>
                )
              ) : (
                <>Presence is still collecting repo capability data.</>
              )}
            </div>
            {approvalReason ? (
              <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">
                {approvalReason}
              </div>
            ) : null}
            {props.approveDecision?.requiresHumanValidationWaiver ? (
              <div className="mt-3 space-y-2">
                <Textarea
                  value={props.validationWaiverReason}
                  onChange={(event) => props.onValidationWaiverReasonChange(event.target.value)}
                  rows={3}
                  placeholder="Validation waiver"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!props.validationWaiverReason.trim() || !props.primaryAttempt}
                  onClick={() =>
                    props.onRecordValidationWaiver(
                      props.ticket.id,
                      props.primaryAttempt?.attempt.id ?? null,
                    )
                  }
                >
                  <ShieldCheckIcon />
                  Record waiver
                </Button>
              </div>
            ) : null}
            {mergeReason ? (
              <div className="mt-3 text-xs leading-5 text-muted-foreground">{mergeReason}</div>
            ) : null}
            {props.primaryAttempt ? (
              <ValidationRunsSummary runs={latestValidationRunsForAttempt(props.board, props.primaryAttempt.attempt.id)} />
            ) : null}
          </div>
          {props.ticketSummary ? (
            <div className="rounded-xl border border-border/70 bg-background/70 px-3 py-3">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Ticket summary
              </div>
              <div className="mt-2 grid gap-2 text-xs leading-5 text-muted-foreground">
                <div>
                  <span className="font-medium text-foreground">Current mechanism:</span>{" "}
                  {props.ticketSummary.currentMechanism ?? "Not summarized yet."}
                </div>
                <div>
                  <span className="font-medium text-foreground">Next step:</span>{" "}
                  {props.ticketSummary.nextStep ?? "No next step recorded."}
                </div>
                <div>
                  <span className="font-medium text-foreground">Tried across attempts:</span>{" "}
                  {props.ticketSummary.triedAcrossAttempts.length > 0
                    ? props.ticketSummary.triedAcrossAttempts.join(" • ")
                    : "Nothing recorded yet."}
                </div>
                <div>
                  <span className="font-medium text-foreground">Failures carried forward:</span>{" "}
                  {props.ticketSummary.failedWhy.length > 0
                    ? props.ticketSummary.failedWhy.join(" • ")
                    : "No failed attempt summary yet."}
                </div>
              </div>
            </div>
          ) : null}
          <div className="space-y-2 rounded-xl border border-border/70 bg-background/70 px-3 py-3">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Findings
            </div>
            {openTicketFindings.length === 0 ? (
              <div className="text-xs leading-5 text-muted-foreground">
                No open findings.
              </div>
            ) : (
              openTicketFindings.map((finding) => (
                <div key={finding.id} className="rounded-lg border border-border/60 px-3 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={findingBadgeVariant(finding)}>{finding.severity}</Badge>
                    <Badge variant="outline">{finding.disposition}</Badge>
                    <Badge variant="outline">{finding.source}</Badge>
                  </div>
                  <div className="mt-2 text-sm font-medium text-foreground">{finding.summary}</div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">
                    {finding.rationale}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => props.onResolveFinding(finding.id)}>
                      Resolve finding
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => props.onDismissFinding(finding.id)}>
                      Dismiss finding
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => props.onCreateFollowUpProposal(finding, "child_ticket")}
                    >
                      Create child follow-up
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => props.onCreateFollowUpProposal(finding, "blocker_ticket")}
                    >
                      Create blocker
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="space-y-2 rounded-xl border border-border/70 bg-background/70 px-3 py-3">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Follow-up
            </div>
            {ticketFollowUps.length === 0 ? (
              <div className="text-xs leading-5 text-muted-foreground">
                No follow-up.
              </div>
            ) : (
              ticketFollowUps.map((proposal) => (
                <div key={proposal.id} className="rounded-lg border border-border/60 px-3 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{proposal.kind}</Badge>
                    <Badge variant={proposal.status === "open" ? "warning" : "secondary"}>
                      {proposal.status}
                    </Badge>
                  </div>
                  <div className="mt-2 text-sm font-medium text-foreground">{proposal.title}</div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">
                    {proposal.description || "No proposal description provided."}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {proposal.status === "open" && proposal.kind !== "request_changes" ? (
                      <Button size="sm" variant="outline" onClick={() => props.onMaterializeFollowUp(proposal.id)}>
                        {proposal.kind === "blocker_ticket" ? "Create blocker ticket" : "Create child ticket"}
                      </Button>
                    ) : null}
                    {proposal.createdTicketId ? (
                      <div className="text-xs text-muted-foreground">
                        Materialized as {proposal.createdTicketId}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </DetailSection>

      <DetailSection title="Attempts">
        <div className="space-y-3">
          {attempts.length === 0 ? (
            <div className="rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground">
              No attempts.
            </div>
          ) : null}
          {attempts.map((summary) => (
            <div key={summary.attempt.id} className="rounded-xl border border-border/70 bg-background">
              {props.board.attemptOutcomes.find((outcome) => outcome.attemptId === summary.attempt.id) ? (
                <div className="border-b bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  Outcome: {
                    props.board.attemptOutcomes.find((outcome) => outcome.attemptId === summary.attempt.id)
                      ?.summary
                  }
                </div>
              ) : null}
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
                    disabled={
                      props.startingAttemptId === summary.attempt.id ||
                      summary.attempt.status === "accepted" ||
                      summary.attempt.status === "merged" ||
                      summary.attempt.status === "rejected"
                    }
                    onClick={() => props.onStartAttemptSession(summary.attempt.id)}
                  >
                    {props.startingAttemptId === summary.attempt.id ? (
                      <RefreshCcwIcon className="animate-spin" />
                    ) : summary.attempt.threadId ? (
                      <RefreshCcwIcon />
                    ) : (
                      <PlayIcon />
                    )}
                    {props.startingAttemptId === summary.attempt.id
                      ? "Opening..."
                      : summary.attempt.threadId
                        ? "Open session"
                        : "Start session"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      props.runningValidationAttemptId === summary.attempt.id ||
                      !canReviewAttempt(summary) ||
                      validationCommands.length === 0
                    }
                    onClick={() => props.onRunValidation(summary.attempt.id)}
                  >
                    {props.runningValidationAttemptId === summary.attempt.id ? (
                      <RefreshCcwIcon className="animate-spin" />
                    ) : (
                      <ScanSearchIcon />
                    )}
                    Run validation
                  </Button>
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      Worker handoff
                    </div>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => props.onToggleHandoffEditor(summary.attempt.id)}
                    >
                      <ClipboardListIcon />
                      {props.expandedHandoffAttemptId === summary.attempt.id
                        ? "Hide override"
                        : "Edit override"}
                    </Button>
                  </div>
                  <div className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
                    {summary.latestWorkerHandoff?.completedWork[0] ? (
                      <div>
                        <span className="font-medium text-foreground">Latest:</span>{" "}
                        {summary.latestWorkerHandoff.completedWork[0]}
                      </div>
                    ) : (
                      <div>Presence records this automatically when the attempt reports back.</div>
                    )}
                    {summary.latestWorkerHandoff?.nextStep ? (
                      <div>
                        <span className="font-medium text-foreground">Next:</span>{" "}
                        {summary.latestWorkerHandoff.nextStep}
                      </div>
                    ) : null}
                  </div>
                  {props.expandedHandoffAttemptId === summary.attempt.id ? (
                    <div className="mt-3 space-y-2">
                      <Textarea
                        value={props.handoffDraftByAttempt[summary.attempt.id] ?? ""}
                        onChange={(event) =>
                          props.onChangeHandoffDraft(summary.attempt.id, event.target.value)
                        }
                        rows={4}
                        placeholder="Override the worker handoff only when Presence missed something important."
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
                        Save override
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </DetailSection>
    </div>
  );
}

function ValidationRunsSummary(props: { runs: readonly ValidationRunRecord[] }) {
  if (props.runs.length === 0) {
    return null;
  }

  const latestBatchId = props.runs[0]?.batchId ?? null;
  const latestRuns = latestBatchId
    ? props.runs.filter((run) => run.batchId === latestBatchId)
    : [];

  return (
    <div className="mt-3 rounded-lg border border-border/70 bg-background/70 px-3 py-3">
      <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
        Latest validation
      </div>
      <div className="mt-2 space-y-2">
        {latestRuns.map((run) => (
          <div key={run.id} className="rounded-lg border border-border/60 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-medium text-foreground">{run.command}</div>
              <Badge variant={run.status === "passed" ? "secondary" : "warning"}>{run.status}</Badge>
            </div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              {run.stderrSummary ?? run.stdoutSummary ?? "No output summary captured."}
            </div>
          </div>
        ))}
      </div>
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
  capabilityScan: RepositoryCapabilityScanRecord | null;
  jobTitle: string;
  jobKind: string;
  onJobTitleChange: (value: string) => void;
  onJobKindChange: (value: string) => void;
  onCreateJob: () => void;
  onRescanCapabilities: () => void;
}) {
  return (
    <div className="space-y-4">
      <DetailSection
        title="Repository capability scan"
        description="Deterministic repo understanding that the supervisor policy can rely on."
        action={
          <Button size="sm" variant="outline" onClick={props.onRescanCapabilities}>
            <ScanSearchIcon />
            Rescan
          </Button>
        }
      >
        {props.capabilityScan ? (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{props.capabilityScan.baseBranch ?? "no branch"}</Badge>
              <Badge variant={props.capabilityScan.isClean ? "secondary" : "warning"}>
                {props.capabilityScan.isClean ? "clean" : "dirty"}
              </Badge>
              <Badge
                variant={props.capabilityScan.hasValidationCapability ? "secondary" : "warning"}
              >
                {props.capabilityScan.hasValidationCapability
                  ? "validation discovered"
                  : "waiver required"}
              </Badge>
            </div>
            <div className="text-xs leading-5 text-muted-foreground">
              Ecosystems: {props.capabilityScan.ecosystems.join(", ") || "none detected"}
            </div>
            <div className="text-xs leading-5 text-muted-foreground">
              Commands:{" "}
              {props.capabilityScan.discoveredCommands.map((command) => command.command).join(" • ") ||
                "none"}
            </div>
            {props.capabilityScan.riskSignals.length > 0 ? (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-xs leading-5 text-amber-100">
                {props.capabilityScan.riskSignals.join(" ")}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground">
            No capability scan yet.
          </div>
        )}
      </DetailSection>

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
  const [goalDraft, setGoalDraft] = useState("");
  const [validationWaiverReason, setValidationWaiverReason] = useState("");
  const [handoffDraftByAttempt, setHandoffDraftByAttempt] = useState<Record<string, string>>({});
  const [expandedHandoffAttemptId, setExpandedHandoffAttemptId] = useState<string | null>(null);
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
  const latestSupervisorRun = useMemo(
    () => board?.supervisorRuns[0] ?? null,
    [board],
  );

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

  useEffect(() => {
    setValidationWaiverReason("");
  }, [selectedTicketId]);

  const selectedTicket = useMemo<TicketRecord | null>(
    () => board?.tickets.find((ticket) => ticket.id === selectedTicketId) ?? null,
    [board, selectedTicketId],
  );

  const selectedTicketAttempts = useMemo(
    () =>
      board?.attemptSummaries.filter((attempt) => attempt.attempt.ticketId === selectedTicket?.id) ?? [],
    [board, selectedTicket],
  );
  const selectedTicketSummary = useMemo<TicketSummaryRecord | null>(
    () => board?.ticketSummaries.find((summary) => summary.ticketId === selectedTicket?.id) ?? null,
    [board, selectedTicket],
  );

  const primaryAttemptSummary = useMemo(
    () => selectedTicketAttempts.find(canReviewAttempt) ?? selectedTicketAttempts[0] ?? null,
    [selectedTicketAttempts],
  );

  const mergeableAttemptSummary = useMemo(
    () =>
      selectedTicketAttempts.find(
        (summary) => summary.attempt.status === "accepted" && canReviewAttempt(summary),
      ) ?? null,
    [selectedTicketAttempts],
  );

  const capabilityScanQuery = useQuery({
    queryKey: ["presence", environmentId, "capability-scan", selectedRepository?.id ?? null],
    enabled: environmentId !== null && api !== null && selectedRepository !== null,
    queryFn: async () => {
      if (!api || !selectedRepository) return null;
      return api.presence.getRepositoryCapabilities({ repositoryId: selectedRepository.id as never });
    },
  });

  const approveDecisionQuery = useQuery({
    queryKey: [
      "presence",
      environmentId,
      "policy",
      "approve",
      selectedTicket?.id ?? null,
      primaryAttemptSummary?.attempt.id ?? null,
      board?.validationWaivers.length ?? 0,
      board?.capabilityScan?.scannedAt ?? capabilityScanQuery.data?.scannedAt ?? null,
    ],
    enabled:
      environmentId !== null &&
      api !== null &&
      selectedTicket !== null &&
      primaryAttemptSummary !== null,
    queryFn: async () => {
      if (!api || !selectedTicket || !primaryAttemptSummary) return null;
      return api.presence.evaluateSupervisorAction({
        action: "approve_attempt",
        ticketId: selectedTicket.id as never,
        attemptId: primaryAttemptSummary.attempt.id as never,
      });
    },
  });

  const mergeDecisionQuery = useQuery({
    queryKey: [
      "presence",
      environmentId,
      "policy",
      "merge",
      selectedTicket?.id ?? null,
      mergeableAttemptSummary?.attempt.id ?? null,
      board?.validationWaivers.length ?? 0,
      board?.capabilityScan?.scannedAt ?? capabilityScanQuery.data?.scannedAt ?? null,
    ],
    enabled:
      environmentId !== null &&
      api !== null &&
      selectedTicket !== null &&
      mergeableAttemptSummary !== null,
    queryFn: async () => {
      if (!api || !selectedTicket || !mergeableAttemptSummary) return null;
      return api.presence.evaluateSupervisorAction({
        action: "merge_attempt",
        ticketId: selectedTicket.id as never,
        attemptId: mergeableAttemptSummary.attempt.id as never,
      });
    },
  });

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
    await queryClient.invalidateQueries({
      queryKey: ["presence", environmentId, "policy"],
    });
    await queryClient.invalidateQueries({
      queryKey: ["presence", environmentId, "capability-scan"],
    });
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

  const updateTicketMutation = useMutation({
    mutationFn: async (input: {
      ticketId: string;
      acceptanceChecklist: TicketRecord["acceptanceChecklist"];
    }) => {
      if (!api) throw new Error("Primary environment is unavailable.");
      return api.presence.updateTicket({
        ticketId: input.ticketId as never,
        acceptanceChecklist: input.acceptanceChecklist,
      });
    },
    onSuccess: async () => {
      await invalidatePresence(selectedRepository?.boardId);
    },
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: "Checklist update failed",
        description:
          error instanceof Error ? error.message : "Presence could not update the checklist.",
      }),
  });

  const submitGoalIntakeMutation = useMutation({
    mutationFn: async () => {
      if (!api || !selectedRepository || !goalDraft.trim()) {
        throw new Error("Select a repository and describe the repo-level goal first.");
      }
      return api.presence.submitGoalIntake({
        boardId: selectedRepository.boardId,
        rawGoal: goalDraft.trim(),
        source: "human_goal",
        priorityHint: "p2",
      });
    },
    onSuccess: async (result) => {
      setGoalDraft("");
      setInspectorMode("ticket");
      setSelectedTicketId(result.createdTickets[0]?.id ?? null);
      await invalidatePresence(selectedRepository?.boardId);
      toastManager.add({
        type: "success",
        title: "Goal ingested",
        description: result.intake.summary,
      });
    },
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: "Goal intake failed",
        description: error instanceof Error ? error.message : "Presence could not create tickets from the goal.",
      }),
  });

  const startSupervisorRunMutation = useMutation({
    mutationFn: async () => {
      if (!api || !selectedRepository) {
        throw new Error("Select a repository first.");
      }
      return api.presence.startSupervisorRun({
        boardId: selectedRepository.boardId,
      });
    },
    onSuccess: async () => {
      await invalidatePresence(selectedRepository?.boardId);
      toastManager.add({
        type: "success",
        title: "Supervisor started",
        description: "Presence is now driving the current board loop in the background.",
      });
    },
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: "Supervisor could not start",
        description:
          error instanceof Error ? error.message : "Presence could not start the supervisor runtime.",
      }),
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
      if (!environmentId) return;
      toastManager.add({
        type: "success",
        title: "Session opened",
        description: "The attempt thread is ready.",
      });
      await navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams({
          environmentId,
          threadId: session.threadId,
        }),
      });
      void invalidatePresence(selectedRepository?.boardId);
    },
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: "Could not start session",
        description: error instanceof Error ? error.message : "Unable to open the attempt session.",
      }),
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
            ? "Accepted against the current ticket checklist and moved to merge-ready."
            : input.decision === "merge_approved"
              ? "Merged into the repository base branch and cleaned up the attempt workspace."
              : "Supervisor requested another iteration.",
      });
    },
    onSuccess: async () => {
      await invalidatePresence(selectedRepository?.boardId);
    },
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: "Review action failed",
        description: error instanceof Error ? error.message : "Presence could not apply the review decision.",
      }),
  });

  const runAttemptValidationMutation = useMutation({
    mutationFn: async (attemptId: string) => {
      if (!api) throw new Error("Primary environment is unavailable.");
      return api.presence.runAttemptValidation({ attemptId: attemptId as never });
    },
    onSuccess: async (runs) => {
      await invalidatePresence(selectedRepository?.boardId);
      const failed = runs.filter((run) => run.status === "failed").length;
      toastManager.add({
        type: failed === 0 ? "success" : "warning",
        title: failed === 0 ? "Validation passed" : "Validation recorded",
        description:
          failed === 0
            ? `${runs.length} command${runs.length === 1 ? "" : "s"} passed in the attempt workspace.`
            : `${failed} of ${runs.length} validation command${runs.length === 1 ? "" : "s"} failed.`,
      });
    },
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: "Validation failed to start",
        description:
          error instanceof Error ? error.message : "Presence could not run validation.",
      }),
  });

  const recordValidationWaiverMutation = useMutation({
    mutationFn: async (input: { ticketId: string; attemptId: string | null }) => {
      if (!api || !validationWaiverReason.trim()) {
        throw new Error("Provide a reason for the human validation waiver first.");
      }
      return api.presence.recordValidationWaiver({
        ticketId: input.ticketId as never,
        attemptId: input.attemptId as never,
        reason: validationWaiverReason.trim(),
        grantedBy: "human",
      });
    },
    onSuccess: async () => {
      setValidationWaiverReason("");
      await invalidatePresence(selectedRepository?.boardId);
      toastManager.add({
        type: "success",
        title: "Validation waiver recorded",
        description: "Presence can now re-evaluate approval for this attempt.",
      });
    },
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: "Waiver could not be recorded",
        description: error instanceof Error ? error.message : "Presence could not store the human waiver.",
      }),
  });

  const resolveFindingMutation = useMutation({
    mutationFn: async (findingId: string) => {
      if (!api) throw new Error("Primary environment is unavailable.");
      return api.presence.resolveFinding({ findingId: findingId as never });
    },
    onSuccess: async () => {
      await invalidatePresence(selectedRepository?.boardId);
    },
  });

  const dismissFindingMutation = useMutation({
    mutationFn: async (findingId: string) => {
      if (!api) throw new Error("Primary environment is unavailable.");
      return api.presence.dismissFinding({ findingId: findingId as never });
    },
    onSuccess: async () => {
      await invalidatePresence(selectedRepository?.boardId);
    },
  });

  const createFollowUpProposalMutation = useMutation({
    mutationFn: async (input: {
      parentTicketId: string;
      originatingAttemptId: string | null;
      kind: ProposedFollowUpRecord["kind"];
      title: string;
      description: string;
      findingIds: readonly string[];
    }) => {
      if (!api) throw new Error("Primary environment is unavailable.");
      return api.presence.createFollowUpProposal({
        parentTicketId: input.parentTicketId as never,
        originatingAttemptId: input.originatingAttemptId as never,
        kind: input.kind,
        title: input.title,
        description: input.description,
        priority: input.kind === "blocker_ticket" ? "p1" : "p2",
        findingIds: [...input.findingIds] as never,
      });
    },
    onSuccess: async () => {
      await invalidatePresence(selectedRepository?.boardId);
    },
  });

  const materializeFollowUpMutation = useMutation({
    mutationFn: async (proposalId: string) => {
      if (!api) throw new Error("Primary environment is unavailable.");
      return api.presence.materializeFollowUp({ proposalId: proposalId as never });
    },
    onSuccess: async (ticket) => {
      setSelectedTicketId(ticket.id);
      await invalidatePresence(selectedRepository?.boardId);
    },
  });

  const scanCapabilitiesMutation = useMutation({
    mutationFn: async () => {
      if (!api || !selectedRepository) {
        throw new Error("Select a repository first.");
      }
      return api.presence.scanRepositoryCapabilities({
        repositoryId: selectedRepository.id as never,
      });
    },
    onSuccess: async () => {
      await invalidatePresence(selectedRepository?.boardId);
      await capabilityScanQuery.refetch();
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
      setExpandedHandoffAttemptId((current) =>
        current === variables.attemptId ? null : current,
      );
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
      <header className="border-b px-4 py-3 pr-32">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Presence v1
            </div>
            <div className="mt-1 text-xl font-semibold tracking-tight">
              Supervisor-managed repo organization
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
            {selectedRepository ? (
              <Button variant="outline" onClick={() => scanCapabilitiesMutation.mutate()}>
                <ScanSearchIcon />
                Rescan repo
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[188px_minmax(0,1fr)_332px]">
        <RepositoryRail
          repositories={repositories}
          selectedRepositoryId={selectedRepositoryId}
          onSelect={(repositoryId) => {
            setSelectedRepositoryId(repositoryId);
            setInspectorMode("ticket");
          }}
        />

        <main className="min-h-0 overflow-hidden border-t xl:border-t-0">
          {board ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-foreground">{board.board.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {board.repository.workspaceRoot}
                      {board.board.sprintFocus ? ` · ${board.board.sprintFocus}` : ""}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="outline">
                        {(capabilityScanQuery.data ?? board.capabilityScan)?.baseBranch ?? "no branch"}
                      </Badge>
                      <Badge
                        variant={
                          (capabilityScanQuery.data ?? board.capabilityScan)?.hasValidationCapability
                            ? "secondary"
                            : "warning"
                        }
                      >
                        {(capabilityScanQuery.data ?? board.capabilityScan)?.hasValidationCapability
                          ? "validation discovered"
                          : "validation needs waiver"}
                      </Badge>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <MetricPill label="Tickets" value={board.tickets.length} />
                    <MetricPill label="Attempts" value={board.attempts.length} />
                    <MetricPill label="Knowledge" value={board.knowledgePages.length} />
                    <MetricPill label="Jobs" value={board.jobs.length} />
                  </div>
                </div>

                <div className="mt-3 rounded-xl border bg-card px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Input
                      value={goalDraft}
                      onChange={(event) => setGoalDraft(event.target.value)}
                      placeholder="Tell Presence what you want done in this repo."
                      className="flex-1"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={Boolean(latestSupervisorRun && latestSupervisorRun.status === "running")}
                      onClick={() => startSupervisorRunMutation.mutate()}
                    >
                      <BotIcon />
                      Run supervisor
                    </Button>
                    <Button
                      size="sm"
                      disabled={!goalDraft.trim()}
                      onClick={() => submitGoalIntakeMutation.mutate()}
                    >
                      <SparklesIcon />
                      Submit goal
                    </Button>
                  </div>
                  {latestSupervisorRun ? (
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <Badge variant="outline">{latestSupervisorRun.status}</Badge>
                      <span className="uppercase tracking-[0.14em]">{latestSupervisorRun.stage}</span>
                      <span className="truncate">{latestSupervisorRun.summary}</span>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
                <div className="flex min-h-full gap-2.5 overflow-x-auto pb-2">
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

        <aside className="min-h-0 overflow-hidden border-l bg-muted/10">
          <div className="flex h-full min-h-0 flex-col">
            <div className="border-b px-4 py-4">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Ticket
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
              {!board ? (
                <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                  Pick a repository.
                </div>
              ) : (
                selectedTicket ? (
                  <AttemptInspector
                    board={board}
                    ticket={selectedTicket}
                    ticketSummary={selectedTicketSummary}
                    capabilityScan={capabilityScanQuery.data ?? board.capabilityScan}
                    primaryAttempt={primaryAttemptSummary}
                    mergeableAttempt={mergeableAttemptSummary}
                    approveDecision={approveDecisionQuery.data ?? null}
                    mergeDecision={mergeDecisionQuery.data ?? null}
                    validationWaiverReason={validationWaiverReason}
                    handoffDraftByAttempt={handoffDraftByAttempt}
                    expandedHandoffAttemptId={expandedHandoffAttemptId}
                    startingAttemptId={startAttemptSessionMutation.variables ?? null}
                    runningValidationAttemptId={runAttemptValidationMutation.variables ?? null}
                    onValidationWaiverReasonChange={setValidationWaiverReason}
                    onRecordValidationWaiver={(ticketId, attemptId) =>
                      recordValidationWaiverMutation.mutate({ ticketId, attemptId })
                    }
                    onChangeHandoffDraft={handleChangeHandoffDraft}
                    onToggleHandoffEditor={(attemptId) =>
                      setExpandedHandoffAttemptId((current) =>
                        current === attemptId ? null : attemptId,
                      )
                    }
                    onToggleChecklistItem={(ticketId, itemId, checked) => {
                      const ticket = board.tickets.find((candidate) => candidate.id === ticketId);
                      if (!ticket) return;
                      updateTicketMutation.mutate({
                        ticketId,
                        acceptanceChecklist: ticket.acceptanceChecklist.map((item) =>
                          item.id === itemId ? { ...item, checked } : item,
                        ),
                      });
                    }}
                    onCreateAttempt={(ticketId) => createAttemptMutation.mutate(ticketId)}
                    onStartAttemptSession={(attemptId) =>
                      startAttemptSessionMutation.mutate(attemptId)
                    }
                    onRunValidation={(attemptId) => runAttemptValidationMutation.mutate(attemptId)}
                    onResolveFinding={(findingId) => resolveFindingMutation.mutate(findingId)}
                    onDismissFinding={(findingId) => dismissFindingMutation.mutate(findingId)}
                    onCreateFollowUpProposal={(finding, kind) =>
                      createFollowUpProposalMutation.mutate({
                        parentTicketId: selectedTicket.id,
                        originatingAttemptId: finding.attemptId ?? null,
                        kind,
                        title:
                          kind === "blocker_ticket"
                            ? `Blocker: ${finding.summary}`
                            : `Follow-up: ${finding.summary}`,
                        description: `${finding.summary}\n\n${finding.rationale}`,
                        findingIds: [finding.id],
                      })
                    }
                    onMaterializeFollowUp={(proposalId) =>
                      materializeFollowUpMutation.mutate(proposalId)
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
                    onMerge={(ticketId, attemptId) =>
                      submitReviewDecisionMutation.mutate({
                        ticketId,
                        attemptId,
                        decision: "merge_approved",
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
                    Select a ticket.
                  </div>
                )
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
