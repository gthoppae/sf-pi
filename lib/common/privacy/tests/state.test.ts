/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for lib/common/privacy/state.ts — the read-side helpers that
 * combine pi's setting with sf-pi's assertion record.
 *
 * The state-store helpers always read from a canonical path under
 * <globalAgentDir>. We point getAgentDir() at a per-test tmp dir so each
 * test can write its own pi settings.json AND assertion record without
 * polluting the user's real ~/.pi.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PI_TELEMETRY_SETTING_KEY,
  clearTelemetryAssertion,
  getTelemetryState,
  readPiTelemetryValue,
  readTelemetryAssertion,
  writeTelemetryAssertion,
} from "../state.ts";

// Pi's getAgentDir() honors PI_CODING_AGENT_DIR — see
// node_modules/@earendil-works/pi-coding-agent/dist/config.js:getAgentDir.
const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";

let tmpDir: string;
let prevAgentDir: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-privacy-"));
  prevAgentDir = process.env[PI_AGENT_ENV];
  process.env[PI_AGENT_ENV] = tmpDir;
});

afterEach(() => {
  if (prevAgentDir === undefined) delete process.env[PI_AGENT_ENV];
  else process.env[PI_AGENT_ENV] = prevAgentDir;
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // tmp cleanup is best-effort
  }
});

function writePiSettings(value: unknown): void {
  mkdirSync(tmpDir, { recursive: true });
  const settingsPath = path.join(tmpDir, "settings.json");
  // value === "missing" sentinel means write {} with no key
  if (value === "missing") {
    writeFileSync(settingsPath, JSON.stringify({}));
    return;
  }
  writeFileSync(settingsPath, JSON.stringify({ [PI_TELEMETRY_SETTING_KEY]: value }, null, 2));
}

describe("readPiTelemetryValue", () => {
  it("returns undefined when settings file is missing", () => {
    expect(readPiTelemetryValue()).toBeUndefined();
  });

  it("returns undefined when key is missing", () => {
    writePiSettings("missing");
    expect(readPiTelemetryValue()).toBeUndefined();
  });

  it("returns true when set to true", () => {
    writePiSettings(true);
    expect(readPiTelemetryValue()).toBe(true);
  });

  it("returns false when set to false", () => {
    writePiSettings(false);
    expect(readPiTelemetryValue()).toBe(false);
  });

  it("returns undefined when value is non-boolean (malformed)", () => {
    writePiSettings("yes");
    expect(readPiTelemetryValue()).toBeUndefined();
  });
});

describe("getTelemetryState", () => {
  it("source=unset when pi setting is missing", () => {
    const state = getTelemetryState();
    expect(state.piValue).toBeUndefined();
    expect(state.effectivelyEnabled).toBe(true);
    expect(state.source).toBe("unset");
  });

  it("source=sf-pi-default when pi=false AND assertion matches", () => {
    writePiSettings(false);
    writeTelemetryAssertion({ assertedAt: new Date().toISOString(), assertedValue: false });
    const state = getTelemetryState();
    expect(state.piValue).toBe(false);
    expect(state.effectivelyEnabled).toBe(false);
    expect(state.source).toBe("sf-pi-default");
    expect(state.assertedAt).toBeTruthy();
  });

  it("source=user-override when pi=false AND no assertion", () => {
    writePiSettings(false);
    clearTelemetryAssertion();
    const state = getTelemetryState();
    expect(state.piValue).toBe(false);
    expect(state.effectivelyEnabled).toBe(false);
    expect(state.source).toBe("user-override");
  });

  it("source=user-override when pi=true even with assertion record", () => {
    writePiSettings(true);
    writeTelemetryAssertion({ assertedAt: new Date().toISOString(), assertedValue: false });
    const state = getTelemetryState();
    expect(state.piValue).toBe(true);
    expect(state.effectivelyEnabled).toBe(true);
    expect(state.source).toBe("user-override");
  });

  it("source=user-override when pi=false AND assertion records true (mismatch)", () => {
    writePiSettings(false);
    writeTelemetryAssertion({ assertedAt: new Date().toISOString(), assertedValue: true });
    const state = getTelemetryState();
    expect(state.source).toBe("user-override");
  });
});

describe("writeTelemetryAssertion / readTelemetryAssertion", () => {
  it("round-trips a record", () => {
    const stamp = new Date().toISOString();
    writeTelemetryAssertion({
      assertedAt: stamp,
      assertedValue: false,
      sfPiVersion: "9.9.9",
    });
    const back = readTelemetryAssertion();
    expect(back.assertedAt).toBe(stamp);
    expect(back.assertedValue).toBe(false);
    expect(back.sfPiVersion).toBe("9.9.9");
  });

  it("returns empty record before first write", () => {
    const empty = readTelemetryAssertion();
    expect(empty.assertedAt).toBe("");
  });

  it("clearTelemetryAssertion empties the record", () => {
    writeTelemetryAssertion({ assertedAt: new Date().toISOString(), assertedValue: false });
    clearTelemetryAssertion();
    expect(readTelemetryAssertion().assertedAt).toBe("");
  });
});
