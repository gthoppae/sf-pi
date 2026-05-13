/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Writer for sf-pi's telemetry-off-by-default policy.
 *
 * Behavior on every sf-pi session_start:
 *
 *   pi enableInstallTelemetry | action
 *   --------------------------|------------------------------------------------
 *   undefined (missing)       | write `false`, record assertion, return "asserted"
 *   false                     | no-op (return "already-off")
 *   true                      | no-op, but clear stale assertion (return "user-on")
 *
 * Never overwrites an explicit user choice. Out-of-scope by design:
 *   - PI_SKIP_VERSION_CHECK / PI_VERSION (version checks stay enabled)
 *   - PI_OFFLINE / PI_TELEMETRY env vars (we don't touch the user's shell)
 *   - Project-scoped .pi/settings.json (install telemetry is per-machine)
 *
 * The function is idempotent and best-effort: if any FS step fails, we
 * fall back to logging to stderr (when verbose) and return without
 * crashing the session.
 */
import { readJsonFile, writeJsonFile } from "../sf-pi-settings.ts";
import { globalSettingsPath } from "../pi-paths.ts";
import {
  PI_TELEMETRY_SETTING_KEY,
  clearTelemetryAssertion,
  readPiTelemetryValue,
  readTelemetryAssertion,
  writeTelemetryAssertion,
} from "./state.ts";

export type AssertOutcome =
  /** sf-pi wrote `false` for the first time (or the user previously
   *  cleared the setting and we re-asserted). The caller should emit a
   *  one-time notice. */
  | "asserted"
  /** Already off and our assertion matches. No-op, no notice. */
  | "already-off"
  /** Already off but the assertion is stale (different timestamp/value
   *  shape). We refreshed the assertion. No notice. */
  | "refreshed"
  /** User explicitly opted in (`true`). We left it alone and cleared any
   *  stale assertion record. No notice. */
  | "user-on"
  /** Anything that throws ends here. No notice. */
  | "error";

export interface AssertOptions {
  /** Override the global settings.json path (used in tests). */
  settingsPathOverride?: string;
  /** Stamped into the assertion record for debugging. */
  sfPiVersion?: string;
}

export interface AssertResult {
  outcome: AssertOutcome;
  /** Final pi setting value after assertion. Undefined only on "error". */
  piValue?: boolean;
  /** True when the caller should emit the one-time user-facing notice. */
  shouldNotify: boolean;
}

/**
 * Idempotent "default to off" assertion. Safe to call from session_start
 * on every session — no-ops after the first time.
 */
export function assertTelemetryDefault(options: AssertOptions = {}): AssertResult {
  const settingsPath = options.settingsPathOverride ?? globalSettingsPath();

  let piValue: boolean | undefined;
  try {
    piValue = readPiTelemetryValue(settingsPath);
  } catch {
    return { outcome: "error", shouldNotify: false };
  }

  // Branch 1: pi setting is missing → flip to false + record assertion.
  if (piValue === undefined) {
    const wrote = writeFalse(settingsPath);
    if (!wrote) return { outcome: "error", shouldNotify: false };
    writeTelemetryAssertion({
      assertedAt: new Date().toISOString(),
      assertedValue: false,
      ...(options.sfPiVersion ? { sfPiVersion: options.sfPiVersion } : {}),
    });
    return { outcome: "asserted", piValue: false, shouldNotify: true };
  }

  // Branch 2: user has telemetry on. Respect that. Clear any stale
  // assertion so the splash row reads "on (user override)" without the
  // "asserted at …" artifact.
  if (piValue === true) {
    const assertion = readTelemetryAssertion();
    if (assertion.assertedAt !== "") {
      clearTelemetryAssertion();
    }
    return { outcome: "user-on", piValue: true, shouldNotify: false };
  }

  // Branch 3: pi setting is already false. Make sure our assertion
  // record matches reality so the splash row labels it correctly.
  const assertion = readTelemetryAssertion();
  const matches = assertion.assertedAt !== "" && assertion.assertedValue === false;
  if (matches) {
    return { outcome: "already-off", piValue: false, shouldNotify: false };
  }
  // pi value is false but we have no record (or a stale one). Don't
  // emit a notice — the user already had it off — but stamp the
  // assertion so subsequent reads describe the source as "sf-pi default"
  // since we now own it. Treat refresh as silent.
  writeTelemetryAssertion({
    assertedAt: new Date().toISOString(),
    assertedValue: false,
    ...(options.sfPiVersion ? { sfPiVersion: options.sfPiVersion } : {}),
  });
  return { outcome: "refreshed", piValue: false, shouldNotify: false };
}

/** Write `enableInstallTelemetry: false` into pi's global settings.json. */
function writeFalse(settingsPath: string): boolean {
  try {
    const settings = readJsonFile(settingsPath);
    settings[PI_TELEMETRY_SETTING_KEY] = false;
    writeJsonFile(settingsPath, settings);
    return true;
  } catch {
    return false;
  }
}

/**
 * Explicit user-driven write. Used by `/sf-pi telemetry on|off`.
 *
 * Difference vs assertTelemetryDefault:
 *   - Always writes the requested value (no respect-existing branch).
 *   - Updates the assertion record only when writing `false`; clears it
 *     when writing `true` so the splash labels the user as the source.
 *
 * Returns true on successful write, false on FS failure.
 */
export function setUserTelemetryChoice(enabled: boolean, options: AssertOptions = {}): boolean {
  const settingsPath = options.settingsPathOverride ?? globalSettingsPath();
  try {
    const settings = readJsonFile(settingsPath);
    settings[PI_TELEMETRY_SETTING_KEY] = enabled;
    writeJsonFile(settingsPath, settings);
  } catch {
    return false;
  }
  if (enabled) {
    clearTelemetryAssertion();
  } else {
    // User opted out by hand. Still treat it as a sf-pi-default-style
    // record — the splash will label it as such, which is fine: telemetry
    // is off, that's all the user cares about.
    writeTelemetryAssertion({
      assertedAt: new Date().toISOString(),
      assertedValue: false,
      ...(options.sfPiVersion ? { sfPiVersion: options.sfPiVersion } : {}),
    });
  }
  return true;
}
