import {
  AlertCircleIcon,
  BookOpenIcon,
  BotIcon,
  CheckCheckIcon,
  ChevronDownIcon,
  ClipboardListIcon,
  FolderPlusIcon,
  GitMergeIcon,
  HammerIcon,
  PlayIcon,
  RefreshCcwIcon,
  ScanSearchIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WrenchIcon,
} from "lucide-react";
import {
  type AttemptSummary,
  type BoardSnapshot,
  type FindingRecord,
  type PresenceTicketStatus,
  type ProjectionHealthRecord,
  type ProposedFollowUpRecord,
  type RepositoryCapabilityScanRecord,
  type RepositorySummary,
  type SupervisorPolicyDecision,
  type TicketRecord,
  type TicketSummaryRecord,
  type ValidationRunRecord,
} from "@t3tools/contracts";
import { useMemo, useState, type ReactNode } from "react";

import {
  buildTicketTimeline,
  canReviewAttempt,
  deriveLatestMeaningfulEvent,
  deriveTicketCallout,
  deriveTicketPrimaryAction,
  deriveTicketReasonLine,
  deriveTicketStage,
  formatPolicyReasons,
  latestValidationRunsForAttempt,
  STATUS_COLUMNS,
  STATUS_HINTS,
  STATUS_LABELS,
  type PresenceTicketCalloutViewModel,
  type PresenceTicketPrimaryActionViewModel,
  type PresenceTicketStageTone,
} from "./PresencePresentation";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import { Input } from "../ui/input";
import { Separator } from "../ui/separator";
import { Textarea } from "../ui/textarea";
import { cn } from "~/lib/utils";

const PRIORITY_VARIANTS = {
  p0: "destructive",
  p1: "warning",
  p2: "info",
  p3: "secondary",
} as const;

function projectionHealthBadgeVariant(
  health: ProjectionHealthRecord | null | undefined,
): "secondary" | "warning" | "outline" {
  if (!health) return "outline";
  if (health.status === "stale") return "warning";
  if (health.status === "repairing") return "secondary";
  return "outline";
}

function projectionHealthLabel(health: ProjectionHealthRecord | null | undefined): string {
  if (!health) return "Projection healthy";
  if (health.status === "stale") return "Projection stale";
  if (health.status === "repairing") return "Retrying projection";
  return "Projection healthy";
}

export function ProjectionHealthIndicator(props: {
  health: ProjectionHealthRecord | null | undefined;
  className?: string;
}) {
  if (!props.health || props.health.status === "healthy") {
    return null;
  }

  return (
    <div className={props.className ?? "mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground"}>
      <Badge variant={projectionHealthBadgeVariant(props.health)}>
        {projectionHealthLabel(props.health)}
      </Badge>
      {props.health.lastErrorMessage ? (
        <span className="truncate">{props.health.lastErrorMessage}</span>
      ) : null}
      {props.health.lastSucceededAt ? (
        <span>Last good sync {formatTimestamp(props.health.lastSucceededAt)}</span>
      ) : null}
    </div>
  );
}

export function PresenceEmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center rounded-[28px] border border-dashed border-border/70 bg-card/60 p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
          <BotIcon className="size-7" />
        </div>
        <div className="mt-5 text-2xl font-semibold tracking-tight text-foreground">
          Import a repository to start Presence.
        </div>
        <div className="mt-3 text-sm leading-6 text-muted-foreground">
          Presence turns a local repository into a guided board with attempts, review, and durable repo memory.
        </div>
        <div className="mt-6">
          <Button onClick={onImport}>
            <FolderPlusIcon />
            Import repository
          </Button>
        </div>
      </div>
    </div>
  );
}

function DetailSection(props: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-border/70 bg-card/90 shadow-sm", props.className)}>
      <div className="flex items-start justify-between gap-3 px-4 py-4">
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

export function MetricPill(props: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/90 px-3 py-2.5 shadow-sm">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {props.label}
      </div>
      <div className="mt-0.5 text-base font-semibold text-foreground">{props.value}</div>
    </div>
  );
}

