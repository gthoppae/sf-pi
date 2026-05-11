/* SPDX-License-Identifier: Apache-2.0 */
/** Unit tests for the shared boot-timing collector. */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __getBootTimingForTests,
  __resetBootTimingForTests,
  flushBootTiming,
  markBootStep,
  markBootStepSync,
} from "../boot-timing.ts";

const originalFlag = process.env.SF_PI_BOOT_TIMING;

afterEach(() => {
  if (originalFlag === undefined) delete process.env.SF_PI_BOOT_TIMING;
  else process.env.SF_PI_BOOT_TIMING = originalFlag;
  __resetBootTimingForTests();
  vi.restoreAllMocks();
});

describe("markBootStep", () => {
  it("returns the wrapped value when telemetry is disabled", async () => {
    delete process.env.SF_PI_BOOT_TIMING;
    __resetBootTimingForTests();
    const result = await markBootStep("noop", () => 42);
    expect(result).toBe(42);
    expect(__getBootTimingForTests()).toEqual([]);
  });

  it("records a step when telemetry is enabled", async () => {
    process.env.SF_PI_BOOT_TIMING = "1";
    __resetBootTimingForTests();
    await markBootStep("test.step", async () => {
      await new Promise((r) => setTimeout(r, 5));
      return "ok";
    });
    const steps = __getBootTimingForTests();
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ name: "test.step", ok: true });
    expect(steps[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("records a failed step but rethrows the error", async () => {
    process.env.SF_PI_BOOT_TIMING = "1";
    __resetBootTimingForTests();
    await expect(
      markBootStep("test.fail", async () => {
        throw new Error("nope");
      }),
    ).rejects.toThrow(/nope/);
    const steps = __getBootTimingForTests();
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ name: "test.fail", ok: false });
    expect(steps[0].errorMessage).toContain("nope");
  });
});

describe("markBootStepSync", () => {
  it("preserves synchronous semantics when telemetry is enabled", () => {
    process.env.SF_PI_BOOT_TIMING = "1";
    __resetBootTimingForTests();
    const value = markBootStepSync("sync.step", () => 7);
    expect(value).toBe(7);
    expect(__getBootTimingForTests()).toHaveLength(1);
  });
});

describe("flushBootTiming", () => {
  it("writes a console.warn report when steps are recorded", () => {
    process.env.SF_PI_BOOT_TIMING = "1";
    __resetBootTimingForTests();
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    markBootStepSync("step.a", () => undefined);
    markBootStepSync("step.b", () => undefined);
    flushBootTiming();
    expect(spy).toHaveBeenCalledOnce();
    const text = spy.mock.calls[0][0] as string;
    expect(text).toContain("[sf-pi boot timing]");
    expect(text).toContain("step.a");
    expect(text).toContain("step.b");
    // Steps are NOT cleared after flush — late-arriving async work would
    // otherwise overwrite the earlier report with just its own row. The
    // collector is reset on session_shutdown / __resetBootTimingForTests.
    expect(__getBootTimingForTests()).toHaveLength(2);
  });

  it("emits a cumulative report when a late step lands after an earlier flush", () => {
    process.env.SF_PI_BOOT_TIMING = "1";
    __resetBootTimingForTests();
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // First burst.
    markBootStepSync("early.a", () => undefined);
    markBootStepSync("early.b", () => undefined);
    flushBootTiming();
    expect(spy.mock.calls[0][0] as string).toContain("early.a");

    // Late-arriving step — simulates a slow network probe completing after
    // the first flush already wrote a report.
    markBootStepSync("late.c", () => undefined);
    flushBootTiming();
    const text = spy.mock.calls[1][0] as string;
    // The cumulative report includes BOTH the earlier rows and the late one.
    expect(text).toContain("early.a");
    expect(text).toContain("early.b");
    expect(text).toContain("late.c");
    expect(text).toContain("3 steps");
  });

  it("is a no-op when telemetry is disabled", () => {
    delete process.env.SF_PI_BOOT_TIMING;
    __resetBootTimingForTests();
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    flushBootTiming();
    expect(spy).not.toHaveBeenCalled();
  });
});
