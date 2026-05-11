/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Lightweight SF CLI status for the welcome splash.
 *
 * This intentionally checks only the local CLI install + npm-published latest
 * version. Org/config detection belongs to sf-devbar and the shared Salesforce
 * environment runtime, not to the welcome screen.
 *
 * Phase 4 of the @salesforce/core adoption plan replaced the `npm view
 * @salesforce/cli version` subprocess (1–3 s in practice) with a direct
 * fetch to the npm registry. `sf --version` stays — it's the only honest
 * answer to "is sf on PATH?" and it's already fast.
 */
import type { SfCliStatusInfo } from "./types.ts";

export type SfCliExecFn = (
  command: string,
  args: string[],
  options?: { timeout?: number },
) => Promise<{ stdout: string; stderr: string; code: number | null }>;

/** Hook for tests to stub the registry call. Returns the latest version or undefined. */
export type SfCliFetchLatestFn = (signal?: AbortSignal) => Promise<string | undefined>;

const NPM_REGISTRY_LATEST_URL = "https://registry.npmjs.org/@salesforce/cli/latest";
const NPM_REGISTRY_TIMEOUT_MS = 5_000;

export function parseSfCliVersion(output: string): string | undefined {
  const firstToken = output.trim().split(/\s+/)[0];
  if (!firstToken) return undefined;

  const normalized = firstToken.replace(/^@salesforce\/cli\//, "").replace(/^v/, "");
  return normalized || undefined;
}

export function isVersionCurrent(installed: string, latest: string): boolean {
  const parse = (value: string) =>
    value
      .replace(/^v/, "")
      .split(".")
      .map((part) => parseInt(part, 10) || 0);

  const installedParts = parse(installed);
  const latestParts = parse(latest);

  for (let index = 0; index < Math.max(installedParts.length, latestParts.length); index++) {
    const installedPart = installedParts[index] ?? 0;
    const latestPart = latestParts[index] ?? 0;
    if (installedPart > latestPart) return true;
    if (installedPart < latestPart) return false;
  }

  return true;
}

/**
 * Default registry fetcher. Hits `/@salesforce/cli/latest` with a short
 * timeout. Returns undefined on any error so the caller can degrade to
 * `freshness: "unknown"` cleanly.
 */
export async function fetchLatestSfCliVersion(signal?: AbortSignal): Promise<string | undefined> {
  try {
    const timeoutSignal = AbortSignal.timeout(NPM_REGISTRY_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const response = await fetch(NPM_REGISTRY_LATEST_URL, {
      signal: combined,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return undefined;
    const payload = (await response.json()) as { version?: unknown };
    if (typeof payload.version !== "string") return undefined;
    const trimmed = payload.version.trim().replace(/^v/, "");
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}

export async function detectSfCliStatus(
  exec: SfCliExecFn,
  fetchLatest: SfCliFetchLatestFn = fetchLatestSfCliVersion,
): Promise<SfCliStatusInfo> {
  let installedVersion: string | undefined;

  try {
    const versionResult = await exec("sf", ["--version"], { timeout: 10_000 });
    if (versionResult.code !== 0) {
      return { installed: false, freshness: "unknown", loading: false };
    }
    installedVersion = parseSfCliVersion(versionResult.stdout);
  } catch {
    return { installed: false, freshness: "unknown", loading: false };
  }

  const latestVersion = await fetchLatest();
  if (!latestVersion || !installedVersion) {
    return { installed: true, installedVersion, freshness: "unknown", loading: false };
  }

  return {
    installed: true,
    installedVersion,
    latestVersion,
    freshness: isVersionCurrent(installedVersion, latestVersion) ? "latest" : "update-available",
    loading: false,
  };
}
