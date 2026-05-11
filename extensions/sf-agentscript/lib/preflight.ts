/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Pre-flight checks for `agentscript_lifecycle publish` and the
 * `agentscript_inspect check_targets` action.
 *
 * Two independent pre-flights:
 *
 *   checkBundleType(bundleMetaPath)
 *     Local file check. Parses the bundle-meta.xml and verifies that
 *     `<bundleType>` is present (SDR rejects with a cryptic `Required
 *     fields are missing: [BundleType]` otherwise). Cheap, blocking,
 *     no network.
 *
 *   checkActionTargets(conn, actions)
 *     Network check via Tooling API. For each action declaration whose
 *     `target` is `flow://X` or `apex://X`, queries the org for the
 *     matching FlowDefinitionView / ApexClass and reports any unresolved
 *     references. `generatePromptResponse://X` is recognized but not
 *     verified (Prompt Templates aren't queryable as a single Tooling
 *     row in the same way).
 *
 * Both surfaces are designed to be callable independently:
 *   - publishAgent calls them as part of pre-flight (block on bundleType,
 *     warn on action targets).
 *   - The `agentscript_inspect check_targets` action wraps the network
 *     check so users can drill into the issue without invoking publish.
 */

import { readFile } from "node:fs/promises";
import type { Connection } from "@salesforce/core";
import type { ComponentSummary } from "./inspect.ts";
import { connRequest } from "../../../lib/common/sf-conn/request.ts";

// -------------------------------------------------------------------------------------------------
// bundleType check
// -------------------------------------------------------------------------------------------------

export interface BundleTypeCheckResult {
  ok: boolean;
  /** Reason code on failure. */
  reason?: "missing_file" | "missing_bundle_type" | "unparseable_xml" | "wrong_root";
  /** Human-readable detail. */
  detail?: string;
  /** Echo back the bundle-meta.xml path for the LLM error envelope. */
  path?: string;
}

const BUNDLE_TYPE_RE = /<bundleType>\s*([A-Za-z0-9_-]+)\s*<\/bundleType>/;
const ROOT_TAG_RE = /<AiAuthoringBundle\b/;

/**
 * Read a bundle-meta.xml and assert it carries `<bundleType>`.
 *
 * SDR's deploy step requires this field; without it the deploy fails
 * with `Required fields are missing: [BundleType]` AFTER zipping +
 * uploading. Catching it locally turns that into a clean error envelope.
 */
export async function checkBundleType(bundleMetaPath: string): Promise<BundleTypeCheckResult> {
  let xml: string;
  try {
    xml = await readFile(bundleMetaPath, "utf8");
  } catch (err) {
    return {
      ok: false,
      reason: "missing_file",
      detail: `Cannot read ${bundleMetaPath}: ${err instanceof Error ? err.message : String(err)}`,
      path: bundleMetaPath,
    };
  }
  if (!ROOT_TAG_RE.test(xml)) {
    return {
      ok: false,
      reason: "wrong_root",
      detail: "Bundle XML doesn't have an <AiAuthoringBundle> root element.",
      path: bundleMetaPath,
    };
  }
  if (!BUNDLE_TYPE_RE.test(xml)) {
    return {
      ok: false,
      reason: "missing_bundle_type",
      detail: "Missing <bundleType>AGENT</bundleType>. Add it inside <AiAuthoringBundle>.",
      path: bundleMetaPath,
    };
  }
  return { ok: true, path: bundleMetaPath };
}

// -------------------------------------------------------------------------------------------------
// action target check
// -------------------------------------------------------------------------------------------------

export interface ActionTarget {
  /** Action declaration name (e.g. "log_event"). */
  name: string;
  /** Raw target URI (e.g. "flow://LogEvent"). */
  target: string;
  /** Parsed scheme: "flow" / "apex" / "generatePromptResponse" / unknown. */
  scheme: string;
  /** Parsed name (the part after `scheme://`). */
  ref_name: string;
}

export interface ActionTargetCheck extends ActionTarget {
  /** "ok" if found in org, "missing" if not, "unverifiable" if scheme isn't one we query. */
  status: "ok" | "missing" | "unverifiable";
  /** Detail string when status !== "ok". */
  detail?: string;
}

export interface CheckActionTargetsResult {
  ok: boolean;
  targets: ActionTargetCheck[];
  /** Total declared actions inspected. */
  total: number;
  /** Subset that resolved to a deployed metadata record. */
  resolved: number;
  /** Subset that we couldn't resolve. */
  missing: number;
  /** Subset whose scheme we don't pre-flight today. */
  unverifiable: number;
}

/**
 * Parse `target:` strings into ActionTarget records. Returns an empty list
 * if nothing parseable is found. Designed to never throw.
 */
export function extractActionTargets(actions: readonly ComponentSummary[]): ActionTarget[] {
  const out: ActionTarget[] = [];
  for (const a of actions) {
    if (!a?.target) continue;
    const m = /^([a-zA-Z][a-zA-Z0-9_-]*):\/\/(.+)$/.exec(a.target);
    if (!m) continue;
    out.push({ name: a.name, target: a.target, scheme: m[1], ref_name: m[2] });
  }
  return out;
}

