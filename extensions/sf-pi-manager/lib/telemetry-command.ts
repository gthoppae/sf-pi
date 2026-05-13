/* SPDX-License-Identifier: Apache-2.0 */
/**
 * `/sf-pi telemetry` subcommand — three actions: status, on, off.
 *
 * Reads the live state from lib/common/privacy/state.ts and writes the
 * pi setting (and our assertion record) via lib/common/privacy/assert-default.ts.
 *
 * Scope: sf-pi only ever touches pi's *global* settings.json key
 * `enableInstallTelemetry`. Project-scoped settings stay untouched —
 * install telemetry is per-machine, not per-project.
 *
 * The handler is intentionally narrow: it does NOT touch
 *  - PI_SKIP_VERSION_CHECK
 *  - PI_OFFLINE / PI_TELEMETRY env vars or shell rc files
 *  - any other pi setting
 */
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  PI_TELEMETRY_SETTING_KEY,
  getTelemetryState,
  piSettingsPath,
  telemetryAssertionPath,
  type TelemetryState,
} from "../../../lib/common/privacy/state.ts";
import { setUserTelemetryChoice } from "../../../lib/common/privacy/assert-default.ts";

export type TelemetrySubAction = "status" | "on" | "off";

export interface TelemetryCommandArgs {
  action: TelemetrySubAction;
}

/** Parse the tail after `/sf-pi telemetry`. Defaults to "status". */
export function parseTelemetryArgs(rest: string): TelemetryCommandArgs {
  const token = rest.trim().toLowerCase();
  if (token === "on" || token === "enable") return { action: "on" };
  if (token === "off" || token === "disable") return { action: "off" };
  return { action: "status" };
}

export async function handleTelemetry(
  ctx: ExtensionCommandContext,
  args: TelemetryCommandArgs,
  packageVersion: string,
): Promise<void> {
  if (args.action === "status") {
    ctx.ui.notify(formatStatus(getTelemetryState()), "info");
    return;
  }
  if (args.action === "on") {
    const ok = setUserTelemetryChoice(true, { sfPiVersion: packageVersion });
    if (!ok) {
      ctx.ui.notify("Failed to write pi settings.json. See ~/.pi/agent/settings.json.", "warning");
      return;
    }
    ctx.ui.notify(
      [
        "Pi anonymous install/update telemetry: ON (user override).",
        "sf-pi will not re-assert the default unless you clear the setting again.",
        "",
        formatStatus(getTelemetryState()),
      ].join("\n"),
      "info",
    );
    return;
  }
  // action === "off"
  const ok = setUserTelemetryChoice(false, { sfPiVersion: packageVersion });
  if (!ok) {
    ctx.ui.notify("Failed to write pi settings.json. See ~/.pi/agent/settings.json.", "warning");
    return;
  }
  ctx.ui.notify(
    ["Pi anonymous install/update telemetry: OFF.", "", formatStatus(getTelemetryState())].join(
      "\n",
    ),
    "info",
  );
}

/** Format the current state as a multi-line, paste-friendly status block. */
export function formatStatus(state: TelemetryState): string {
  const status = state.effectivelyEnabled ? "on" : "off";
  const sourceLabel =
    state.source === "sf-pi-default"
      ? "sf-pi default"
      : state.source === "user-override"
        ? "user override"
        : "unset (pi default)";
  const piEnv = process.env.PI_TELEMETRY;
  const envHint =
    piEnv === "1" || piEnv === "true" || piEnv === "yes"
      ? "  PI_TELEMETRY=1 in your shell forces telemetry ON at runtime regardless of settings.json. Unset it to honor saved settings."
      : piEnv === "0" || piEnv === "false" || piEnv === "no"
        ? "  PI_TELEMETRY=0 in your shell forces telemetry OFF at runtime, agreeing with the saved setting."
        : "";

  const lines = [
    `Telemetry: ${status} (${sourceLabel})`,
    `  pi setting:    ${PI_TELEMETRY_SETTING_KEY} = ${
      state.piValue === undefined ? "<unset>" : state.piValue
    }`,
    `  Source file:   ${piSettingsPath()}`,
  ];
  if (state.assertedAt) {
    lines.push(`  Asserted at:   ${state.assertedAt}`);
    lines.push(`  Audit record:  ${telemetryAssertionPath()}`);
  }
  lines.push(
    "",
    "What this controls:",
    "  - Anonymous install/update version ping to https://pi.dev/api/report-install",
    "",
    "What this does NOT control (intentional, out of scope):",
    "  - Update-version probe (PI_SKIP_VERSION_CHECK=1 to disable)",
    "  - LLM provider traffic (always user-configured)",
    "  - PI_OFFLINE / PI_TELEMETRY env vars (we don't touch your shell rc)",
  );
  if (envHint) lines.push("", envHint);
  return lines.join("\n");
}
