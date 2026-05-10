/* SPDX-License-Identifier: Apache-2.0 */
/**
 * `/sf-agentscript` command renderer.
 *
 * Produces the doctor report (SDK load status, vendored bundle path, dialect
 * probe) and a usage hint when the user passes an unknown subcommand.
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { access, constants } from "node:fs/promises";
import type { ExtensionDoctorReport } from "../../../lib/common/doctor/registry.ts";
import { loadAgentforceSDK, VENDORED_SDK_PATH } from "./sdk.ts";
import { probeSfapReadiness, type SfapReadinessReport } from "./sfap-readiness.ts";

// -------------------------------------------------------------------------------------------------
// Status shape
// -------------------------------------------------------------------------------------------------

export interface DoctorStatus {
  sdkLoaded: boolean;
  vendoredSdkPath: string;
  dialectsProbed: string[];
  loadError?: string;
  upstreamNote: string;
  /** P7 additions — health checks beyond "SDK loaded". */
  salesforceCoreResolved: boolean;
  salesforceCoreVersion?: string;
  sfdxAgentsWritable: boolean;
  sfdxAgentsPath: string;
  sfapReadiness?: SfapReadinessReport;
}

// -------------------------------------------------------------------------------------------------
// Probe
// -------------------------------------------------------------------------------------------------

export async function probeDoctor(cwd: string, targetOrg?: string): Promise<DoctorStatus> {
  const sdk = await loadAgentforceSDK();

  const dialectsProbed: string[] = [];
  let loadError: string | undefined;
  let sdkLoaded = false;

  if (sdk) {
    sdkLoaded = true;
    try {
      const resolved = sdk.resolveDialect("", { dialects: [sdk.agentforceDialect] });
      dialectsProbed.push(resolved.dialect.name);
    } catch (error) {
      loadError = `Dialect probe threw: ${error instanceof Error ? error.message : String(error)}`;
      sdkLoaded = false;
    }
  } else {
    loadError = "Vendored SDK failed to import.";
  }

  // Source the upstream pin from the committed UPSTREAM.md so the doctor
  // report shows the same commit CI synced.
  let upstreamNote = "Pinned via scripts/sync-agentforce-sdk.mjs";
  try {
    const upstreamMdPath = path.join(path.dirname(VENDORED_SDK_PATH), "UPSTREAM.md");
    const fs = await import("node:fs/promises");
    const contents = await fs.readFile(upstreamMdPath, "utf8");
    const commitLine = contents.match(/^- Commit: `([^`]+)`/m);
    const versionLine = contents.match(/^- Package version: `([^`]+)`/m);
    if (commitLine && versionLine) {
      upstreamNote = `${versionLine[1]} @ ${commitLine[1].slice(0, 10)}`;
    }
  } catch {
    // Ignore — we just fall back to the default note.
  }

  // P7: @salesforce/core resolves?
  let salesforceCoreResolved = false;
  let salesforceCoreVersion: string | undefined;
  try {
    // Use a dynamic import so a missing dep doesn't fail the whole probe.
    const core = await import("@salesforce/core");
    salesforceCoreResolved = typeof core.Org?.create === "function";
    try {
      const fs = await import("node:fs/promises");
      const pkgPath = await import.meta.resolve?.("@salesforce/core/package.json");
      if (pkgPath) {
        const url = new URL(pkgPath);
        const raw = await fs.readFile(url.pathname, "utf8");
        const parsed = JSON.parse(raw) as { version?: string };
        salesforceCoreVersion = parsed.version;
      }
    } catch {
      /* version is best-effort */
    }
  } catch {
    /* dep missing */
  }

  // P7: .sfdx/agents/ writable? Create the dir if missing (it's our session
  // store target). sf-guardrail allows it via the carve-out.
  const sfdxAgentsPath = path.join(cwd, ".sfdx", "agents");
  let sfdxAgentsWritable: boolean;
  try {
    const fs = await import("node:fs/promises");
    if (!existsSync(sfdxAgentsPath)) {
      await fs.mkdir(sfdxAgentsPath, { recursive: true });
    }
    await access(sfdxAgentsPath, constants.W_OK);
    sfdxAgentsWritable = true;
  } catch {
    sfdxAgentsWritable = false;
  }

  let sfapReadiness: SfapReadinessReport | undefined;
  if (targetOrg) {
    try {
      sfapReadiness = await probeSfapReadiness(targetOrg);
    } catch {
      // Keep the core doctor useful even when the org readiness probe fails.
    }
  }

  return {
    sdkLoaded,
    vendoredSdkPath: VENDORED_SDK_PATH,
    dialectsProbed,
    loadError,
    upstreamNote,
    salesforceCoreResolved,
    salesforceCoreVersion,
    sfdxAgentsWritable,
    sfdxAgentsPath,
    sfapReadiness,
  };
}

// -------------------------------------------------------------------------------------------------
// Rendering
// -------------------------------------------------------------------------------------------------

