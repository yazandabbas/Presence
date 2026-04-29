import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  BoardSnapshot,
  PresenceOperationRecord,
  PresenceTicketMissionBriefing,
  TicketRecord,
} from "@t3tools/contracts";

import {
  HumanDirectionPanel,
  PresenceLiveStatusPanel,
  PresenceStatusCallout,
} from "./PresenceGuidedViews";

const now = "2026-04-29T00:00:00.000Z";
const boardId = "board-1" as never;
const ticketId = "ticket-1" as never;

function makeTicket(): TicketRecord {
  return {
    id: ticketId,
    boardId,
    parentTicketId: null,
    title: "Stabilize reviewer handoff",
    description: "Make the reviewer state clear.",
    status: "blocked",
    priority: "p1",
    acceptanceChecklist: [],
    assignedAttemptId: null,
    createdAt: now,
    updatedAt: now,
  } as TicketRecord;
}

function makeBriefing(overrides: Partial<PresenceTicketMissionBriefing> = {}) {
  return {
    ticketId,
    stage: "Review blocked",
    statusLine: "Reviewer needs clearer evidence before continuing.",
    waitingOn: "Human direction",
    latestEventId: null,
    latestEventSummary: "Reviewer requested evidence.",
    latestEventAt: now,
    needsHuman: true,
    humanAction: "Give Presence direction on the blocker.",
    retryBehavior: "manual",
    updatedAt: now,
    ...overrides,
  } as PresenceTicketMissionBriefing;
}

function makeBoard(overrides: Partial<BoardSnapshot> = {}): BoardSnapshot {
  return {
    ticketBriefings: [makeBriefing()],
    attemptSummaries: [],
    reviewArtifacts: [],
    missionEvents: [],
    operationLedger: [
      {
        id: "presence_operation_worker",
        parentOperationId: null,
        boardId,
        ticketId,
        attemptId: null,
        reviewArtifactId: null,
        supervisorRunId: null,
        threadId: null,
        kind: "worker_attempt",
        phase: "finish",
        status: "running",
        dedupeKey: "worker:test",
        summary: "Worker is streaming a handoff.",
        details: { missionEventKind: "worker_handoff" },
        counters: [],
        error: null,
        startedAt: now,
        completedAt: null,
        durationMs: null,
        createdAt: now,
        updatedAt: now,
      } as unknown as PresenceOperationRecord,
    ],
    ...overrides,
  } as BoardSnapshot;
}

describe("PresenceStatusCallout", () => {
  it("renders the human-readable failure pattern", () => {
    const markup = renderToStaticMarkup(
      <PresenceStatusCallout
        callout={{
          severity: "warning",
          title: "Reviewer needs evidence",
          summary: "The reviewer could not verify the ticket from the current handoff.",
          retryBehavior:
            "Presence will not retry without clearer evidence from the worker or your direction.",
          recommendedAction:
            "Ask the worker for targeted evidence or request changes with a concrete reason.",
          details: "Review artifact was missing changed-file evidence.",
        }}
      />,
    );

    expect(markup).toContain("Reviewer needs evidence");
    expect(markup).toContain("Presence recommendation");
    expect(markup).toContain("Presence will not retry without clearer evidence");
    expect(markup).toContain("Ask the worker for targeted evidence");
    expect(markup).toContain("Show technical details");
  });
});

describe("Presence evidence panel states", () => {
  it("renders live mode for a selected ticket", () => {
    const ticket = makeTicket();
    const markup = renderToStaticMarkup(
      <PresenceLiveStatusPanel board={makeBoard()} ticket={ticket}>
        <div>Ticket inspector</div>
      </PresenceLiveStatusPanel>,
    );

    expect(markup).toContain("Live status");
    expect(markup).toContain("Operations");
    expect(markup).toContain("Ticket trace");
    expect(markup).toContain("Worker is streaming a handoff.");
    expect(markup).not.toContain("Technical details");
    expect(markup).not.toContain("Latest meaningful update");
    expect(markup).toContain("Ticket inspector");
  });

  it("renders direction mode in the same evidence shell", () => {
    const ticket = makeTicket();
    const markup = renderToStaticMarkup(
      <HumanDirectionPanel
        board={makeBoard()}
        ticket={ticket}
        attemptId={null}
        activity={{
          tone: "loading",
          title: "Presence received your direction.",
          detail: "I am recording it into mission state.",
        }}
        isSubmitting={false}
        onSubmit={() => undefined}
      >
        <div>Tools</div>
      </HumanDirectionPanel>,
    );

    expect(markup).toContain("Presence needs direction");
    expect(markup).toContain("blocked on Stabilize reviewer handoff");
    expect(markup).toContain("Choose how you want me to proceed.");
    expect(markup).toContain("Try the review again");
    expect(markup).toContain("Presence received your direction.");
    expect(markup).toContain("Tools");
  });

  it("renders no selected ticket live state", () => {
    const markup = renderToStaticMarkup(
      <PresenceLiveStatusPanel board={makeBoard({ ticketBriefings: [] })} ticket={null}>
        <div>Tools</div>
      </PresenceLiveStatusPanel>,
    );

    expect(markup).toContain("Live status");
    expect(markup).toContain("No ticket selected");
    expect(markup).toContain("Select work from the queue");
    expect(markup).toContain("1 operation running");
    expect(markup).not.toContain("Latest meaningful update");
    expect(markup).toContain("Tools");
  });
});