export function RepositoryRail(props: {
  repositories: readonly RepositorySummary[];
  selectedRepositoryId: string | null;
  onSelect: (repositoryId: string) => void;
}) {
  return (
    <aside className="min-h-0 overflow-hidden border-r border-border/70 bg-gradient-to-b from-muted/30 to-background/80">
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-border/70 px-4 py-4">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Repositories
          </div>
          <div className="mt-2 text-sm text-muted-foreground">
            One repo, one guided cockpit.
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
                  className={cn(
                    "w-full rounded-2xl border px-3 py-3 text-left transition",
                    selected
                      ? "border-primary/50 bg-primary/8 shadow-sm"
                      : "border-transparent bg-background/70 hover:border-border hover:bg-card",
                  )}
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

function stageToneClasses(tone: PresenceTicketStageTone): string {
  switch (tone) {
    case "success":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
    case "warning":
      return "border-amber-500/30 bg-amber-500/10 text-amber-100";
    case "info":
      return "border-sky-500/30 bg-sky-500/10 text-sky-100";
    default:
      return "border-border/80 bg-background text-foreground";
  }
}

function calloutVariant(
  severity: PresenceTicketCalloutViewModel["severity"],
): "info" | "warning" | "error" | "success" {
  switch (severity) {
    case "error":
      return "error";
    case "warning":
      return "warning";
    case "success":
      return "success";
    default:
      return "info";
  }
}

function calloutIcon(severity: PresenceTicketCalloutViewModel["severity"]) {
  switch (severity) {
    case "error":
      return <ShieldAlertIcon className="size-4" />;
    case "warning":
      return <AlertCircleIcon className="size-4" />;
    case "success":
      return <CheckCheckIcon className="size-4" />;
    default:
      return <BotIcon className="size-4" />;
  }
}

function formatTimestamp(timestamp: string): string {
  const parsed = new Date(timestamp);
  const date = parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const time = parsed.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} ${time}`;
}

function formatRelativeTimestamp(timestamp: string): string {
  const delta = Date.now() - Date.parse(timestamp);
  const minutes = Math.max(1, Math.round(delta / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function TicketDigestCard(props: {
  label: string;
  value: string;
  detail: string;
  tone?: PresenceTicketStageTone;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 p-3">
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        {props.label}
      </div>
      <div className={cn("mt-2 text-sm font-semibold", props.tone === "warning" ? "text-amber-100" : "text-foreground")}>
        {props.value}
      </div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">{props.detail}</div>
    </div>
  );
}

function EvidenceCard(props: {
  title: string;
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-2xl border border-border/70 bg-background/70">
        <button
          type="button"
          className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left"
          onClick={() => setOpen((current) => !current)}
        >
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">{props.title}</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">{props.summary}</div>
          </div>
          <ChevronDownIcon
            className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          />
        </button>
        <CollapsibleContent>
          <Separator />
          <div className="px-4 py-4">{props.children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function PresenceStatusCallout(props: {
  callout: PresenceTicketCalloutViewModel;
  className?: string;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <Alert className={props.className} variant={calloutVariant(props.callout.severity)}>
      {calloutIcon(props.callout.severity)}
      <AlertTitle>{props.callout.title}</AlertTitle>
      <AlertDescription>
        <div className="space-y-3">
          <div>{props.callout.summary}</div>
          <div className="rounded-xl border border-border/70 bg-background/55 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Presence recommendation
            </div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {props.callout.recommendedAction}
            </div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              {props.callout.retryBehavior}
            </div>
          </div>
          {props.callout.details ? (
            <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
              <button
                type="button"
                className="text-xs font-medium text-foreground underline decoration-border underline-offset-4"
                onClick={() => setDetailsOpen((open) => !open)}
              >
                {detailsOpen ? "Hide technical details" : "Show technical details"}
              </button>
              <CollapsibleContent>
                <div className="mt-2 rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-xs leading-5">
                  {props.callout.details}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </div>
      </AlertDescription>
    </Alert>
  );
}

function TicketStatusCard(props: {
  ticket: TicketRecord;
  board: BoardSnapshot;
  capabilityScan: RepositoryCapabilityScanRecord | null | undefined;
  selected: boolean;
  ticketProjectionHealth: ProjectionHealthRecord | null;
  onSelect: () => void;
}) {
  const attempts = props.board.attemptSummaries.filter(
    (attempt) => attempt.attempt.ticketId === props.ticket.id,
  );
  const stage = deriveTicketStage(props.board, props.ticket, {
    capabilityScan: props.capabilityScan ?? null,
    ticketProjectionHealth: props.ticketProjectionHealth,
  });
  const reasonLine = deriveTicketReasonLine(props.board, props.ticket, {
    capabilityScan: props.capabilityScan ?? null,
    ticketProjectionHealth: props.ticketProjectionHealth,
  });
  const latestEvent = deriveLatestMeaningfulEvent(props.board, props.ticket);
  const primaryAction = deriveTicketPrimaryAction(
    props.board,
    props.ticket,
    attempts.find(canReviewAttempt) ?? attempts[0] ?? null,
    props.capabilityScan ?? null,
  );
  const summary = props.board.ticketSummaries.find((candidate) => candidate.ticketId === props.ticket.id);

  return (
    <button
      type="button"
      onClick={props.onSelect}
      className={cn(
        "w-full rounded-2xl border px-3 py-3 text-left transition",
        props.selected
          ? "border-primary/50 bg-primary/8 shadow-sm"
          : "border-border/70 bg-background/80 hover:border-border hover:bg-card",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{props.ticket.title}</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">{reasonLine}</div>
        </div>
        <Badge variant={PRIORITY_VARIANTS[props.ticket.priority]}>
          {props.ticket.priority.toUpperCase()}
        </Badge>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <span
          className={cn(
            "rounded-full border px-2.5 py-1 text-[11px] font-medium",
            stageToneClasses(stage.tone),
          )}
        >
          {stage.label}
        </span>
        {latestEvent ? (
          <span className="text-[11px] text-muted-foreground">
            {formatRelativeTimestamp(latestEvent.timestamp)}
          </span>
        ) : null}
      </div>

      <div className="mt-3 rounded-2xl border border-border/70 bg-background/50 px-3 py-3">
        <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          Presence is handling
        </div>
        <div className="mt-1 text-sm font-medium text-foreground">{stage.waitingOn}</div>
      </div>

      {latestEvent ? (
        <div className="mt-3 rounded-xl border border-border/70 bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
          <div className="uppercase tracking-[0.16em]">Latest update</div>
          <div className="min-w-0">
            <div className="mt-1 truncate font-medium text-foreground">{latestEvent.label}</div>
            <div className="truncate">{latestEvent.title}</div>
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {summary?.openFindings.length ? (
          <Badge variant="warning">
            {summary.openFindings.length} open finding{summary.openFindings.length === 1 ? "" : "s"}
          </Badge>
        ) : null}
        {attempts.length > 1 ? (
          <Badge variant="outline">
            {attempts.length} attempts
          </Badge>
        ) : null}
        {props.ticketProjectionHealth && props.ticketProjectionHealth.status !== "healthy" ? (
          <Badge variant={projectionHealthBadgeVariant(props.ticketProjectionHealth)}>
            projection warning
          </Badge>
        ) : null}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/60 pt-3">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {stage.bucket === "Needs human decision" || stage.bucket === "Blocked"
            ? "Needs you"
            : "Next if needed"}
        </div>
        <div className="rounded-full border border-border/70 px-2.5 py-1 text-xs font-medium text-foreground">
          {cardPrimaryLabel(primaryAction)}
        </div>
      </div>
    </button>
  );
}

function cardPrimaryLabel(action: PresenceTicketPrimaryActionViewModel): string {
  switch (action.kind) {
    case "review_result":
      return "Review";
    case "resolve_blocker":
      return "Resolve blocker";
    case "open_ticket":
      return "Open ticket";
    default:
      return action.label;
  }
}

export function BoardColumn(props: {
  status: PresenceTicketStatus;
  tickets: readonly TicketRecord[];
  board: BoardSnapshot;
  capabilityScan: RepositoryCapabilityScanRecord | null | undefined;
  selectedTicketId: string | null;
  onSelectTicket: (ticketId: string) => void;
}) {
  return (
    <section className="flex h-full w-[320px] shrink-0 flex-col rounded-[28px] border border-border/70 bg-card/90 shadow-sm">
      <div className="border-b border-border/70 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">{STATUS_LABELS[props.status]}</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              {STATUS_HINTS[props.status]}
            </div>
          </div>
          <Badge variant="outline">{props.tickets.length}</Badge>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {props.tickets.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground">
            No tickets here yet.
          </div>
        ) : null}
        {props.tickets.map((ticket) => (
          <TicketStatusCard
            key={ticket.id}
            ticket={ticket}
            board={props.board}
            capabilityScan={props.capabilityScan}
            ticketProjectionHealth={
              props.board.ticketProjectionHealth.find((health) => health.scopeId === ticket.id) ?? null
            }
            selected={ticket.id === props.selectedTicketId}
            onSelect={() => props.onSelectTicket(ticket.id)}
          />
        ))}
      </div>
    </section>
  );
}

function renderPrimaryActionButtons(props: {
  action: PresenceTicketPrimaryActionViewModel;
  primaryAttempt: AttemptSummary | null;
  mergeableAttempt: AttemptSummary | null;
  runningValidationAttemptId: string | null;
  startingAttemptId: string | null;
  onCreateAttempt: (ticketId: string) => void;
  onStartAttemptSession: (attemptId: string) => void;
  onRunValidation: (attemptId: string) => void;
  onAccept: (ticketId: string, attemptId: string | null) => void;
  onRequestChanges: (ticketId: string, attemptId: string | null) => void;
  onMerge: (ticketId: string, attemptId: string | null) => void;
  onRevealBlocker: () => void;
  ticketId: string;
}) {
  switch (props.action.kind) {
    case "create_attempt":
      return (
        <Button onClick={() => props.onCreateAttempt(props.ticketId)}>
          <HammerIcon />
          Create attempt
        </Button>
      );
    case "start_work":
      return (
        <Button
          disabled={!props.primaryAttempt || props.startingAttemptId === props.primaryAttempt.attempt.id}
          onClick={() => props.primaryAttempt && props.onStartAttemptSession(props.primaryAttempt.attempt.id)}
        >
          {props.startingAttemptId === props.primaryAttempt?.attempt.id ? (
            <RefreshCcwIcon className="animate-spin" />
          ) : (
            <PlayIcon />
          )}
          {props.startingAttemptId === props.primaryAttempt?.attempt.id ? "Opening..." : "Start work"}
        </Button>
      );
    case "run_validation":
      return (
        <Button
          disabled={!props.primaryAttempt || props.runningValidationAttemptId === props.primaryAttempt.attempt.id}
          onClick={() => props.primaryAttempt && props.onRunValidation(props.primaryAttempt.attempt.id)}
        >
          {props.runningValidationAttemptId === props.primaryAttempt?.attempt.id ? (
            <RefreshCcwIcon className="animate-spin" />
          ) : (
            <ScanSearchIcon />
          )}
          Run validation
        </Button>
      );
    case "review_result":
      return (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!props.primaryAttempt}
            onClick={() => props.onAccept(props.ticketId, props.primaryAttempt?.attempt.id ?? null)}
          >
            <CheckCheckIcon />
            Accept
          </Button>
          <Button
            variant="outline"
            disabled={!props.primaryAttempt}
            onClick={() => props.onRequestChanges(props.ticketId, props.primaryAttempt?.attempt.id ?? null)}
          >
            <ShieldCheckIcon />
            Request changes
          </Button>
        </div>
      );
    case "merge":
      return (
        <Button
          disabled={!props.mergeableAttempt}
          onClick={() => props.onMerge(props.ticketId, props.mergeableAttempt?.attempt.id ?? null)}
        >
          <GitMergeIcon />
          Merge
        </Button>
      );
    case "request_changes":
      return (
        <Button
          variant="outline"
          disabled={!props.primaryAttempt}
          onClick={() => props.onRequestChanges(props.ticketId, props.primaryAttempt?.attempt.id ?? null)}
        >
          <ShieldCheckIcon />
          Request changes
        </Button>
      );
    case "resolve_blocker":
      return (
        <Button variant="outline" onClick={props.onRevealBlocker}>
          <ShieldAlertIcon />
          Resolve blocker
        </Button>
      );
    default:
      return (
        <Button variant="outline" onClick={props.onRevealBlocker}>
          <ClipboardListIcon />
          Open ticket
        </Button>
      );
  }
}

export function TicketWorkspace(props: {
  board: BoardSnapshot;
  ticket: TicketRecord;
  ticketSummary: TicketSummaryRecord | null;
  ticketProjectionHealth: ProjectionHealthRecord | null;
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const attempts = useMemo(
    () => props.board.attemptSummaries.filter((attempt) => attempt.attempt.ticketId === props.ticket.id),
    [props.board.attemptSummaries, props.ticket.id],
  );
  const openTicketFindings = useMemo(
    () =>
      props.board.findings.filter(
        (finding) => finding.ticketId === props.ticket.id && finding.status === "open",
      ),
    [props.board.findings, props.ticket.id],
  );
  const ticketFollowUps = useMemo(
    () =>
      props.board.proposedFollowUps.filter((proposal) => proposal.parentTicketId === props.ticket.id),
    [props.board.proposedFollowUps, props.ticket.id],
  );
  const latestReview = useMemo(
    () =>
      props.board.reviewArtifacts
        .filter((artifact) => artifact.ticketId === props.ticket.id)
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0] ?? null,
    [props.board.reviewArtifacts, props.ticket.id],
  );
  const latestMerge = useMemo(
    () =>
      props.board.mergeOperations
        .filter((operation) => operation.ticketId === props.ticket.id)
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0] ?? null,
    [props.board.mergeOperations, props.ticket.id],
  );
  const stage = deriveTicketStage(props.board, props.ticket, {
    primaryAttempt: props.primaryAttempt,
    ticketSummary: props.ticketSummary,
    capabilityScan: props.capabilityScan,
    ticketProjectionHealth: props.ticketProjectionHealth,
    approveDecision: props.approveDecision,
    mergeDecision: props.mergeDecision,
  });
  const primaryAction = deriveTicketPrimaryAction(
    props.board,
    props.ticket,
    props.primaryAttempt,
    props.capabilityScan,
  );
  const reasonLine = deriveTicketReasonLine(props.board, props.ticket, {
    primaryAttempt: props.primaryAttempt,
    ticketSummary: props.ticketSummary,
    capabilityScan: props.capabilityScan,
    ticketProjectionHealth: props.ticketProjectionHealth,
    approveDecision: props.approveDecision,
    mergeDecision: props.mergeDecision,
  });
  const latestEvent = deriveLatestMeaningfulEvent(props.board, props.ticket);
  const callout = deriveTicketCallout(props.board, props.ticket, {
    primaryAttempt: props.primaryAttempt,
    ticketSummary: props.ticketSummary,
    capabilityScan: props.capabilityScan,
    ticketProjectionHealth: props.ticketProjectionHealth,
    approveDecision: props.approveDecision,
    mergeDecision: props.mergeDecision,
  });
  const timeline = buildTicketTimeline(props.board, props.ticket);
  const validationRuns = latestValidationRunsForAttempt(
    props.board,
    props.primaryAttempt?.attempt.id ?? null,
  );
  const validationCommands =
    props.capabilityScan?.discoveredCommands.filter((command) => command.kind !== "dev") ?? [];
  const approvalReason = formatPolicyReasons(props.approveDecision);
  const mergeReason = formatPolicyReasons(props.mergeDecision);
  const capabilitySummary = props.capabilityScan
    ? props.capabilityScan.hasValidationCapability
      ? "Validation path discovered"
      : "No validation path discovered"
    : "Capability scan pending";
  const needsHuman =
    stage.bucket === "Needs human decision" || stage.bucket === "Blocked";
  const briefingLine = needsHuman
    ? "Presence needs your direction before this ticket can move."
    : "Presence can keep this ticket moving without you for now.";

  return (
    <div className="space-y-4">
      <section className="rounded-[28px] border border-border/70 bg-background/95 p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={PRIORITY_VARIANTS[props.ticket.priority]}>
            {props.ticket.priority.toUpperCase()}
          </Badge>
          <Badge variant="outline">{STATUS_LABELS[props.ticket.status]}</Badge>
          <span
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium",
              stageToneClasses(stage.tone),
            )}
          >
            {stage.label}
          </span>
        </div>

        <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Presence briefing
        </div>
        <div className="mt-2 text-xl font-semibold tracking-tight text-foreground">
          {props.ticket.title}
        </div>
        <div className="mt-2 text-sm leading-6 text-muted-foreground">{briefingLine}</div>

        <div className="mt-4 grid gap-3">
          <div className="rounded-2xl border border-border/70 bg-card/70 px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Current state
            </div>
            <div className="mt-1 text-base font-semibold text-foreground">{stage.label}</div>
            <div className="mt-1 text-sm leading-6 text-muted-foreground">{reasonLine}</div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-border/70 bg-card/60 px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Presence is waiting on
              </div>
              <div className="mt-1 text-sm font-medium text-foreground">{stage.waitingOn}</div>
            </div>
            <div className="rounded-2xl border border-border/70 bg-card/60 px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Latest meaningful update
              </div>
              <div className="mt-1 text-sm font-medium text-foreground">
                {latestEvent?.label ?? "No recent event yet"}
              </div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                {latestEvent
                  ? `${latestEvent.title} · ${formatTimestamp(latestEvent.timestamp)}`
                  : "Presence has not recorded a timeline update for this ticket yet."}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {renderPrimaryActionButtons({
            action: primaryAction,
            primaryAttempt: props.primaryAttempt,
            mergeableAttempt: props.mergeableAttempt,
            runningValidationAttemptId: props.runningValidationAttemptId,
            startingAttemptId: props.startingAttemptId,
            onCreateAttempt: props.onCreateAttempt,
            onStartAttemptSession: props.onStartAttemptSession,
            onRunValidation: props.onRunValidation,
            onAccept: props.onAccept,
            onRequestChanges: props.onRequestChanges,
            onMerge: props.onMerge,
            onRevealBlocker: () => setAdvancedOpen(true),
            ticketId: props.ticket.id,
          })}
          <Collapsible open={moreActionsOpen} onOpenChange={setMoreActionsOpen}>
            <Button variant="outline" size="sm" onClick={() => setMoreActionsOpen((open) => !open)}>
              <WrenchIcon />
              Advanced actions
            </Button>
            <CollapsibleContent>
              <div className="mt-3 flex flex-wrap gap-2 rounded-2xl border border-border/70 bg-card/80 p-3">
                <Button size="sm" variant="outline" onClick={() => props.onCreateAttempt(props.ticket.id)}>
                  <HammerIcon />
                  Create attempt
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!props.primaryAttempt}
                  onClick={() => props.primaryAttempt && props.onStartAttemptSession(props.primaryAttempt.attempt.id)}
                >
                  <PlayIcon />
                  Start session
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    !props.primaryAttempt ||
                    props.runningValidationAttemptId === props.primaryAttempt.attempt.id ||
                    validationCommands.length === 0
                  }
                  onClick={() => props.primaryAttempt && props.onRunValidation(props.primaryAttempt.attempt.id)}
                >
                  <ScanSearchIcon />
                  Run validation
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!props.primaryAttempt || !canReviewAttempt(props.primaryAttempt)}
                  onClick={() => props.onRequestChanges(props.ticket.id, props.primaryAttempt?.attempt.id ?? null)}
                >
                  <ShieldCheckIcon />
                  Request changes
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!props.primaryAttempt}
                  onClick={() => props.onAccept(props.ticket.id, props.primaryAttempt?.attempt.id ?? null)}
                >
                  <CheckCheckIcon />
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!props.mergeableAttempt}
                  onClick={() => props.onMerge(props.ticket.id, props.mergeableAttempt?.attempt.id ?? null)}
                >
                  <GitMergeIcon />
                  Merge
                </Button>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </section>

      <DetailSection
        title="Now"
        description="What Presence is doing now, whether it needs you, and the next recommended move."
      >
        <div className="space-y-4">
          {callout ? <PresenceStatusCallout callout={callout} /> : null}

          <div className="grid gap-3 md:grid-cols-2">
            <TicketDigestCard
              label="Recommended move"
              value={primaryAction.label}
              detail={primaryAction.helper}
              tone={needsHuman ? "warning" : "info"}
            />
            <TicketDigestCard
              label="Current stage"
              value={stage.label}
              detail={stage.waitingOn}
              tone={stage.tone}
            />
            <TicketDigestCard
              label="Last worker result"
              value={props.primaryAttempt?.attempt.title ?? "No attempt yet"}
              detail={
                props.primaryAttempt?.latestWorkerHandoff?.nextStep ??
                props.primaryAttempt?.attempt.summary ??
                "Create or start an attempt to begin work."
              }
            />
            <TicketDigestCard
              label="Last review result"
              value={latestReview?.decision ?? "No review yet"}
              detail={
                latestReview?.summary ??
                (props.ticket.status === "in_review"
                  ? "Presence is waiting on review evidence."
                  : "This ticket has not produced a review artifact yet.")
              }
              tone={latestReview?.decision === "accept" ? "success" : latestReview?.decision ? "warning" : "neutral"}
            />
          </div>

          <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-foreground">Acceptance checklist</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {props.ticket.acceptanceChecklist.filter((item) => item.checked).length}/
                  {props.ticket.acceptanceChecklist.length} complete
                </div>
              </div>
            </div>
            <div className="mt-3 grid gap-2">
              {props.ticket.acceptanceChecklist.length === 0 ? (
                <div className="text-sm text-muted-foreground">No acceptance checklist yet.</div>
              ) : (
                props.ticket.acceptanceChecklist.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="flex items-center gap-3 rounded-xl border border-border/70 px-3 py-2 text-left text-sm transition hover:border-border hover:bg-muted/20"
                    onClick={() => props.onToggleChecklistItem(props.ticket.id, item.id, !item.checked)}
                  >
                    <div
                      className={cn(
                        "size-2 rounded-full",
                        item.checked ? "bg-emerald-500" : "bg-muted-foreground/40",
                      )}
                    />
                    <span className={item.checked ? "text-foreground" : "text-muted-foreground"}>
                      {item.label}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </DetailSection>

      <Collapsible open={evidenceOpen} onOpenChange={setEvidenceOpen}>
        <DetailSection
          title="Evidence"
          description="Why Presence thinks this state is real. Technical output stays tucked away until you ask for it."
          action={
            <Button variant="ghost" size="sm" onClick={() => setEvidenceOpen((open) => !open)}>
              {evidenceOpen ? "Hide" : "Show"}
            </Button>
          }
        >
          <CollapsibleContent forceMount>
            <div className={cn("space-y-3", !evidenceOpen && "hidden")}>
              <EvidenceCard
                title="Worker handoff"
                summary={
                  props.primaryAttempt?.latestWorkerHandoff?.nextStep ??
                  props.primaryAttempt?.latestWorkerHandoff?.completedWork[0] ??
                  "Presence has not captured a worker handoff for the current attempt yet."
                }
              >
            {props.primaryAttempt?.latestWorkerHandoff ? (
              <div className="space-y-3 text-xs leading-5 text-muted-foreground">
                <div>
                  <span className="font-medium text-foreground">Completed work:</span>{" "}
                  {props.primaryAttempt.latestWorkerHandoff.completedWork.join(" • ") || "None recorded."}
                </div>
                <div>
                  <span className="font-medium text-foreground">Next step:</span>{" "}
                  {props.primaryAttempt.latestWorkerHandoff.nextStep ?? "No next step recorded."}
                </div>
                {props.primaryAttempt.latestWorkerHandoff.changedFiles.length > 0 ? (
                  <div>
                    <span className="font-medium text-foreground">Changed files:</span>{" "}
                    {props.primaryAttempt.latestWorkerHandoff.changedFiles.join(" • ")}
                  </div>
                ) : null}
                {props.primaryAttempt.latestWorkerHandoff.testsRun.length > 0 ? (
                  <div>
                    <span className="font-medium text-foreground">Tests run:</span>{" "}
                    {props.primaryAttempt.latestWorkerHandoff.testsRun.join(" • ")}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="text-xs leading-5 text-muted-foreground">
                Start the worker session or wait for the next handoff to populate this evidence.
              </div>
            )}
          </EvidenceCard>

          <EvidenceCard
            title="Validation"
            summary={
              validationRuns.length === 0
                ? "No validation batch recorded for the current attempt."
                : validationRuns.some((run) => run.status === "failed")
                  ? "The latest validation batch has failures."
                  : "The latest validation batch passed."
            }
          >
              <div className="space-y-3">
                <div className="rounded-2xl border border-border/70 bg-muted/20 px-3 py-3 text-xs leading-5 text-muted-foreground">
                  <div className="font-medium text-foreground">{capabilitySummary}</div>
                <div className="mt-1">
                  {props.capabilityScan ? (
                    props.capabilityScan.discoveredCommands.length > 0 ? (
                      <>Detected commands: {props.capabilityScan.discoveredCommands.map((command) => command.command).join(" • ")}</>
                    ) : (
                      <>No runnable test, build, or lint commands were found automatically.</>
                    )
                  ) : (
                    <>Presence is still collecting capability data for this repository.</>
                  )}
                </div>
                {approvalReason ? (
                  <div className="mt-2 text-amber-100">{approvalReason}</div>
                ) : null}
                {mergeReason ? <div className="mt-2">{mergeReason}</div> : null}
              </div>
              <ValidationRunsSummary runs={validationRuns} />
            </div>
          </EvidenceCard>

          <EvidenceCard
            title="Review"
            summary={latestReview?.summary ?? "No review artifact has been recorded for this ticket yet."}
          >
            <div className="space-y-3 text-xs leading-5 text-muted-foreground">
              {latestReview ? (
                <>
                  <div>
                    <span className="font-medium text-foreground">Decision:</span>{" "}
                    {latestReview.decision ?? "No structured recommendation"}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Summary:</span>{" "}
                    {latestReview.summary}
                  </div>
                  {latestReview.changedFilesReviewed.length > 0 ? (
                    <div>
                      <span className="font-medium text-foreground">Files reviewed:</span>{" "}
                      {latestReview.changedFilesReviewed.join(" • ")}
                    </div>
                  ) : null}
                  {latestReview.evidence.length > 0 ? (
                    <div>
                      <span className="font-medium text-foreground">Evidence:</span>{" "}
                      {latestReview.evidence.map((item) => item.summary).join(" • ")}
                    </div>
                  ) : null}
                </>
                ) : (
                  <div>Presence is still waiting for structured review output.</div>
                )}
              </div>
              </EvidenceCard>

              <EvidenceCard
                title="Findings"
                summary={
                  openTicketFindings.length === 0
                    ? "No open findings are attached to this ticket."
                    : `${openTicketFindings.length} open finding${openTicketFindings.length === 1 ? "" : "s"} need attention.`
                }
              >
            <div className="space-y-3">
              {openTicketFindings.length === 0 ? (
                <div className="text-xs leading-5 text-muted-foreground">No open findings.</div>
              ) : (
                openTicketFindings.map((finding) => (
                  <div key={finding.id} className="rounded-2xl border border-border/70 px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={finding.severity === "blocking" ? "warning" : "outline"}>
                        {finding.severity}
                      </Badge>
                      <Badge variant="outline">{finding.disposition}</Badge>
                      <Badge variant="outline">{finding.source}</Badge>
                    </div>
                    <div className="mt-2 text-sm font-medium text-foreground">{finding.summary}</div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">{finding.rationale}</div>
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
              </EvidenceCard>

              <EvidenceCard
                title="Follow-up proposals"
                summary={
                  ticketFollowUps.length === 0
                    ? "No follow-up proposals yet."
                    : `${ticketFollowUps.length} follow-up proposal${ticketFollowUps.length === 1 ? "" : "s"} are attached to this ticket.`
                }
              >
            <div className="space-y-3">
              {ticketFollowUps.length === 0 ? (
                <div className="text-xs leading-5 text-muted-foreground">No follow-up proposals.</div>
              ) : (
                ticketFollowUps.map((proposal) => (
                  <div key={proposal.id} className="rounded-2xl border border-border/70 px-3 py-3">
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
              </EvidenceCard>

              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <div className="rounded-2xl border border-border/70 bg-background/70">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                    onClick={() => setAdvancedOpen((open) => !open)}
                  >
                    <div>
                      <div className="text-sm font-medium text-foreground">Advanced controls</div>
                      <div className="mt-1 text-xs leading-5 text-muted-foreground">
                        Waivers, manual overrides, attempt sessions, and promotion candidates live here.
                      </div>
                    </div>
                    <ChevronDownIcon
                      className={cn("size-4 text-muted-foreground transition-transform", advancedOpen && "rotate-180")}
                    />
                  </button>
                  <CollapsibleContent>
                    <Separator />
                    <div className="space-y-4 px-4 py-4">
                  {props.approveDecision?.requiresHumanValidationWaiver ? (
                    <div className="rounded-2xl border border-border/70 bg-muted/20 px-3 py-3">
                      <div className="text-sm font-medium text-foreground">Validation waiver</div>
                      <div className="mt-1 text-xs leading-5 text-muted-foreground">
                        Presence requires a human waiver before approval can proceed.
                      </div>
                      <Textarea
                        className="mt-3"
                        value={props.validationWaiverReason}
                        onChange={(event) => props.onValidationWaiverReasonChange(event.target.value)}
                        rows={3}
                        placeholder="Describe why approval can proceed without a passing validation run."
                      />
                      <div className="mt-3">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!props.validationWaiverReason.trim() || !props.primaryAttempt}
                          onClick={() => props.onRecordValidationWaiver(props.ticket.id, props.primaryAttempt?.attempt.id ?? null)}
                        >
                          <ShieldCheckIcon />
                          Record waiver
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  <div className="space-y-3">
                    {attempts.map((summary) => (
                      <div key={summary.attempt.id} className="rounded-2xl border border-border/70 bg-card/60 px-3 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-foreground">{summary.attempt.title}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {summary.attempt.provider
                                ? `${summary.attempt.provider} · ${summary.attempt.model}`
                                : "No session attached yet"}
                            </div>
                          </div>
                          <Badge variant="outline">{summary.attempt.status}</Badge>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
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
                            {summary.attempt.threadId ? "Open session" : "Start session"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => props.onToggleHandoffEditor(summary.attempt.id)}
                          >
                            <ClipboardListIcon />
                            {props.expandedHandoffAttemptId === summary.attempt.id ? "Hide override" : "Edit override"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => props.onCreatePromotionCandidate(props.ticket.id, summary.attempt.id)}
                          >
                            <BookOpenIcon />
                            Promote pattern
                          </Button>
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
                    ))}
                  </div>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            </div>
          </CollapsibleContent>
        </DetailSection>
      </Collapsible>

      <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
        <DetailSection
          title="History"
          description="The short timeline of what changed last, available when you want the fuller story."
          action={
            <Button variant="ghost" size="sm" onClick={() => setHistoryOpen((open) => !open)}>
              {historyOpen ? "Hide" : "Show"}
            </Button>
          }
        >
          <CollapsibleContent forceMount>
            <div className={cn("space-y-3", !historyOpen && "hidden")}>
              {timeline.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/70 px-3 py-4 text-sm text-muted-foreground">
                  No timeline events yet.
                </div>
              ) : (
                timeline.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-foreground">{item.title}</div>
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</div>
                      </div>
                      <div className="shrink-0 text-[11px] text-muted-foreground">
                        {formatTimestamp(item.timestamp)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CollapsibleContent>
        </DetailSection>
      </Collapsible>
    </div>
  );
}

function ValidationRunsSummary(props: { runs: readonly ValidationRunRecord[] }) {
  if (props.runs.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 px-3 py-4 text-xs leading-5 text-muted-foreground">
        No validation batch recorded yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {props.runs.map((run) => (
        <div key={run.id} className="rounded-2xl border border-border/70 px-3 py-3">
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
        description="Reviewed truth stays durable. Scratch state should not leak into project memory."
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
            <div className="rounded-2xl border border-dashed border-border/70 px-3 py-4 text-sm text-muted-foreground">
              No knowledge pages yet.
            </div>
          ) : null}
          {props.board.knowledgePages.map((page) => (
            <div key={page.id} className="rounded-2xl border border-border/70 px-3 py-3">
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
                {props.capabilityScan.hasValidationCapability ? "validation discovered" : "waiver required"}
              </Badge>
            </div>
            <div className="text-xs leading-5 text-muted-foreground">
              Ecosystems: {props.capabilityScan.ecosystems.join(", ") || "none detected"}
            </div>
            <div className="text-xs leading-5 text-muted-foreground">
              Commands:{" "}
              {props.capabilityScan.discoveredCommands.map((command) => command.command).join(" • ") || "none"}
            </div>
            {props.capabilityScan.riskSignals.length > 0 ? (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-xs leading-5 text-amber-100">
                {props.capabilityScan.riskSignals.join(" ")}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border/70 px-3 py-4 text-sm text-muted-foreground">
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
            <div className="rounded-2xl border border-dashed border-border/70 px-3 py-4 text-sm text-muted-foreground">
              No deterministic jobs queued yet.
            </div>
          ) : null}
          {props.board.jobs.map((job) => (
            <div key={job.id} className="rounded-2xl border border-border/70 px-3 py-3">
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
            <div className="rounded-2xl border border-dashed border-border/70 px-3 py-4 text-sm text-muted-foreground">
              No promotion candidates yet.
            </div>
          ) : null}
          {props.board.promotionCandidates.map((candidate) => (
            <div key={candidate.id} className="rounded-2xl border border-border/70 px-3 py-3">
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

export function ToolsWorkspace(props: {
  board: BoardSnapshot;
  capabilityScan: RepositoryCapabilityScanRecord | null;
  supervisorPriorities: string;
  supervisorActions: string;
  knowledgeTitle: string;
  knowledgeCompiledTruth: string;
  knowledgeTimeline: string;
  jobTitle: string;
  jobKind: string;
  toolsOpen: boolean;
  activeToolPanel: "memory" | "ops";
  onToolsOpenChange: (open: boolean) => void;
  onActiveToolPanelChange: (panel: "memory" | "ops") => void;
  onSupervisorPrioritiesChange: (value: string) => void;
  onSupervisorActionsChange: (value: string) => void;
  onSaveSupervisorHandoff: () => void;
  onKnowledgeTitleChange: (value: string) => void;
  onKnowledgeCompiledTruthChange: (value: string) => void;
  onKnowledgeTimelineChange: (value: string) => void;
  onSaveKnowledgePage: () => void;
  onJobTitleChange: (value: string) => void;
  onJobKindChange: (value: string) => void;
  onCreateJob: () => void;
  onRescanCapabilities: () => void;
}) {
  return (
    <Collapsible open={props.toolsOpen} onOpenChange={props.onToolsOpenChange}>
      <section className="rounded-2xl border border-border/70 bg-card/90 shadow-sm">
        <button
          type="button"
          className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left"
          onClick={() => props.onToolsOpenChange(!props.toolsOpen)}
        >
          <div>
            <div className="text-sm font-semibold text-foreground">Tools</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              Memory, ops, supervisor handoffs, rescans, and other admin surfaces live here.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">demoted</Badge>
            <ChevronDownIcon
              className={cn("size-4 text-muted-foreground transition-transform", props.toolsOpen && "rotate-180")}
            />
          </div>
        </button>
        <CollapsibleContent>
          <Separator />
          <div className="space-y-4 px-4 py-4">
            <div className="flex gap-2 rounded-2xl border border-border/70 bg-background/70 p-1">
              {(["memory", "ops"] as const).map((panel) => (
                <button
                  key={panel}
                  type="button"
                  className={cn(
                    "flex-1 rounded-xl px-3 py-2 text-sm font-medium transition",
                    props.activeToolPanel === panel
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                  onClick={() => props.onActiveToolPanelChange(panel)}
                >
                  {panel === "memory" ? "Memory" : "Ops"}
                </button>
              ))}
            </div>

            {props.activeToolPanel === "memory" ? (
              <MemoryInspector
                board={props.board}
                supervisorPriorities={props.supervisorPriorities}
                supervisorActions={props.supervisorActions}
                onSupervisorPrioritiesChange={props.onSupervisorPrioritiesChange}
                onSupervisorActionsChange={props.onSupervisorActionsChange}
                onSaveSupervisorHandoff={props.onSaveSupervisorHandoff}
                knowledgeTitle={props.knowledgeTitle}
                knowledgeCompiledTruth={props.knowledgeCompiledTruth}
                knowledgeTimeline={props.knowledgeTimeline}
                onKnowledgeTitleChange={props.onKnowledgeTitleChange}
                onKnowledgeCompiledTruthChange={props.onKnowledgeCompiledTruthChange}
                onKnowledgeTimelineChange={props.onKnowledgeTimelineChange}
                onSaveKnowledgePage={props.onSaveKnowledgePage}
              />
            ) : (
              <OpsInspector
                board={props.board}
                capabilityScan={props.capabilityScan}
                jobTitle={props.jobTitle}
                jobKind={props.jobKind}
                onJobTitleChange={props.onJobTitleChange}
                onJobKindChange={props.onJobKindChange}
                onCreateJob={props.onCreateJob}
                onRescanCapabilities={props.onRescanCapabilities}
              />
            )}
          </div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

export { STATUS_COLUMNS };
