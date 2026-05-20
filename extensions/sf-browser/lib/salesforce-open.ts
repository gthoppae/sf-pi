/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Salesforce-aware org opening for SF Browser.
 *
 * The only Salesforce operation here is `sf org open --url-only --json`, run
 * after explicit tool/command intent. The session-bearing URL is passed to
 * agent-browser but never echoed back to the model.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildExecFn } from "../../../lib/common/exec-adapter.ts";
import {
  getCachedSfEnvironment,
  getSharedSfEnvironment,
} from "../../../lib/common/sf-environment/shared-runtime.ts";
import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";
import { DEFAULT_SF_OPEN_TIMEOUT_MS } from "./constants.ts";
import { redactText, redactUrl } from "./redaction.ts";
import { formatKnownSetupDestinations, resolveSetupDestination } from "./setup-destinations.ts";

export interface OpenOrgInput {
  target_org?: string;
  path?: string;
  setup?: string;
  purpose?: string;
}

export interface OpenOrgUrlResult {
  targetOrg: string;
  path?: string;
  url: string;
}

export async function resolveOpenOrgUrl(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  input: OpenOrgInput,
  signal?: AbortSignal,
): Promise<OpenOrgUrlResult> {
  const targetOrg = await resolveTargetOrg(pi, ctx, input.target_org);
  if (!targetOrg) {
    throw new Error(
      "No Salesforce target org is configured. Pass target_org or set sf config target-org.",
    );
  }

  const pathValue = resolveOpenPath(input);
  const args = ["org", "open", "--url-only", "--json", "-o", targetOrg];
  if (pathValue) args.push("--path", pathValue);

  const result = await pi.exec("sf", args, {
    cwd: ctx.cwd,
    signal,
    timeout: DEFAULT_SF_OPEN_TIMEOUT_MS,
  });
  if (result.code !== 0) {
    const details = redactText([result.stderr, result.stdout].filter(Boolean).join("\n").trim());
    throw new Error(`sf org open failed for ${targetOrg}.\n${details}`);
  }

  const url = extractUrlFromSfOpen(result.stdout);
  if (!url) throw new Error("sf org open did not return a URL in JSON output.");
  return { targetOrg, path: pathValue, url };
}

export async function resolveTargetOrg(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  explicit?: string,
): Promise<string | undefined> {
  const trimmed = explicit?.trim();
  if (trimmed) return trimmed;

  const cached = getCachedSfEnvironment(ctx.cwd);
  const cachedOrg = orgFromEnv(cached);
  if (cachedOrg) return cachedOrg;

  const env = await getSharedSfEnvironment(buildExecFn(pi, ctx.cwd), ctx.cwd);
  return orgFromEnv(env);
}

export function resolveOpenPath(input: OpenOrgInput): string | undefined {
  if (input.path && input.setup) {
    throw new Error("Pass either path or setup, not both.");
  }
  if (!input.setup) return input.path;
  const pathValue = resolveSetupDestination(input.setup);
  if (pathValue) return pathValue;
  throw new Error(
    `Unknown setup destination ${JSON.stringify(input.setup)}. Known destinations: ${formatKnownSetupDestinations()}`,
  );
}

export function summarizeOpenTarget(targetOrg: string, pathValue: string | undefined): string {
  return [
    `Opened Salesforce org in agent-browser.`,
    `Target org: ${targetOrg}`,
    `Path: ${pathValue || "/"}`,
  ].join("\n");
}

export function redactedOpenUrl(url: string): string {
  return redactUrl(url) ?? "<redacted>";
}

function orgFromEnv(env: SfEnvironment | null): string | undefined {
  return env?.config.targetOrg ?? env?.org.alias ?? env?.org.username;
}

function extractUrlFromSfOpen(stdout: string): string | undefined {
  try {
    const parsed = JSON.parse(stdout) as { result?: unknown };
    const result = parsed.result;
    if (typeof result === "string") return result;
    if (result && typeof result === "object") {
      const candidate = result as Record<string, unknown>;
      for (const key of ["url", "orgUrl", "frontdoorUrl"]) {
        if (typeof candidate[key] === "string") return candidate[key] as string;
      }
    }
  } catch {
    const trimmed = stdout.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  }
  return undefined;
}
