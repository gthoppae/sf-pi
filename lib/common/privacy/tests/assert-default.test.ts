/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the assertTelemetryDefault writer.
 *
 * Same tmp-dir + PI_AGENT_DIR override pattern as state.test.ts so each
 * test owns its own pi settings.json + assertion record without leaking
 * into the user's real ~/.pi.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertTelemetryDefault, setUserTelemetryChoice } from "../assert-default.ts";
import {
  PI_TELEMETRY_SETTING_KEY,
  clearTelemetryAssertion,
  readPiTelemetryValue,
  readTelemetryAssertion,
} from "../state.ts";

// Pi's getAgentDir() reads from PI_CODING_AGENT_DIR.
const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";

let tmpDir: string;
let prevAgentDir: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-privacy-assert-"));
  prevAgentDir = process.env[PI_AGENT_ENV];
  process.env[PI_AGENT_ENV] = tmpDir;
});

afterEach(() => {
  if (prevAgentDir === undefined) delete process.env[PI_AGENT_ENV];
  else process.env[PI_AGENT_ENV] = prevAgentDir;
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function writePiSettings(content: Record<string, unknown>): void {
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(path.join(tmpDir, "settings.json"), JSON.stringify(content, null, 2));
}

function readPiSettings(): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(tmpDir, "settings.json"), "utf8"));
}

describe("assertTelemetryDefault — first run", () => {
  it("writes false + records assertion + asks for notice when pi setting is missing", () => {
    // No settings file at all (most common first-install case)
    const result = assertTelemetryDefault({ sfPiVersion: "1.2.3" });
    expect(result.outcome).toBe("asserted");
    expect(result.piValue).toBe(false);
    expect(result.shouldNotify).toBe(true);
    expect(readPiTelemetryValue()).toBe(false);
    const assertion = readTelemetryAssertion();
    expect(assertion.assertedValue).toBe(false);
    expect(assertion.assertedAt).toBeTruthy();
    expect(assertion.sfPiVersion).toBe("1.2.3");
  });

  it("preserves other keys in settings.json when writing", () => {
    writePiSettings({ defaultProvider: "anthropic", quietStartup: true });
    assertTelemetryDefault();
    const settings = readPiSettings();
    expect(settings.defaultProvider).toBe("anthropic");
    expect(settings.quietStartup).toBe(true);
    expect(settings[PI_TELEMETRY_SETTING_KEY]).toBe(false);
  });
});

describe("assertTelemetryDefault — already off", () => {
  it("returns already-off when pi=false AND assertion matches (no notice)", () => {
    writePiSettings({ [PI_TELEMETRY_SETTING_KEY]: false });
    // Run once to seed the assertion.
    const first = assertTelemetryDefault();
    expect(first.outcome).toBe("refreshed");

    // Second run is a true no-op.
    const second = assertTelemetryDefault();
    expect(second.outcome).toBe("already-off");
    expect(second.shouldNotify).toBe(false);
  });

  it("returns refreshed when pi=false but no assertion record (silent)", () => {
    writePiSettings({ [PI_TELEMETRY_SETTING_KEY]: false });
    clearTelemetryAssertion();
    const result = assertTelemetryDefault();
    expect(result.outcome).toBe("refreshed");
    expect(result.shouldNotify).toBe(false);
    expect(readTelemetryAssertion().assertedAt).toBeTruthy();
  });
});

describe("assertTelemetryDefault — user opted in", () => {
  it("respects pi=true and clears stale assertion (silent)", () => {
    writePiSettings({ [PI_TELEMETRY_SETTING_KEY]: true });
    // Pre-existing stale assertion record.
    const result = assertTelemetryDefault();
    expect(result.outcome).toBe("user-on");
    expect(result.piValue).toBe(true);
    expect(result.shouldNotify).toBe(false);
    expect(readPiTelemetryValue()).toBe(true);
    expect(readTelemetryAssertion().assertedAt).toBe("");
  });

  it("never overwrites pi=true on subsequent runs", () => {
    writePiSettings({ [PI_TELEMETRY_SETTING_KEY]: true });
    assertTelemetryDefault();
    assertTelemetryDefault();
    assertTelemetryDefault();
    expect(readPiTelemetryValue()).toBe(true);
  });
});

describe("setUserTelemetryChoice", () => {
  it("writes false and records sf-pi-style assertion when user opts out", () => {
    const ok = setUserTelemetryChoice(false, { sfPiVersion: "1.2.3" });
    expect(ok).toBe(true);
    expect(readPiTelemetryValue()).toBe(false);
    expect(readTelemetryAssertion().assertedValue).toBe(false);
  });

  it("writes true and clears assertion when user opts in", () => {
    // Seed a prior sf-pi default first.
    assertTelemetryDefault();
    expect(readTelemetryAssertion().assertedAt).toBeTruthy();

    const ok = setUserTelemetryChoice(true);
    expect(ok).toBe(true);
    expect(readPiTelemetryValue()).toBe(true);
    expect(readTelemetryAssertion().assertedAt).toBe("");
  });

  it("preserves unrelated settings keys", () => {
    writePiSettings({ thinkingLevel: "high" });
    setUserTelemetryChoice(false);
    const settings = readPiSettings();
    expect(settings.thinkingLevel).toBe("high");
    expect(settings[PI_TELEMETRY_SETTING_KEY]).toBe(false);
  });
});
