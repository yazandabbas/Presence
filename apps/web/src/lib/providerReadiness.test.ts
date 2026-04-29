import type { ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  isReadyPresenceHarnessProvider,
  resolvePresenceHarnessReadiness,
} from "./providerReadiness";

function makeProvider(overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    provider: "codex",
    installed: true,
    enabled: true,
    status: "ready",
    version: "1.0.0",
    auth: {
      status: "authenticated",
      type: "api_key",
      label: "Signed in",
    },
    models: [
      {
        slug: "gpt-5.4",
        name: "GPT-5.4",
        isCustom: false,
        capabilities: null,
      },
    ],
    slashCommands: [],
    skills: [],
    checkedAt: "2026-04-28T09:00:00.000Z",
    ...overrides,
  };
}

describe("providerReadiness", () => {
  it("requires an enabled installed ready authenticated provider with models", () => {
    expect(isReadyPresenceHarnessProvider(makeProvider())).toBe(true);
    expect(isReadyPresenceHarnessProvider(makeProvider({ enabled: false }))).toBe(false);
    expect(isReadyPresenceHarnessProvider(makeProvider({ installed: false }))).toBe(false);
    expect(isReadyPresenceHarnessProvider(makeProvider({ status: "warning" }))).toBe(false);
    expect(
      isReadyPresenceHarnessProvider(
        makeProvider({ auth: { status: "unauthenticated", type: "oauth" } }),
      ),
    ).toBe(false);
    expect(isReadyPresenceHarnessProvider(makeProvider({ models: [] }))).toBe(false);
  });

  it("reports selected Presence harness availability from the same rule", () => {
    const result = resolvePresenceHarnessReadiness(
      [
        makeProvider(),
        makeProvider({
          provider: "claudeAgent",
          status: "warning",
        }),
      ],
      "claudeAgent",
    );

    expect(result.readyProviders.map((provider) => provider.provider)).toEqual(["codex"]);
    expect(result.selectedProviderUnavailable).toBe(true);
  });
});
