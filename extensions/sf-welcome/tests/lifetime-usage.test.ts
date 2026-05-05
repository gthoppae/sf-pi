/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Covers resolveLifetimeUsage() — the splash's new "Lifetime Usage" line.
 *
 * Contract:
 *   - Always return a local session-file estimate (source = sessions).
 *   - Gateway keyInfo.spend is per-key, not all-time, and resets after key rotation.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetMonthlyUsageStoreForTests,
  setMonthlyUsageState,
} from "../../../lib/common/monthly-usage/store.ts";
import { resolveLifetimeUsage } from "../lib/splash-data.ts";
import * as sessionData from "../lib/session-data.ts";

describe("resolveLifetimeUsage", () => {
  afterEach(() => {
    __resetMonthlyUsageStoreForTests();
    vi.restoreAllMocks();
  });

  it("uses the local session-file estimate even when gateway keyInfo is present", () => {
    setMonthlyUsageState({
      monthlyUsage: null,
      monthlyUsageError: null,
      keyInfo: {
        spend: 0.29,
        keyName: "sk-...abcd",
        fetchedAt: new Date().toISOString(),
      },
      keyInfoError: null,
      health: null,
      healthError: null,
    });
    vi.spyOn(sessionData, "estimateLifetimeCost").mockReturnValue(8123.45);

    const result = resolveLifetimeUsage();

    expect(result).toEqual({ lifetimeCost: 8123.45, lifetimeUsageSource: "sessions" });
  });

  it("uses a local session-file estimate when keyInfo is missing", () => {
    vi.spyOn(sessionData, "estimateLifetimeCost").mockReturnValue(123.45);

    const result = resolveLifetimeUsage();

    expect(result).toEqual({ lifetimeCost: 123.45, lifetimeUsageSource: "sessions" });
  });
});
