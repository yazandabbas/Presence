import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getWsConnectionStatus,
  getWsReconnectDelayMsForRetry,
  getWsConnectionUiState,
  recordWsConnectionAttempt,
  recordWsConnectionClosed,
  recordWsConnectionErrored,
  recordWsConnectionOpened,
  resetWsConnectionStateForTests,
  setBrowserOnlineStatus,
  WS_RECONNECT_MAX_ATTEMPTS,
} from "./wsConnectionState";

describe("wsConnectionState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-03T20:30:00.000Z"));
    resetWsConnectionStateForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("treats a disconnected browser as offline once the websocket drops", () => {
    recordWsConnectionAttempt("ws://localhost:3020/ws");
    recordWsConnectionOpened();
    recordWsConnectionClosed({ code: 1006, reason: "offline" });
    setBrowserOnlineStatus(false);

    expect(getWsConnectionUiState(getWsConnectionStatus())).toBe("offline");
  });

  it("stays in the initial connecting state until the first disconnect", () => {
    recordWsConnectionAttempt("ws://localhost:3020/ws");

    expect(getWsConnectionStatus()).toMatchObject({
      attemptCount: 1,
      hasConnected: false,
      phase: "connecting",
    });
    expect(getWsConnectionUiState(getWsConnectionStatus())).toBe("connecting");
  });

  it("schedules the next retry after a failed websocket attempt", () => {
    recordWsConnectionAttempt("ws://localhost:3020/ws");
    recordWsConnectionErrored("Unable to connect to the T3 server WebSocket.");

    const firstRetryDelayMs = getWsReconnectDelayMsForRetry(0);
    if (firstRetryDelayMs === null) {
      throw new Error("Expected an initial retry delay.");
    }

    expect(getWsConnectionStatus()).toMatchObject({
      nextRetryAt: new Date(Date.now() + firstRetryDelayMs).toISOString(),
      reconnectAttemptCount: 1,
      reconnectPhase: "waiting",
    });
  });

  it("keeps scheduling capped reconnect attempts after the initial backoff window", () => {
    for (let attempt = 0; attempt < WS_RECONNECT_MAX_ATTEMPTS + 2; attempt += 1) {
      recordWsConnectionAttempt("ws://localhost:3020/ws");
      recordWsConnectionErrored("Unable to connect to the T3 server WebSocket.");
    }

    const cappedRetryDelayMs = getWsReconnectDelayMsForRetry(WS_RECONNECT_MAX_ATTEMPTS + 1);
    if (cappedRetryDelayMs === null) {
      throw new Error("Expected capped retry delay.");
    }

    expect(getWsConnectionStatus()).toMatchObject({
      nextRetryAt: new Date(Date.now() + cappedRetryDelayMs).toISOString(),
      reconnectAttemptCount: WS_RECONNECT_MAX_ATTEMPTS + 2,
      reconnectPhase: "waiting",
    });
  });
});