/**
 * Verify that each action's `target:` URI refers to a deployed metadata
 * record in the target org. Recognizes `flow://X` (FlowDefinitionView)
 * and `apex://X` (ApexClass). Other schemes are reported as
 * `unverifiable` so callers can surface them without failing.
 *
 * Network-sensitive: makes one Tooling API query per non-empty scheme
 * group (typically 1-2 queries total). Failures connect-side fall back
 * to `unverifiable` so a transient outage doesn't block publish.
 */
export async function checkActionTargets(
  conn: Connection,
  actions: readonly ComponentSummary[],
): Promise<CheckActionTargetsResult> {
  const targets = extractActionTargets(actions);
  const result: CheckActionTargetsResult = {
    ok: true,
    targets: [],
    total: targets.length,
    resolved: 0,
    missing: 0,
    unverifiable: 0,
  };

  // Dedupe by ref_name within each scheme to avoid issuing duplicate IN-list
  // entries when the same flow / class is referenced from multiple subagents.
  const flowNames = Array.from(
    new Set(targets.filter((t) => t.scheme === "flow").map((t) => t.ref_name)),
  );
  const apexNames = Array.from(
    new Set(targets.filter((t) => t.scheme === "apex").map((t) => t.ref_name)),
  );

  // Query flows via the data API: FlowDefinitionView is a regular sObject
  // exposing the active ApiName of every deployed Flow + ProcessBuilder.
  // The Tooling-API equivalent is FlowDefinition with `DeveloperName`, but
  // FlowDefinitionView is more accurate for runtime resolution because it
  // only surfaces what's currently installed and active.
  const foundFlows = await safeNamesQuery(
    conn,
    "/query",
    "FlowDefinitionView",
    "ApiName",
    flowNames,
  );
  // Query apex classes via Tooling API. ApexClass exists on both surfaces;
  // Tooling is the canonical source-of-truth for class metadata.
  const foundApex = await safeNamesQuery(conn, "/tooling/query", "ApexClass", "Name", apexNames);

  for (const t of targets) {
    if (t.scheme === "flow") {
      if (foundFlows === null) {
        result.targets.push({
          ...t,
          status: "unverifiable",
          detail: "Tooling query failed; cannot confirm flow exists.",
        });
        result.unverifiable++;
      } else if (foundFlows.has(t.ref_name)) {
        result.targets.push({ ...t, status: "ok" });
        result.resolved++;
      } else {
        result.targets.push({
          ...t,
          status: "missing",
          detail: `Flow '${t.ref_name}' not found in org.`,
        });
        result.missing++;
      }
    } else if (t.scheme === "apex") {
      if (foundApex === null) {
        result.targets.push({
          ...t,
          status: "unverifiable",
          detail: "Tooling query failed; cannot confirm class exists.",
        });
        result.unverifiable++;
      } else if (foundApex.has(t.ref_name)) {
        result.targets.push({ ...t, status: "ok" });
        result.resolved++;
      } else {
        result.targets.push({
          ...t,
          status: "missing",
          detail: `ApexClass '${t.ref_name}' not found in org.`,
        });
        result.missing++;
      }
    } else {
      // Schemes we don't verify (generatePromptResponse, unknown) get
      // reported so downstream renderers can show them in the report.
      result.targets.push({
        ...t,
        status: "unverifiable",
        detail: `Scheme '${t.scheme}' not pre-flighted (only flow:// and apex:// are checked today).`,
      });
      result.unverifiable++;
    }
  }
  result.ok = result.missing === 0;
  return result;
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

/**
 * Run a SOQL `WHERE <nameField> IN (...)` query against the given query
 * endpoint and return the set of resolved name values. Returns `null`
 * on any error (network, auth, invalid type) so the caller treats that
 * as "couldn't verify".
 *
 * `endpoint` is one of `/query` (data API) or `/tooling/query` (Tooling API).
 */
async function safeNamesQuery(
  conn: Connection,
  endpoint: "/query" | "/tooling/query",
  sobject: string,
  nameField: string,
  names: readonly string[],
): Promise<Set<string> | null> {
  if (names.length === 0) return new Set();
  const inList = names.map((n) => `'${n.replace(/'/g, "\\'")}'`).join(",");
  const soql = `SELECT ${nameField} FROM ${sobject} WHERE ${nameField} IN (${inList})`;
  try {
    const url = `${endpoint}?q=${encodeURIComponent(soql)}`;
    const res = await connRequest<{ records?: Array<Record<string, unknown>> }>(conn, {
      method: "GET",
      url,
    });
    if (res.status >= 400) return null;
    const found = new Set<string>();
    for (const r of res.body?.records ?? []) {
      const v = r[nameField];
      if (typeof v === "string") found.add(v);
    }
    return found;
  } catch {
    return null;
  }
}
