import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PresenceStatusCallout } from "./PresenceGuidedViews";

describe("PresenceStatusCallout", () => {
  it("renders the human-readable failure pattern", () => {
    const markup = renderToStaticMarkup(
      <PresenceStatusCallout
        callout={{
          severity: "warning",
          title: "Reviewer needs evidence",
          summary: "The reviewer could not verify the ticket from the current handoff.",
          retryBehavior: "Presence will not retry without clearer evidence from the worker or your direction.",
          recommendedAction: "Ask the worker for targeted evidence or request changes with a concrete reason.",
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
