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
} from "lucide-react";
import {
  type AttemptSummary,
  type BoardSnapshot,
  type FindingRecord,
  type PresenceHumanDirectionKind,
  type PresenceTicketStatus,
  type ProjectionHealthRecord,
  type ProposedFollowUpRecord,
  type RepositoryCapabilityScanRecord,
  type RepositorySummary,
  type SupervisorPolicyDecision,
  type TicketRecord,
  type TicketSummaryRecord,
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
import { buildPresenceAttentionQueueViewModel } from "./PresenceAttentionQueueViewModel";
import { buildPresenceCockpitViewModel } from "./PresenceCockpitViewModel";
import {
  buildPresenceObservabilityViewModel,
  type PresenceOperationSummary,
} from "./PresenceObservabilityViewModel";
import {
  buildPresenceRepoBrainInspectionViewModel,
  type RepoBrainInspectionViewModel,
} from "./PresenceRepoBrainInspectionViewModel";
import {
  TicketEvidenceLogSection,
  TicketHistorySection,
  TicketNowSection,
} from "./TicketEvidenceSections";

export type PresenceCockpitActivity = Readonly<{
  tone: "loading" | "info" | "success" | "warning" | "error";
  title: string;
  detail: string;
}>;

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
    <div
      className={
        props.className ??
        "mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground"
      }
    >
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
          Presence turns a local repository into a guided board with attempts, review, and durable
          repo memory.
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
    <section
      className={cn("rounded-2xl border border-border/70 bg-card/90 shadow-sm", props.className)}
    >
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
          <div className="mt-2 text-sm text-muted-foreground">One repo, one guided cockpit.</div>
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

function operationToneClasses(tone: PresenceOperationSummary["tone"]): string {
  switch (tone) {
    case "success":
      return "border-emerald-500/35 bg-emerald-500/10 text-emerald-200";
    case "warning":
      return "border-amber-500/35 bg-amber-500/10 text-amber-200";
    case "error":
      return "border-destructive/40 bg-destructive/10 text-destructive-foreground";
    case "info":
      return "border-blue-500/35 bg-blue-500/10 text-blue-200";
    case "neutral":
      return "border-border/70 bg-muted/30 text-muted-foreground";
  }
}

function OperationRow(props: { operation: PresenceOperationSummary; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const hasDetails =
    props.operation.safeDetails.length > 0 || props.operation.errorSummary !== null;
  return (
    <div className="border-t border-border/60 py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                operationToneClasses(props.operation.tone),
              )}
            >
              {props.operation.label}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {props.operation.statusLabel}
              {props.operation.durationLabel ? ` · ${props.operation.durationLabel}` : ""}
            </span>
          </div>
          <div className="mt-2 text-sm font-medium leading-5 text-foreground">
            {props.operation.summary}
          </div>
          {!props.compact ? (
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              {props.operation.affectedLabel} · {props.operation.timestampLabel}
            </div>
          ) : null}
        </div>
        {hasDetails ? (
          <button
            type="button"
            className="shrink-0 text-xs font-medium text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Hide" : "Inspect"}
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="mt-3 border-l border-border/70 pl-3 text-xs leading-5 text-muted-foreground">
          {props.operation.errorSummary ? (
            <div className="font-medium text-foreground">{props.operation.errorSummary}</div>
          ) : null}
          {props.operation.safeDetails.map((detail) => (
            <div key={detail}>{detail}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PresenceOperationsPanel(props: {
  board: BoardSnapshot;
  ticket?: TicketRecord | null;
  compact?: boolean;
}) {
  const model = buildPresenceObservabilityViewModel({
    board: props.board,
    ticket: props.ticket,
  });
  const rows = props.ticket
    ? model.ticketTrace
    : [...model.active, ...model.failed, ...model.recent].slice(0, 6);
  return (
    <section className="border-b border-border/70 px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Operations
          </div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {props.ticket
              ? rows.length > 0
                ? "Ticket trace"
                : "No ticket trace yet"
              : model.headline}
          </div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">
            {props.ticket ? (rows[0]?.summary ?? model.emptyLabel) : model.subline}
          </div>
        </div>
        {!props.ticket ? (
          <div className="grid shrink-0 grid-cols-3 gap-2 text-center text-[11px]">
            <div>
              <div className="font-semibold text-foreground">{model.active.length}</div>
              <div className="text-muted-foreground">Active</div>
            </div>
            <div>
              <div className="font-semibold text-foreground">{model.failed.length}</div>
              <div className="text-muted-foreground">Failed</div>
            </div>
            <div>
              <div className="font-semibold text-foreground">{model.recent.length}</div>
              <div className="text-muted-foreground">Recent</div>
            </div>
          </div>
        ) : null}
      </div>
      {rows.length > 0 ? (
        <div className="mt-4">
          {rows.map((operation) => (
            <OperationRow
              key={operation.id}
              operation={operation}
              compact={props.compact ?? false}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function briefingForTicket(board: BoardSnapshot, ticket: TicketRecord) {
  return board.ticketBriefings.find((briefing) => briefing.ticketId === ticket.id) ?? null;
}

export function RepositorySelector(props: {
  repositories: readonly RepositorySummary[];
  selectedRepositoryId: string | null;
  onSelect: (repositoryId: string) => void;
}) {
  const selectedRepository =
    props.repositories.find((repository) => repository.id === props.selectedRepositoryId) ?? null;

  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      <span className="uppercase tracking-[0.18em]">Repository</span>
      <select
        value={props.selectedRepositoryId ?? ""}
        onChange={(event) => props.onSelect(event.target.value)}
        className="h-10 min-w-[260px] rounded-xl border border-border/70 bg-background/80 px-3 text-sm font-medium text-foreground outline-none transition focus:border-primary/60"
      >
        {props.repositories.map((repository) => (
          <option key={repository.id} value={repository.id}>
            {repository.title}
          </option>
        ))}
      </select>
      {selectedRepository ? (
        <span className="max-w-[320px] truncate">{selectedRepository.workspaceRoot}</span>
      ) : null}
    </label>
  );
}

export function PresenceBriefingSurface(props: {
  board: BoardSnapshot;
  goalDraft: string;
  activity: PresenceCockpitActivity | null;
  onGoalDraftChange: (value: string) => void;
  onSubmitGoal: () => void;
  submitGoalDisabled: boolean;
  submitGoalPending: boolean;
  onRunSupervisor: () => void;
  runSupervisorDisabled: boolean;
  runSupervisorReason: string;
  showRunSupervisor: boolean;
}) {
  const cockpit = buildPresenceCockpitViewModel({
    board: props.board,
    runSupervisorReason: props.runSupervisorReason,
  });

  return (
    <section className="border-b border-border/70 px-5 py-6">
      <div className="mx-auto max-w-6xl">
        <div className="rounded-[28px] border border-border/70 bg-[linear-gradient(135deg,rgba(59,130,246,0.12),rgba(15,23,42,0.18)_38%,rgba(16,185,129,0.08))] p-4 shadow-[0_22px_80px_rgba(0,0,0,0.20)]">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                Command Presence
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                Give me an outcome. I will split, route, review, and come back only when I need you.
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {cockpit.counts.activeTickets} active / {cockpit.counts.queuedGoals} queued /{" "}
              {cockpit.counts.humanActionTickets} need you / {cockpit.counts.blockedTickets} blocked
            </div>
          </div>
          <div className="flex flex-col gap-3 md:flex-row">
            <Input
              value={props.goalDraft}
              onChange={(event) => props.onGoalDraftChange(event.target.value)}
              placeholder="Example: update the AGENTS.md guide so future agents understand this repo."
              className="h-12 min-w-0 flex-1 rounded-2xl border-border/70 bg-background/75 px-4 text-base"
            />
            <Button
              className="h-12 rounded-2xl px-5"
              disabled={props.submitGoalDisabled}
              onClick={props.onSubmitGoal}
            >
              <SparklesIcon />
              {props.submitGoalPending ? "Handing off..." : "Send to Presence"}
            </Button>
          </div>
          {props.activity ? (
            <div
              className={cn(
                "mt-3 rounded-2xl border px-3 py-2 text-xs leading-5",
                props.activity.tone === "error" &&
                  "border-destructive/40 bg-destructive/10 text-destructive-foreground",
                props.activity.tone === "warning" &&
                  "border-amber-400/35 bg-amber-400/10 text-amber-100",
                props.activity.tone === "success" &&
                  "border-emerald-400/35 bg-emerald-400/10 text-emerald-100",
                props.activity.tone === "loading" &&
                  "border-blue-400/35 bg-blue-400/10 text-blue-100",
                props.activity.tone === "info" &&
                  "border-border/70 bg-background/45 text-muted-foreground",
              )}
            >
              <div className="font-medium text-foreground">{props.activity.title}</div>
              <div className="mt-0.5 text-muted-foreground">{props.activity.detail}</div>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className="min-w-0">{cockpit.controllerLine}</span>
            {props.showRunSupervisor ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={props.runSupervisorDisabled}
                onClick={props.onRunSupervisor}
              >
                <BotIcon />
                Run supervisor
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-5">
          <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
            Briefing
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
            {cockpit.briefingSummary}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {cockpit.statusLine}
          </p>
        </div>
      </div>
      <ProjectionHealthIndicator
        health={cockpit.projectionHealth}
        className="mx-auto mt-3 flex max-w-6xl flex-wrap items-center gap-2 text-[11px] text-muted-foreground"
      />
    </section>
  );
}

export function WorkQueueSurface(props: {
  board: BoardSnapshot;
  selectedTicketId: string | null;
  capabilityScan: RepositoryCapabilityScanRecord | null | undefined;
  onSelectTicket: (ticketId: string) => void;
}) {
  const queue = buildPresenceAttentionQueueViewModel({
    board: props.board,
    selectedTicketId: props.selectedTicketId,
    capabilityScan: props.capabilityScan,
  });

  if (queue.empty) {
    return (
      <div className="px-5 py-12 text-center text-sm text-muted-foreground">
        No tickets yet. Submit a repo goal and Presence will create the queue.
      </div>
    );
  }

  return (
    <section className="min-h-0 flex-1 overflow-auto px-5 py-5">
      <div className="mx-auto max-w-6xl">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
              Work queue
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              What I am doing now, what changed last, and what I am waiting for.
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            {queue.totalCount} work item{queue.totalCount === 1 ? "" : "s"}
          </div>
        </div>

        <div className="overflow-hidden rounded-[24px] border border-border/70 bg-background/35">
          <div className="grid grid-cols-[minmax(220px,1.5fr)_150px_minmax(210px,1fr)_minmax(220px,1fr)] border-b border-border/70 px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            <div>Work</div>
            <div>Stage</div>
            <div>Last update</div>
            <div>Waiting for</div>
          </div>
          {queue.rows.map((row) =>
            row.kind === "goal" ? (
              <div
                key={row.id}
                className="grid w-full grid-cols-[minmax(220px,1.5fr)_150px_minmax(210px,1fr)_minmax(220px,1fr)] items-start gap-4 border-b border-border/40 px-4 py-4 text-left"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">{row.title}</div>
                  <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {row.detail}
                  </div>
                </div>
                <div className="text-sm font-medium text-blue-100">{row.stageLabel}</div>
                <div className="min-w-0 text-xs leading-5 text-muted-foreground">
                  <div className="line-clamp-2 text-foreground">{row.latestUpdate}</div>
                  {row.latestUpdateAt ? (
                    <div className="mt-1">{formatRelativeTimestamp(row.latestUpdateAt)}</div>
                  ) : null}
                </div>
                <div className="min-w-0 text-xs leading-5 text-muted-foreground">
                  <div className="line-clamp-2">{row.waitingFor}</div>
                </div>
              </div>
            ) : (
              <button
                key={row.id}
                type="button"
                onClick={() => props.onSelectTicket(row.ticketId)}
                className={cn(
                  "grid w-full grid-cols-[minmax(220px,1.5fr)_150px_minmax(210px,1fr)_minmax(220px,1fr)] items-start gap-4 border-b border-border/40 px-4 py-4 text-left transition last:border-b-0 hover:bg-muted/15",
                  row.selected &&
                    "bg-[linear-gradient(90deg,rgba(59,130,246,0.12),rgba(59,130,246,0.04))]",
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {row.title}
                    </span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {row.detail}
                  </div>
                </div>
                <div
                  className={cn(
                    "text-sm font-medium",
                    row.attentionTone === "needs-human" ? "text-amber-200" : "text-foreground",
                  )}
                >
                  {row.stageLabel}
                </div>
                <div className="min-w-0 text-xs leading-5 text-muted-foreground">
                  <div className="line-clamp-2 text-foreground">{row.latestUpdate}</div>
                  {row.latestUpdateAt ? (
                    <div className="mt-1">{formatRelativeTimestamp(row.latestUpdateAt)}</div>
                  ) : null}
                </div>
                <div className="min-w-0 text-xs leading-5 text-muted-foreground">
                  <div className="line-clamp-2">{row.waitingFor}</div>
                  {row.humanAction ? (
                    <div className="mt-1 font-medium text-amber-200">{row.humanAction}</div>
                  ) : null}
                </div>
              </button>
            ),
          )}
        </div>
      </div>
    </section>
  );
}

const HUMAN_DIRECTION_OPTIONS: ReadonlyArray<{
  kind: PresenceHumanDirectionKind;
  title: string;
  description: string;
  instructions: string;
}> = [
  {
    kind: "retry_review_with_codex",
    title: "Try the review again",
    description: "I will re-run validation and only block with a concrete reviewer reason.",
    instructions:
      "Retry the review with Codex. Reuse the current attempt if it is still useful, and only block again with a concrete reviewer reason.",
  },
  {
    kind: "start_fresh_attempt",
    title: "Try a different approach",
    description:
      "I will route around the failed path and begin a new line of work with the current evidence.",
    instructions:
      "Start a fresh attempt for this ticket. Avoid repeating the failed path and use the current evidence as context.",
  },
  {
    kind: "pause_ticket",
    title: "Pause this work",
    description: "I will stop spending runtime here until you resume it.",
    instructions: "Pause this ticket for now. Keep it blocked until I provide another direction.",
  },
];

export function HumanDirectionPanel(props: {
  board: BoardSnapshot;
  ticket: TicketRecord;
  attemptId: AttemptSummary["attempt"]["id"] | null;
  activity: PresenceCockpitActivity | null;
  isSubmitting: boolean;
  onSubmit: (input: {
    directionKind: PresenceHumanDirectionKind;
    instructions: string;
    attemptId: AttemptSummary["attempt"]["id"] | null;
  }) => void;
  children: ReactNode;
}) {
  const briefing = briefingForTicket(props.board, props.ticket);
  const [customInstruction, setCustomInstruction] = useState("");
  const directionLine =
    briefing?.humanAction?.replace(
      "Give Presence direction on the blocker.",
      "Choose how you want me to proceed.",
    ) ??
    briefing?.statusLine ??
    "Choose how you want me to proceed.";

  return (
    <EvidencePanelShell
      modeLabel="Presence needs direction"
      title={`I'm blocked on ${props.ticket.title}`}
      statusLine={directionLine}
      latestUpdateLabel="Latest meaningful update"
      latestUpdate={
        briefing?.latestEventSummary ?? briefing?.statusLine ?? "Waiting for your direction."
      }
      latestUpdateAt={briefing?.latestEventAt ?? null}
      activity={props.activity}
      evidenceContent={props.children}
    >
      <div>
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-background/35">
          {HUMAN_DIRECTION_OPTIONS.map((option) => (
            <button
              key={option.kind}
              type="button"
              disabled={props.isSubmitting}
              onClick={() =>
                props.onSubmit({
                  directionKind: option.kind,
                  instructions: option.instructions,
                  attemptId: props.attemptId,
                })
              }
              className="w-full border-b border-border/50 px-4 py-3 text-left transition last:border-b-0 hover:bg-primary/8 disabled:opacity-60"
            >
              <div className="text-sm font-semibold text-foreground">{option.title}</div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                {option.description}
              </div>
            </button>
          ))}
        </div>

        <div className="mt-5 rounded-2xl border border-border/70 bg-background/35 p-4">
          <div className="text-sm font-semibold text-foreground">Tell Presence something else</div>
          <Textarea
            value={customInstruction}
            onChange={(event) => setCustomInstruction(event.target.value)}
            placeholder="Example: skip this approach and inspect the repo scripts first."
            className="mt-3 min-h-28 bg-background/60"
          />
          <Button
            className="mt-3 w-full"
            variant="outline"
            disabled={props.isSubmitting || !customInstruction.trim()}
            onClick={() =>
              props.onSubmit({
                directionKind: "custom",
                instructions: customInstruction.trim(),
                attemptId: props.attemptId,
              })
            }
          >
            Send direction
          </Button>
        </div>
      </div>
    </EvidencePanelShell>
  );
}

function ActivityNotice(props: { activity: PresenceCockpitActivity }) {
  return (
    <div
      className={cn(
        "mt-4 rounded-2xl border px-3 py-2 text-xs leading-5",
        props.activity.tone === "error" &&
          "border-destructive/40 bg-destructive/10 text-destructive-foreground",
        props.activity.tone === "warning" && "border-amber-400/35 bg-amber-400/10 text-amber-100",
        props.activity.tone === "success" &&
          "border-emerald-400/35 bg-emerald-400/10 text-emerald-100",
        props.activity.tone === "loading" && "border-blue-400/35 bg-blue-400/10 text-blue-100",
        props.activity.tone === "info" && "border-border/70 bg-background/45 text-muted-foreground",
      )}
    >
      <div className="font-medium text-foreground">{props.activity.title}</div>
      <div className="mt-0.5 text-muted-foreground">{props.activity.detail}</div>
    </div>
  );
}

export function EvidencePanelShell(props: {
  modeLabel: string;
  title: string;
  statusLine: string;
  latestUpdateLabel?: string;
  latestUpdate: string | null;
  latestUpdateAt: string | null;
  activity?: PresenceCockpitActivity | null;
  children?: ReactNode;
  evidenceContent?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/70 px-5 py-5">
        <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
          {props.modeLabel}
        </div>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">{props.title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{props.statusLine}</p>
        {props.activity ? <ActivityNotice activity={props.activity} /> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
        {props.latestUpdate ? (
          <div className="rounded-2xl border border-border/70 bg-background/55 p-4">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {props.latestUpdateLabel ?? "Latest meaningful update"}
            </div>
            <div className="mt-2 text-sm font-medium text-foreground">{props.latestUpdate}</div>
            {props.latestUpdateAt ? (
              <div className="mt-1 text-xs text-muted-foreground">
                {formatTimestamp(props.latestUpdateAt)}
              </div>
            ) : null}
          </div>
        ) : null}
        {props.children ? (
          <div className={props.latestUpdate ? "mt-5" : undefined}>{props.children}</div>
        ) : null}
        {props.evidenceContent ? <div className="mt-5">{props.evidenceContent}</div> : null}
      </div>
    </div>
  );
}

export function PresenceLiveStatusPanel(props: {
  board: BoardSnapshot;
  ticket: TicketRecord | null;
  children: ReactNode;
}) {
  if (props.ticket) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-border/70 px-5 py-4">
          <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
            Live status
          </div>
        </div>
        <PresenceOperationsPanel board={props.board} ticket={props.ticket} compact />
        <div className="min-h-0 flex-1 overflow-auto px-5 py-5">{props.children}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <EvidencePanelShell
        modeLabel="Live status"
        title="No ticket selected"
        statusLine="Select work from the queue to inspect the current live status."
        latestUpdate={null}
        latestUpdateAt={null}
      />
      <PresenceOperationsPanel board={props.board} />
      <div className="min-h-0 flex-1 overflow-auto px-5 py-5">{props.children}</div>
    </div>
  );
}

export function RepoBrainInspectionPanel(props: {
  board: BoardSnapshot;
  ticket: TicketRecord | null;
}) {
  const model = useMemo(
    () =>
      buildPresenceRepoBrainInspectionViewModel({
        board: props.board,
        ticket: props.ticket,
      }),
    [props.board, props.ticket],
  );

  return <RepoBrainInspectionContent model={model} />;
}

function RepoBrainInspectionContent(props: { model: RepoBrainInspectionViewModel }) {
  const hasContent =
    props.model.memories.length > 0 ||
    props.model.candidates.length > 0 ||
    props.model.evidence.length > 0;

  return (
    <section className="mt-5 border-t border-border/70 pt-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">{props.model.headline}</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">{props.model.subline}</div>
        </div>
        {props.model.failedProjection ? (
          <Badge variant="destructive">projection failed</Badge>
        ) : props.model.staleProjection ? (
          <Badge variant="outline">projection skipped</Badge>
        ) : null}
      </div>

      {!hasContent ? (
        <div className="mt-4 rounded-xl border border-border/70 bg-background/45 px-3 py-3 text-xs leading-5 text-muted-foreground">
          {props.model.emptyLabel}
        </div>
      ) : null}

      {props.model.memories.length > 0 ? (
        <div className="mt-4 space-y-3">
          {props.model.memories.slice(0, 3).map((memory) => (
            <div
              key={memory.id}
              className="rounded-xl border border-border/70 bg-background/45 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{memory.status}</Badge>
                <Badge variant="secondary">{memory.kind}</Badge>
                <span className="text-[11px] text-muted-foreground">
                  {memory.confidence} confidence
                </span>
              </div>
              <div className="mt-2 text-sm font-medium text-foreground">{memory.title}</div>
              <div className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">
                {memory.body || "No compiled truth recorded."}
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground">
                {memory.evidenceCount} source{memory.evidenceCount === 1 ? "" : "s"} ·{" "}
                {memory.trustMode}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {props.model.candidates.length > 0 ? (
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            Candidates
          </div>
          <div className="mt-2 space-y-2">
            {props.model.candidates.slice(0, 4).map((candidate) => (
              <div
                key={candidate.id}
                className="rounded-xl border border-border/70 bg-background/35 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{candidate.status}</Badge>
                  <span className="text-[11px] text-muted-foreground">
                    {candidate.proposedBy} · {candidate.confidence}
                  </span>
                </div>
                <div className="mt-1 text-xs font-medium text-foreground">{candidate.title}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {props.model.evidence.length > 0 ? (
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            Evidence
          </div>
          <div className="mt-2 space-y-2">
            {props.model.evidence.slice(0, 4).map((item) => (
              <div key={item.id} className="border-l border-border/70 pl-3">
                <div className="text-xs font-medium text-foreground">{item.summary}</div>
                <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
                  {item.role} · {item.sourceLabel} · {formatTimestamp(item.observedAt)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
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
  const summary = props.board.ticketSummaries.find(
    (candidate) => candidate.ticketId === props.ticket.id,
  );

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
        {attempts.length > 1 ? <Badge variant="outline">{attempts.length} attempts</Badge> : null}
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
            <div className="text-sm font-semibold text-foreground">
              {STATUS_LABELS[props.status]}
            </div>
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
              props.board.ticketProjectionHealth.find((health) => health.scopeId === ticket.id) ??
              null
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
  startingAttemptId: string | null;
  onCreateAttempt: (ticketId: string) => void;
  onStartAttemptSession: (attemptId: string) => void;
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
          <SparklesIcon />
          Let Presence continue
        </Button>
      );
    case "start_work":
      return (
        <Button
          disabled={
            !props.primaryAttempt || props.startingAttemptId === props.primaryAttempt.attempt.id
          }
          onClick={() =>
            props.primaryAttempt && props.onStartAttemptSession(props.primaryAttempt.attempt.id)
          }
        >
          {props.startingAttemptId === props.primaryAttempt?.attempt.id ? (
            <RefreshCcwIcon className="animate-spin" />
          ) : (
            <PlayIcon />
          )}
          {props.startingAttemptId === props.primaryAttempt?.attempt.id
            ? "Opening..."
            : "Continue work"}
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
            Approve result
          </Button>
          <Button
            variant="outline"
            disabled={!props.primaryAttempt}
            onClick={() =>
              props.onRequestChanges(props.ticketId, props.primaryAttempt?.attempt.id ?? null)
            }
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
          Merge approved work
        </Button>
      );
    case "request_changes":
      return (
        <Button
          variant="outline"
          disabled={!props.primaryAttempt}
          onClick={() =>
            props.onRequestChanges(props.ticketId, props.primaryAttempt?.attempt.id ?? null)
          }
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
  startingAttemptId: string | null;
  onCreateAttempt: (ticketId: string) => void;
  onStartAttemptSession: (attemptId: string) => void;
  onResolveFinding: (findingId: string) => void;
  onDismissFinding: (findingId: string) => void;
  onCreateFollowUpProposal: (finding: FindingRecord, kind: ProposedFollowUpRecord["kind"]) => void;
  onMaterializeFollowUp: (proposalId: string) => void;
  onRequestChanges: (ticketId: string, attemptId: string | null) => void;
  onAccept: (ticketId: string, attemptId: string | null) => void;
  onMerge: (ticketId: string, attemptId: string | null) => void;
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const openTicketFindings = useMemo(
    () =>
      props.board.findings.filter(
        (finding) => finding.ticketId === props.ticket.id && finding.status === "open",
      ),
    [props.board.findings, props.ticket.id],
  );
  const ticketFollowUps = useMemo(
    () =>
      props.board.proposedFollowUps.filter(
        (proposal) => proposal.parentTicketId === props.ticket.id,
      ),
    [props.board.proposedFollowUps, props.ticket.id],
  );
  const latestReview = useMemo(
    () =>
      props.board.reviewArtifacts
        .filter((artifact) => artifact.ticketId === props.ticket.id)
        .toSorted((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0] ??
      null,
    [props.board.reviewArtifacts, props.ticket.id],
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
  const approvalReason = formatPolicyReasons(props.approveDecision);
  const mergeReason = formatPolicyReasons(props.mergeDecision);
  const needsHuman = stage.bucket === "Needs human decision" || stage.bucket === "Blocked";
  const briefingLine = needsHuman
    ? "Presence needs your direction before this ticket can move."
    : "Presence can keep this ticket moving without you for now.";

  return (
    <div className="space-y-4">
      <section className="border-b border-border/70 pb-5">
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

        <div className="mt-4 grid gap-3 border-l border-border/70 pl-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Current state
            </div>
            <div className="mt-1 text-base font-semibold text-foreground">{stage.label}</div>
            <div className="mt-1 text-sm leading-6 text-muted-foreground">{reasonLine}</div>
          </div>

          <div className="grid gap-3 border-t border-border/60 pt-3 md:grid-cols-2">
            <div>
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Presence is waiting on
              </div>
              <div className="mt-1 text-sm font-medium text-foreground">{stage.waitingOn}</div>
            </div>
            <div>
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
            startingAttemptId: props.startingAttemptId,
            onCreateAttempt: props.onCreateAttempt,
            onStartAttemptSession: props.onStartAttemptSession,
            onAccept: props.onAccept,
            onRequestChanges: props.onRequestChanges,
            onMerge: props.onMerge,
            onRevealBlocker: () => setEvidenceOpen(true),
            ticketId: props.ticket.id,
          })}
        </div>
      </section>

      <TicketNowSection
        callout={callout}
        primaryAction={primaryAction}
        needsHuman={needsHuman}
        waitingOn={stage.waitingOn}
        stageLabel={stage.label}
        primaryAttempt={props.primaryAttempt}
        latestReview={latestReview}
      />

      <TicketEvidenceLogSection
        open={evidenceOpen}
        onOpenChange={setEvidenceOpen}
        primaryAttempt={props.primaryAttempt}
        latestReview={latestReview}
        capabilityScan={props.capabilityScan}
        approvalReason={approvalReason}
        mergeReason={mergeReason}
        findings={openTicketFindings}
        followUps={ticketFollowUps}
        onResolveFinding={props.onResolveFinding}
        onDismissFinding={props.onDismissFinding}
        onCreateFollowUpProposal={props.onCreateFollowUpProposal}
        onMaterializeFollowUp={props.onMaterializeFollowUp}
      />

      <TicketHistorySection open={historyOpen} onOpenChange={setHistoryOpen} timeline={timeline} />
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
          <Button
            size="sm"
            disabled={!props.knowledgeTitle.trim()}
            onClick={props.onSaveKnowledgePage}
          >
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
        description="Repo context that helps the reviewer choose the right evidence path."
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
              <Badge variant="secondary">reviewer validates</Badge>
            </div>
            <div className="text-xs leading-5 text-muted-foreground">
              Ecosystems: {props.capabilityScan.ecosystems.join(", ") || "none detected"}
            </div>
            <div className="text-xs leading-5 text-muted-foreground">
              Commands:{" "}
              {props.capabilityScan.discoveredCommands
                .map((command) => command.command)
                .join(" • ") || "none"}
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
              className={cn(
                "size-4 text-muted-foreground transition-transform",
                props.toolsOpen && "rotate-180",
              )}
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
