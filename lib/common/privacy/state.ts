/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Pure helpers for the sf-pi telemetry default.
 *
 * sf-pi opts users out of pi's anonymous install/update telemetry by
 * default — see lib/common/privacy/assert-default.ts for the writer.
 * This module is the read-side: it combines pi's `enableInstallTelemetry`
 * setting with sf-pi's own assertion record (under
 * `<globalAgentDir>/sf-pi/privacy/telemetry-default.json`) so consumers
 * (sf-welcome splash row, /sf-pi telemetry status) can describe the
 * current state and its source without re-deriving the logic.
 *
 * pi's contract: `enableInstallTelemetry` defaults to enabled when
 * missing. We write `false` when the key is unset and remember that we
 * did, so we can distinguish "off because sf-pi opted you out" from
 * "off because the user explicitly opted out."
 */
import { readJsonFile } from "../sf-pi-settings.ts";
import { globalSettingsPath } from "../pi-paths.ts";
import { createStateStore, type StateStore } from "../state-store.ts";

/** pi setting key that controls the anonymous install/update version ping. */
export const PI_TELEMETRY_SETTING_KEY = "enableInstallTelemetry";

/** Internal state-store layout for sf-pi's assertion record. */
const NAMESPACE = "privacy";
const FILENAME = "telemetry-default.json";
const SCHEMA_VERSION = 1;

/**
 * On-disk record that sf-pi wrote the telemetry default for this user.
 *
 * Presence + matching `assertedValue === piValue` is what distinguishes
 * "sf-pi default" from "user override." Absent record means we never
 * touched the setting (or the user has since cleared it explicitly).
 */
export interface TelemetryAssertion {
  assertedAt: string;
  assertedValue: boolean;
  /** sf-pi version that performed the assertion. Useful for debugging
   *  upgrade paths but not used by the decision logic. */
  sfPiVersion?: string;
}

const EMPTY_ASSERTION: TelemetryAssertion = {
  assertedAt: "",
  assertedValue: false,
};

function buildAssertionStore(): StateStore<TelemetryAssertion> {
  return createStateStore<TelemetryAssertion>({
    namespace: NAMESPACE,
    filename: FILENAME,
    schemaVersion: SCHEMA_VERSION,
    defaults: { ...EMPTY_ASSERTION },
  });
}

/** Read the assertion record. Empty record means "no assertion yet." */
export function readTelemetryAssertion(): TelemetryAssertion {
  try {
    return buildAssertionStore().read();
  } catch {
    return { ...EMPTY_ASSERTION };
  }
}

/** Write/replace the assertion record. Best-effort. */
export function writeTelemetryAssertion(record: TelemetryAssertion): void {
  try {
    buildAssertionStore().write(record);
  } catch {
    // Best-effort — telemetry default should never crash a session.
  }
}

/** Clear the assertion record (used when the user explicitly opts back in). */
export function clearTelemetryAssertion(): void {
  writeTelemetryAssertion({ ...EMPTY_ASSERTION });
}

/** Path to the assertion record on disk — exposed so /sf-pi telemetry status
 *  can show users where the audit trail lives. */
export function telemetryAssertionPath(): string {
  return buildAssertionStore().path;
}

/** Path to pi's global settings file the setting lives in. */
export function piSettingsPath(): string {
  return globalSettingsPath();
}

/** Read pi's `enableInstallTelemetry` raw value. Returns undefined when
 *  the key is missing. Booleans stay booleans; anything else is treated
 *  as "missing" so a malformed value falls back to pi's documented
 *  default (telemetry on). */
export function readPiTelemetryValue(pathOverride?: string): boolean | undefined {
  const settingsPath = pathOverride ?? globalSettingsPath();
  const settings = readJsonFile(settingsPath);
  const raw = settings[PI_TELEMETRY_SETTING_KEY];
  return typeof raw === "boolean" ? raw : undefined;
}

/** Where the current telemetry posture came from. */
export type TelemetrySource = "sf-pi-default" | "user-override" | "unset";

export interface TelemetryState {
  /**
   * Effective pi setting value. `undefined` means the key is missing
   * (which pi treats as "telemetry on"). On a healthy sf-pi install
   * this is `false` after `assertTelemetryDefault()` runs once.
   */
  piValue: boolean | undefined;
  /**
   * Whether pi will currently send the anonymous install/update ping.
   * Convenience: `piValue === false` → false, otherwise true.
   */
  effectivelyEnabled: boolean;
  /**
   * Source of the current value:
   *   - "sf-pi-default" → we wrote `false` and our assertion still matches.
   *   - "user-override" → user changed it (true OR false) without us.
   *   - "unset"         → pi setting is missing AND we have no record
   *                        (transient state right before assertTelemetryDefault).
   */
  source: TelemetrySource;
  /** ISO timestamp when sf-pi asserted the default, when applicable. */
  assertedAt?: string;
}

/**
 * Combine pi's setting + sf-pi's assertion record into a stable state
 * object. Pure — no I/O outside the two reads.
 *
 * Decision matrix (matches the proposal):
 *
 *   pi setting  | assertion | matches?  | source
 *   ------------|-----------|-----------|----------------
 *   undefined   | any       | n/a       | unset
 *   false       | empty     | n/a       | user-override
 *   false       | false     | yes       | sf-pi-default
 *   false       | true      | no        | user-override (stale record)
 *   true        | any       | n/a       | user-override
 */
export function getTelemetryState(): TelemetryState {
  const piValue = readPiTelemetryValue();
  const assertion = readTelemetryAssertion();
  const hasAssertion = assertion.assertedAt !== "";

  if (piValue === undefined) {
    return {
      piValue: undefined,
      effectivelyEnabled: true,
      source: "unset",
    };
  }

  if (piValue === false && hasAssertion && assertion.assertedValue === false) {
    return {
      piValue: false,
      effectivelyEnabled: false,
      source: "sf-pi-default",
      assertedAt: assertion.assertedAt,
    };
  }

  return {
    piValue,
    effectivelyEnabled: piValue === true,
    source: "user-override",
    ...(hasAssertion ? { assertedAt: assertion.assertedAt } : {}),
  };
}
