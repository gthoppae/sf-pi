/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Resolve `$active_*` placeholders in an eval spec to live org IDs.
 *
 * Three SOQL hops, all via `Connection.query` (no subprocess):
 *   1. BotDefinition  → bot_id
 *   2. BotVersion (Status='Active', latest VersionNumber) → bot_version_id
 *   3. GenAiPlannerDefinition (DeveloperName=`<agent>_v<n>`) → planner_id
 *
 * Active version is deliberate — not the latest. The eval API runs against
 * the version a user actually sees in production, not whatever's been
 * checked in but not activated.
 */

import type { Connection } from "@salesforce/core";

export interface ResolvedAgentIds {
  bot_id: string;
  bot_version_id: string;
  planner_id: string | null;
  version_number: number;
}

function soqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

export async function resolveActiveIds(
  conn: Connection,
  agentApiName: string,
): Promise<ResolvedAgentIds> {
  const esc = soqlEscape(agentApiName);

  const bots = await conn.query<{ Id: string }>(
    `SELECT Id FROM BotDefinition WHERE DeveloperName='${esc}'`,
  );
  if (bots.records.length === 0) {
    throw new Error(
      `Agent '${agentApiName}' not found in target org. ` +
        `Suggested fix: verify the DeveloperName via ` +
        `\`sf data query -q "SELECT Id, DeveloperName FROM BotDefinition"\`.`,
    );
  }
  const bot_id = bots.records[0].Id;

  const versions = await conn.query<{ Id: string; VersionNumber: number }>(
    `SELECT Id, VersionNumber FROM BotVersion ` +
      `WHERE BotDefinitionId='${bot_id}' AND Status='Active' ` +
      `ORDER BY VersionNumber DESC LIMIT 1`,
  );
  if (versions.records.length === 0) {
    throw new Error(
      `No Active BotVersion for '${agentApiName}'. ` +
        `Suggested fix: activate a version in Setup → Einstein → Agents → ${agentApiName}.`,
    );
  }
  const { Id: bot_version_id, VersionNumber: version_number } = versions.records[0];

  const planners = await conn.query<{ Id: string }>(
    `SELECT Id FROM GenAiPlannerDefinition ` +
      `WHERE DeveloperName='${esc}_v${version_number}' LIMIT 1`,
  );

  return {
    bot_id,
    bot_version_id,
    planner_id: planners.records[0]?.Id ?? null,
    version_number,
  };
}

/**
 * Substitute `$active_bot_id` / `$active_bot_version_id` / `$active_planner_id`
 * occurrences anywhere in a JSON-shaped value with the resolved IDs.
 */
export function substitutePlaceholders<T>(value: T, ids: ResolvedAgentIds): T {
  if (typeof value === "string") {
    if (value === "$active_bot_id") return ids.bot_id as unknown as T;
    if (value === "$active_bot_version_id") return ids.bot_version_id as unknown as T;
    if (value === "$active_planner_id") return ids.planner_id as unknown as T;
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => substitutePlaceholders(v, ids)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = substitutePlaceholders(v, ids);
    }
    return out as T;
  }
  return value;
}

/** Cheap textual scan to skip resolveActiveIds() when no placeholder is used. */
export function specHasActivePlaceholders(spec: unknown): boolean {
  const s = JSON.stringify(spec);
  return (
    s.includes("$active_bot_id") ||
    s.includes("$active_bot_version_id") ||
    s.includes("$active_planner_id")
  );
}
