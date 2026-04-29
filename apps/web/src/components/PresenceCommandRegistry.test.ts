import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildPresenceCommandItems,
  executePresenceCommandDefinition,
  type PresenceCommandDefinition,
} from "./PresenceCommandRegistry";

function makeCommand(
  overrides: Partial<PresenceCommandDefinition> = {},
): PresenceCommandDefinition {
  return {
    id: "theme.dark",
    title: "Dark theme",
    description: "Switch to dark theme",
    icon: null,
    searchTerms: ["theme", "dark"],
    risk: "instant",
    run: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("buildPresenceCommandItems", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs instant commands without confirmation", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const [item] = buildPresenceCommandItems([makeCommand({ run })]);

    await item!.run();

    expect(run).toHaveBeenCalledTimes(1);
    expect(item?.keepOpen).toBe(true);
    expect(item?.value).toBe("presence-command:theme.dark");
    expect(item?.searchTerms).toContain("instant safe");
  });

  it("skips confirm commands when the user declines", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.fn().mockResolvedValue(false);

    const [item] = buildPresenceCommandItems(
      [
        makeCommand({
          id: "thread.archive-current",
          risk: "confirm",
          confirmationMessage: "Archive this thread?",
          run,
        }),
      ],
      { confirm },
    );

    await item!.run();

    expect(confirm).toHaveBeenCalledWith("Archive this thread?");
    expect(run).not.toHaveBeenCalled();
    expect(item?.searchTerms).toContain("confirm dangerous destructive");
  });

  it("uses an injected confirmer for risky commands", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.fn().mockResolvedValue(true);

    const [item] = buildPresenceCommandItems(
      [
        makeCommand({
          id: "thread.archive-current",
          risk: "confirm",
          confirmationMessage: "Archive this thread?",
          run,
        }),
      ],
      { confirm },
    );

    await item!.run();

    expect(confirm).toHaveBeenCalledWith("Archive this thread?");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not run disabled commands", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const [item] = buildPresenceCommandItems([
      makeCommand({
        enabled: false,
        disabledReason: "No active thread.",
        run,
      }),
    ]);

    await item!.run();

    expect(run).not.toHaveBeenCalled();
    expect(item?.description).toBe("No active thread.");
    expect(item?.searchTerms).toContain("disabled unavailable");
  });

  it("runs confirm commands after approval", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.fn().mockResolvedValue(true);

    const [item] = buildPresenceCommandItems(
      [
        makeCommand({
          id: "thread.stop-current",
          risk: "confirm",
          run,
        }),
      ],
      { confirm },
    );

    await item!.run();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("reports whether execution happened", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const skipped = await executePresenceCommandDefinition(makeCommand({ risk: "confirm", run }), {
      confirm: vi.fn().mockResolvedValue(false),
    });
    const executed = await executePresenceCommandDefinition(makeCommand({ run }));

    expect(skipped).toBe(false);
    expect(executed).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
