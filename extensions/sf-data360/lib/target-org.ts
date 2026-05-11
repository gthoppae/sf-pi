/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared target-org resolution for the d360_* tools.
 *
 * Every Data 360 tool needs the same three things to make a call:
 *   1. a target-org alias (explicit or default)
 *   2. the **right** API version for that org
 *   3. the org type (sandbox/prod/scratch/etc.) for safety classification
 *
 * The non-obvious bit is (2): when the caller passes an explicit `target_org`
 * that differs from the active sf-pi default, the active env's apiVersion is
 * the wrong number. Earlier versions of `d360_metadata` and `d360_probe`
 * hard-wired `env.org.apiVersion` and silently 404'd against any org on a
 * different release than the active default — every `/ssot/*` path returned
 * `NOT_FOUND` because the URL pinned a non-existent vNN.0.
 *
 * `resolveTargetOrgContext` walks:
 *   - explicit target → if different from env, ask `detectOrg()` (which uses
 *     the cached jsforce `Connection.getApiVersion()`) for that org's real
 *     apiVersion + orgType.
 *   - matching target  → reuse the cached env values.
 *   - no detected version anywhere → fall back to the project sourceApiVersion
 *     and only as a last resort the active env apiVersion. We never default
 *     to a hardcoded "66.0"; that hides drift.
 */
import { detectOrg } from "../../../lib/common/sf-environment/detect.ts";
import type { OrgInfo, OrgType, SfEnvironment } from "../../../lib/common/sf-environment/types.ts";

export interface TargetOrgContext {
  /** Resolved alias/username, or undefined when no target is configured. */
  targetOrg?: string;
  /** API version used to build /services/data/vNN.N paths. */
  apiVersion: string;
  /** Org type for safety classification. "unknown" when detection failed. */
  orgType: OrgType | "unknown";
  /** OrgInfo for an explicit non-default target org, when detection succeeded. */
  targetOrgInfo?: OrgInfo;
}

/** Pick a target org name from explicit input, env config, or env org defaults. */
export function normalizeTargetOrg(
  targetOrg: string | undefined,
  env: SfEnvironment,
): string | undefined {
  const explicit = targetOrg?.trim();
  if (explicit) return explicit;
  return env.config.targetOrg ?? env.org.alias ?? env.org.username;
}

/** True iff the given target alias/username matches the active env's resolved org. */
export function targetMatchesEnvironment(targetOrg: string, env: SfEnvironment): boolean {
  return (
    targetOrg === env.config.targetOrg ||
    targetOrg === env.org.alias ||
    targetOrg === env.org.username
  );
}

/**
 * Detect the explicit target org via `@salesforce/core`. Returns undefined
 * when the requested org matches the active env (the cached values are
 * already authoritative) or when detection fails. Failed detection falls
 * back to the env values; the caller is responsible for fail-closed safety.
 */
export async function resolveExplicitTargetOrg(
  targetOrg: string | undefined,
  env: SfEnvironment,
): Promise<OrgInfo | undefined> {
  if (!targetOrg || targetMatchesEnvironment(targetOrg, env)) return undefined;
  // detectOrg() reuses the global cached Org from sf-conn/connection.ts, so
  // this is just a synchronous read off a warm Connection's auth fields.
  const org = await detectOrg(targetOrg);
  return org.detected ? org : undefined;
}

/** Pick the org type to use for safety, preferring explicit target detection. */
export function resolveOrgType(
  targetOrg: string | undefined,
  env: SfEnvironment,
  targetOrgInfo?: OrgInfo,
): OrgType | "unknown" {
  if (!targetOrg) return "unknown";
  if (targetMatchesEnvironment(targetOrg, env)) return env.org.orgType;
  return targetOrgInfo?.orgType ?? "unknown";
}

/**
 * Pick the API version. Prefers the explicit target org's detected version,
 * then the active env, then the project sourceApiVersion. Throws if nothing
 * usable is available — that's a clearer failure than silently producing a
 * wrong URL.
 */
export function resolveApiVersion(env: SfEnvironment, targetOrgInfo?: OrgInfo): string {
  return (
    targetOrgInfo?.apiVersion ??
    env.org.apiVersion ??
    env.project.sourceApiVersion ??
    throwMissingApiVersion()
  );
}

function throwMissingApiVersion(): never {
  throw new Error(
    "No Salesforce API version available. The target org could not be detected and no project sourceApiVersion is configured.",
  );
}

/** One-shot resolution for tool handlers: target org + api version + org type. */
export async function resolveTargetOrgContext(
  targetOrg: string | undefined,
  env: SfEnvironment,
): Promise<TargetOrgContext> {
  const resolvedTargetOrg = normalizeTargetOrg(targetOrg, env);
  const targetOrgInfo = await resolveExplicitTargetOrg(resolvedTargetOrg, env);
  const apiVersion = resolveApiVersion(env, targetOrgInfo);
  const orgType = resolveOrgType(resolvedTargetOrg, env, targetOrgInfo);
  return { targetOrg: resolvedTargetOrg, apiVersion, orgType, targetOrgInfo };
}
