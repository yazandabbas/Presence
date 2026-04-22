import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PresenceStatusCallout } from "./PresenceGuidedViews";

describe("PresenceStatusCallout", () => {
  it("renders the human-readable failure pattern", () => {
    const markup = renderToStaticMarkup(
      <PresenceStatusCallout
        callout={{
          severity: "warning",
          title: "Validation failed",
          summary: "One validation command failed in the current attempt.",
          retryBehavior: "Validation does not retry automatically.",
          recommendedAction: "Inspect the failure and run validation again after changes.",
          details: "npm run test:web",
        }}
      />,
    );

    expect(markup).toContain("Validation failed");
    expect(markup).toContain("Presence recommendation");
    expect(markup).toContain("Validation does not retry automatically.");
    expect(markup).toContain("Inspect the failure and run validation again after changes.");
    expect(markup).toContain("Show technical details");
  });
});
