import {
  AlertCircleIcon,
  BotIcon,
  CheckCheckIcon,
  ChevronDownIcon,
  ShieldAlertIcon,
} from "lucide-react";
import {
  type AttemptSummary,
  type FindingRecord,
  type ProposedFollowUpRecord,
  type RepositoryCapabilityScanRecord,
  type ReviewArtifactRecord,
} from "@t3tools/contracts";
import { useState, type ReactNode } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import { cn } from "~/lib/utils";
import {
  type PresenceTicketCalloutViewModel,
  type PresenceTicketPrimaryActionViewModel,
} from "./PresencePresentation";

type TicketTimelineItem = Readonly<{
  id: string;
  title: string;
  description: string;
  timestamp: string;
}>;

function formatTimestamp(timestamp: string): string {
  const date = new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
  }).format(new Date(timestamp));
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
  return `${date} ${time}`;
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

function TicketStatusCallout(props: {
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

function TicketDigestCard(props: {
  label: string;
  value: string;
  detail: string;
  tone?: "info" | "warning";
}) {
  return (
    <div className="border-t border-border/60 py-3 first:border-t-0">
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        {props.label}
      </div>
      <div
        className={cn(
          "mt-1 text-sm font-semibold",
          props.tone === "warning" ? "text-amber-100" : "text-foreground",
        )}
      >
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
  const [open, setOpen] = useState(props.defaultOpen ?? true);

  return (
    <div className="border-t border-border/70 py-3 first:border-t-0">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        <div>
          <div className="text-sm font-semibold text-foreground">{props.title}</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">{props.summary}</div>
        </div>
        <ChevronDownIcon
          className={cn(
            "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? <div className="mt-3">{props.children}</div> : null}
    </div>
  );
}

export function TicketNowSection(props: {
  callout: PresenceTicketCalloutViewModel | null;
  primaryAction: PresenceTicketPrimaryActionViewModel;
  needsHuman: boolean;
  waitingOn: string;
  stageLabel: string;
  primaryAttempt: AttemptSummary | null;
  latestReview: ReviewArtifactRecord | null;
}) {
  return (
    <section className="border-b border-border/70 py-4">
      <div className="text-sm font-semibold text-foreground">Now</div>
      <div className="mt-3 space-y-4">
        {props.callout ? <TicketStatusCallout callout={props.callout} /> : null}
        <div>
          <TicketDigestCard
            label="Move"
            value={props.primaryAction.label}
            detail={props.primaryAction.helper}
            tone={props.needsHuman ? "warning" : "info"}
          />
          <TicketDigestCard label="Waiting on" value={props.waitingOn} detail={props.stageLabel} />
          <TicketDigestCard
            label="Current work"
            value={props.primaryAttempt?.attempt.title ?? "No work started yet"}
            detail={
              props.primaryAttempt?.latestWorkerHandoff?.nextStep ??
              props.primaryAttempt?.attempt.summary ??
              "Presence has not begun this item yet."
            }
          />
          <TicketDigestCard
            label="Latest review"
            value={props.latestReview?.decision ?? "No review yet"}
            detail={props.latestReview?.summary ?? "No review artifact has been recorded yet."}
          />
        </div>
      </div>
    </section>
  );
}

export function TicketEvidenceLogSection(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  primaryAttempt: AttemptSummary | null;
  latestReview: ReviewArtifactRecord | null;
  capabilityScan: RepositoryCapabilityScanRecord | null;
  approvalReason: string | null;
  mergeReason: string | null;
  findings: ReadonlyArray<FindingRecord>;
  followUps: ReadonlyArray<ProposedFollowUpRecord>;
  onResolveFinding: (findingId: string) => void;
  onDismissFinding: (findingId: string) => void;
  onCreateFollowUpProposal: (finding: FindingRecord, kind: ProposedFollowUpRecord["kind"]) => void;
  onMaterializeFollowUp: (proposalId: string) => void;
}) {
  const capabilitySummary = props.capabilityScan
    ? props.capabilityScan.discoveredCommands.length > 0
      ? "Repository commands discovered"
      : "No automation commands discovered"
    : "Capability scan pending";

  return (
    <Collapsible open={props.open} onOpenChange={props.onOpenChange}>
      <section className="border-b border-border/70 py-4">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 text-left"
          onClick={() => props.onOpenChange(!props.open)}
        >
          <div>
            <div className="text-sm font-semibold text-foreground">Evidence</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              What changed, validation, open issues, and follow-ups.
            </div>
          </div>
          <ChevronDownIcon
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              props.open && "rotate-180",
            )}
          />
        </button>
        <CollapsibleContent>
          <div className="mt-4 space-y-3">
            <EvidenceCard
              title="What changed"
              summary={
                props.primaryAttempt?.latestWorkerHandoff?.nextStep ??
                props.primaryAttempt?.latestWorkerHandoff?.completedWork[0] ??
                "Presence has not captured work evidence for this item yet."
              }
            >
              {props.primaryAttempt?.latestWorkerHandoff ? (
                <div className="space-y-3 text-xs leading-5 text-muted-foreground">
                  <div>
                    <span className="font-medium text-foreground">Completed work:</span>{" "}
                    {props.primaryAttempt.latestWorkerHandoff.completedWork.join(" • ") ||
                      "None recorded."}
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
                  Presence has not recorded work evidence for this item yet.
                </div>
              )}
            </EvidenceCard>

            <EvidenceCard
              title="Validation"
              summary="The reviewer owns validation and records evidence in the review result."
            >
              <div className="space-y-3">
                <div className="border-l border-border/70 pl-3 text-xs leading-5 text-muted-foreground">
                  <div className="font-medium text-foreground">{capabilitySummary}</div>
                  <div className="mt-1">
                    {props.capabilityScan ? (
                      props.capabilityScan.discoveredCommands.length > 0 ? (
                        <>
                          Detected commands:{" "}
                          {props.capabilityScan.discoveredCommands
                            .map((command) => command.command)
                            .join(" • ")}
                        </>
                      ) : (
                        <>
                          No automation commands were detected; the reviewer should inspect the repo
                          and validate by evidence.
                        </>
                      )
                    ) : (
                      <>Presence is still collecting repository context.</>
                    )}
                  </div>
                  {props.approvalReason ? (
                    <div className="mt-2 text-amber-100">{props.approvalReason}</div>
                  ) : null}
                  {props.mergeReason ? <div className="mt-2">{props.mergeReason}</div> : null}
                </div>
              </div>
            </EvidenceCard>

            <EvidenceCard
              title="Review"
              summary={
                props.latestReview?.summary ??
                "No review artifact has been recorded for this item yet."
              }
            >
              <div className="space-y-3 text-xs leading-5 text-muted-foreground">
                {props.latestReview ? (
                  <>
                    <div>
                      <span className="font-medium text-foreground">Decision:</span>{" "}
                      {props.latestReview.decision ?? "No structured recommendation"}
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Summary:</span>{" "}
                      {props.latestReview.summary}
                    </div>
                    {props.latestReview.changedFilesReviewed.length > 0 ? (
                      <div>
                        <span className="font-medium text-foreground">Files reviewed:</span>{" "}
                        {props.latestReview.changedFilesReviewed.join(" • ")}
                      </div>
                    ) : null}
                    {props.latestReview.evidence.length > 0 ? (
                      <div>
                        <span className="font-medium text-foreground">
                          Reviewer validation evidence:
                        </span>
                        <div className="mt-2 space-y-2">
                          {props.latestReview.evidence.map((item) => (
                            <div
                              key={`${item.kind}-${item.target ?? ""}-${item.outcome}-${item.summary}`}
                              className="border-t border-border/60 py-2 first:border-t-0"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant={item.relevant ? "secondary" : "outline"}>
                                  {item.kind.replaceAll("_", " ")}
                                </Badge>
                                <Badge
                                  variant={
                                    item.outcome === "passed" || item.outcome === "not_applicable"
                                      ? "secondary"
                                      : item.outcome === "failed"
                                        ? "warning"
                                        : "outline"
                                  }
                                >
                                  {item.outcome.replaceAll("_", " ")}
                                </Badge>
                                {item.target ? (
                                  <span className="text-muted-foreground">{item.target}</span>
                                ) : null}
                              </div>
                              <div className="mt-2 text-foreground">{item.summary}</div>
                              {item.details ? <div className="mt-1">{item.details}</div> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div>Presence is still waiting for structured review output.</div>
                )}
              </div>
            </EvidenceCard>

            <EvidenceCard
              title="Open issues"
              summary={
                props.findings.length === 0
                  ? "No stored findings are attached to this item."
                  : `${props.findings.length} stored finding${props.findings.length === 1 ? "" : "s"} are available as secondary evidence.`
              }
              defaultOpen={false}
            >
              <div className="space-y-3">
                {props.findings.length === 0 ? (
                  <div className="text-xs leading-5 text-muted-foreground">No open findings.</div>
                ) : (
                  props.findings.map((finding) => (
                    <div
                      key={finding.id}
                      className="border-t border-border/60 py-3 first:border-t-0"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={finding.severity === "blocking" ? "warning" : "outline"}>
                          {finding.severity}
                        </Badge>
                        <Badge variant="outline">{finding.disposition}</Badge>
                        <Badge variant="outline">{finding.source}</Badge>
                      </div>
                      <div className="mt-2 text-sm font-medium text-foreground">
                        {finding.summary}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-muted-foreground">
                        {finding.rationale}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => props.onResolveFinding(finding.id)}
                        >
                          Resolve finding
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => props.onDismissFinding(finding.id)}
                        >
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
              title="Follow-ups"
              summary={
                props.followUps.length === 0
                  ? "No follow-up proposals yet."
                  : `${props.followUps.length} follow-up proposal${props.followUps.length === 1 ? "" : "s"} are attached as secondary evidence.`
              }
              defaultOpen={false}
            >
              <div className="space-y-3">
                {props.followUps.length === 0 ? (
                  <div className="text-xs leading-5 text-muted-foreground">
                    No follow-up proposals.
                  </div>
                ) : (
                  props.followUps.map((proposal) => (
                    <div
                      key={proposal.id}
                      className="border-t border-border/60 py-3 first:border-t-0"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{proposal.kind}</Badge>
                        <Badge variant={proposal.status === "open" ? "warning" : "secondary"}>
                          {proposal.status}
                        </Badge>
                      </div>
                      <div className="mt-2 text-sm font-medium text-foreground">
                        {proposal.title}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-muted-foreground">
                        {proposal.description || "No proposal description provided."}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {proposal.status === "open" && proposal.kind !== "request_changes" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => props.onMaterializeFollowUp(proposal.id)}
                          >
                            {proposal.kind === "blocker_ticket"
                              ? "Create blocker ticket"
                              : "Create child ticket"}
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
          </div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

export function TicketHistorySection(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timeline: ReadonlyArray<TicketTimelineItem>;
}) {
  return (
    <Collapsible open={props.open} onOpenChange={props.onOpenChange}>
      <section className="py-4">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 text-left"
          onClick={() => props.onOpenChange(!props.open)}
        >
          <div>
            <div className="text-sm font-semibold text-foreground">History</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              The short timeline is available when you want the fuller story.
            </div>
          </div>
          <ChevronDownIcon
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              props.open && "rotate-180",
            )}
          />
        </button>
        <CollapsibleContent>
          <div className="mt-4 space-y-3">
            {props.timeline.length === 0 ? (
              <div className="border-t border-dashed border-border/70 py-4 text-sm text-muted-foreground">
                No timeline events yet.
              </div>
            ) : (
              props.timeline.map((item) => (
                <div key={item.id} className="border-t border-border/60 py-3 first:border-t-0">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-foreground">{item.title}</div>
                      <div className="mt-1 text-xs leading-5 text-muted-foreground">
                        {item.description}
                      </div>
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
      </section>
    </Collapsible>
  );
}