/**
 * Adapter for the shared `/sf-pi doctor` aggregator. Returns the same
 * underlying probe as the standalone `/sf-agentscript doctor` view,
 * shaped into per-check rows so the manager can render them next to other
 * extensions' diagnostics.
 */
export async function runExtensionDoctor(cwd: string): Promise<ExtensionDoctorReport> {
  const status = await probeDoctor(cwd);
  const checks: ExtensionDoctorReport["checks"] = [];

  if (status.sdkLoaded) {
    checks.push({
      id: "agentscript.sdk-loaded",
      severity: "ok",
      title: `Vendored Agent Script SDK loaded (${status.upstreamNote})`,
      detail: `source: ${status.vendoredSdkPath}`,
    });
    if (status.dialectsProbed.length > 0) {
      checks.push({
        id: "agentscript.dialects-probed",
        severity: "ok",
        title: "Dialect probe succeeded",
        detail: status.dialectsProbed.join(", "),
      });
    }
  } else {
    checks.push({
      id: "agentscript.sdk-load-failed",
      severity: "error",
      title: "Vendored Agent Script SDK failed to load",
      detail: status.loadError ?? "Unknown SDK load failure",
      fix: "Re-run scripts/sync-agentforce-sdk.mjs or reinstall sf-pi.",
    });
  }

  if (status.salesforceCoreResolved) {
    checks.push({
      id: "agentscript.salesforce-core",
      severity: "ok",
      title: `@salesforce/core resolved${status.salesforceCoreVersion ? ` (v${status.salesforceCoreVersion})` : ""}`,
      detail: "Connection.request transport active.",
    });
  } else {
    checks.push({
      id: "agentscript.salesforce-core",
      severity: "error",
      title: "@salesforce/core not resolvable",
      detail: "Eval, trace, and preview tools require @salesforce/core.",
      fix: "Run `npm install` at the repo root.",
    });
  }

  if (status.sfdxAgentsWritable) {
    checks.push({
      id: "agentscript.sfdx-agents-writable",
      severity: "ok",
      title: ".sfdx/agents/ is writable",
      detail: status.sfdxAgentsPath,
    });
  } else {
    checks.push({
      id: "agentscript.sfdx-agents-writable",
      severity: "warn",
      title: ".sfdx/agents/ is not writable",
      detail: status.sfdxAgentsPath,
      fix: "Confirm sf-guardrail allows .sfdx/agents/** (carve-out) and the directory is not read-only.",
    });
  }

  const errorCount = checks.filter((c) => c.severity === "error").length;
  const summary = errorCount === 0 ? "\u2713 Healthy" : `\u2717 ${errorCount} issue(s)`;

  return { extensionId: "sf-agentscript", title: "SF Agent Script", checks, summary };
}

export function renderDoctorReport(status: DoctorStatus): string {
  const lines = ["SF Agent Script — doctor", ""];

  if (status.sdkLoaded) {
    lines.push(`✅ SDK: loaded (${status.upstreamNote})`);
    lines.push(`   source: ${status.vendoredSdkPath}`);
    if (status.dialectsProbed.length > 0) {
      lines.push(`   dialects: ${status.dialectsProbed.join(", ")}`);
    }
  } else {
    lines.push(`❌ SDK: not loaded`);
    lines.push(`   source: ${status.vendoredSdkPath}`);
    if (status.loadError) lines.push(`   reason: ${status.loadError}`);
    lines.push(`   tip: re-run scripts/sync-agentforce-sdk.mjs or reinstall sf-pi.`);
  }

  if (status.salesforceCoreResolved) {
    lines.push(
      `✅ @salesforce/core: resolved${status.salesforceCoreVersion ? ` (v${status.salesforceCoreVersion})` : ""}`,
    );
  } else {
    lines.push(`❌ @salesforce/core: not resolvable — run \`npm install\``);
  }

  lines.push(
    status.sfdxAgentsWritable
      ? `✅ .sfdx/agents/: writable`
      : `⚠️  .sfdx/agents/: not writable (preview sessions will fail) — ${status.sfdxAgentsPath}`,
  );

  if (status.sfapReadiness) {
    const r = status.sfapReadiness;
    lines.push("", `SFAP readiness (${r.target_org}):`);
    lines.push(renderSfapProbe("Named-user JWT", r.named_user_jwt));
    lines.push(renderSfapProbe("Evaluation API", r.eval_api));
    lines.push(renderSfapProbe("AI Agent authoring", r.authoring_api));
    lines.push(renderSfapProbe("AI Agent preview", r.preview_api));
    lines.push(
      "   note: /einstein/evaluation/* and /einstein/ai-agent/* are separately gated route families.",
    );
  }

  return lines.join("\n");
}

function renderSfapProbe(
  label: string,
  probe: { status: string; detail: string; http_status?: number },
): string {
  const icon =
    probe.status === "ok" || probe.status === "reachable"
      ? "✅"
      : probe.status === "skipped"
        ? "⏭️"
        : "⚠️";
  const http = probe.http_status ? ` HTTP ${probe.http_status}` : "";
  return `${icon} ${label}:${http} ${probe.detail}`;
}
