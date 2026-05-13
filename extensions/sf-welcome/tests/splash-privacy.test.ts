/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Verifies the splash's `privacy` row payload reflects the live
 * lib/common/privacy state for all four cases described in
 * the proposal:
 *
 *   pi setting     | assertion record   | row reads
 *   ---------------|--------------------|--------------------------------
 *   undefined      | n/a                | telemetry on (unset)
 *   false          | yes (matching)     | telemetry off (sf-pi default)
 *   false          | no record          | telemetry off (user override)
 *   true           | any                | telemetry on (user override)
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectPrivacyStatus } from "../lib/splash-data.ts";
import {
  PI_TELEMETRY_SETTING_KEY,
  clearTelemetryAssertion,
  writeTelemetryAssertion,
} from "../../../lib/common/privacy/state.ts";

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";

let tmpDir: string;
let prev: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-welcome-privacy-"));
  prev = process.env[PI_AGENT_ENV];
  process.env[PI_AGENT_ENV] = tmpDir;
});

afterEach(() => {
  if (prev === undefined) delete process.env[PI_AGENT_ENV];
  else process.env[PI_AGENT_ENV] = prev;
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function writePiSetting(value: boolean | "missing"): void {
  mkdirSync(tmpDir, { recursive: true });
  const settings = value === "missing" ? {} : { [PI_TELEMETRY_SETTING_KEY]: value };
  writeFileSync(path.join(tmpDir, "settings.json"), JSON.stringify(settings, null, 2));
}

describe("collectPrivacyStatus → splash row payload", () => {
  it("source=unset when pi setting is missing", () => {
    const summary = collectPrivacyStatus();
    expect(summary.telemetryEnabled).toBe(true);
    expect(summary.source).toBe("unset");
  });

  it("source=sf-pi-default when pi=false AND assertion matches", () => {
    writePiSetting(false);
    writeTelemetryAssertion({
      assertedAt: new Date().toISOString(),
      assertedValue: false,
    });
    const summary = collectPrivacyStatus();
    expect(summary.telemetryEnabled).toBe(false);
    expect(summary.source).toBe("sf-pi-default");
  });

  it("source=user-override when pi=false AND no assertion record", () => {
    writePiSetting(false);
    clearTelemetryAssertion();
    const summary = collectPrivacyStatus();
    expect(summary.telemetryEnabled).toBe(false);
    expect(summary.source).toBe("user-override");
  });

  it("source=user-override when pi=true (regardless of assertion)", () => {
    writePiSetting(true);
    writeTelemetryAssertion({
      assertedAt: new Date().toISOString(),
      assertedValue: false,
    });
    const summary = collectPrivacyStatus();
    expect(summary.telemetryEnabled).toBe(true);
    expect(summary.source).toBe("user-override");
  });
});
