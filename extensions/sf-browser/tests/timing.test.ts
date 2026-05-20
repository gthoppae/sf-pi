/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for SF Browser duration formatting. */
import { describe, expect, it } from "vitest";
import { formatDuration } from "../lib/timing.ts";

describe("timing", () => {
  it("formats short and long durations for user-visible output", () => {
    expect(formatDuration(42)).toBe("42ms");
    expect(formatDuration(1_250)).toBe("1.25s");
    expect(formatDuration(12_300)).toBe("12.3s");
    expect(formatDuration(61_000)).toBe("1m 1s");
  });
});
