/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Resolver for `apex://X` and `apexRest://X`.
 *
 * `apex://` actions must point at an invocable Apex class and the Agent
 * Script input/output names must match `@InvocableVariable` fields exactly.
 * We verify that shape from Tooling API ApexClass.Body so publish catches
 * missing/non-invocable/mismatched classes before the SFAP round-trip.
 *
 * `apexRest://` only verifies class presence + @RestResource because it uses
 * a different binding model.
 */

import type { Connection } from "@salesforce/core";
import { safeQueryRecords, soqlInList } from "../soql.ts";
import type { ActionTarget, TargetResolution, TargetResolver } from "../types.ts";

interface ApexClassRow extends Record<string, unknown> {
  Name?: string;
  Body?: string;
}

const INVOCABLE_METHOD_RE = /@InvocableMethod\b/i;
const REST_RESOURCE_RE = /@RestResource\b/i;
const INVOCABLE_VARIABLE_RE =
  /@InvocableVariable\b[\s\S]*?(?:public|global)\s+[A-Za-z_][\w<>,.[\]\s]*\s+([A-Za-z_][\w]*)\s*;/gi;

function invocableVariableNames(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(INVOCABLE_VARIABLE_RE)) {
    if (m[1]) out.add(m[1]);
  }
  return [...out].sort();
}

function expectedNames(target: ActionTarget): string[] {
  return [...(target.input_names ?? []), ...(target.output_names ?? [])].sort();
}

function missingExpectedNames(body: string, target: ActionTarget): string[] {
  const available = new Set(invocableVariableNames(body));
  return expectedNames(target).filter((name) => !available.has(name));
}

async function apexRowsByName(
  conn: Connection,
  names: readonly string[],
): Promise<Map<string, string> | null> {
  if (names.length === 0) return new Map();
  const soql = `SELECT Name, Body FROM ApexClass WHERE Name IN (${soqlInList(names)})`;
  const rows = await safeQueryRecords<ApexClassRow>(conn, "/tooling/query", soql);
  if (!rows) return null;
  const byName = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.Name === "string") {
      byName.set(row.Name, typeof row.Body === "string" ? row.Body : "");
    }
  }
  return byName;
}

function verdictForTarget(target: ActionTarget, body: string | undefined): TargetResolution {
  if (body === undefined) {
    return {
      status: "missing",
      reason: "missing_class",
      detail: `Apex class '${target.ref_name}' not found in the org.`,
    };
  }

  if (target.scheme === "apexRest") {
    if (!REST_RESOURCE_RE.test(body)) {
      return {
        status: "missing",
        reason: "missing_rest_resource",
        detail: `Apex class '${target.ref_name}' exists but does not contain @RestResource.`,
      };
    }
    return { status: "ok" };
  }

  if (!INVOCABLE_METHOD_RE.test(body)) {
    return {
      status: "missing",
      reason: "missing_invocable_method",
      detail: `Apex class '${target.ref_name}' exists but does not contain @InvocableMethod.`,
    };
  }

  const missingNames = missingExpectedNames(body, target);
  if (missingNames.length > 0) {
    const available = invocableVariableNames(body);
    return {
      status: "missing",
      reason: "io_mismatch",
      detail:
        `Apex class '${target.ref_name}' exists, but action '${target.name}' declares I/O name(s) ` +
        `${missingNames.join(", ")} that do not match any @InvocableVariable field. ` +
        `Available @InvocableVariable fields: ${available.length ? available.join(", ") : "none"}.`,
      data: {
        missing_names: missingNames,
        available_invocable_variables: available,
      },
    };
  }

  return { status: "ok" };
}

export const apexResolver: TargetResolver = {
  schemes: ["apex", "apexRest"],
  metadataLabel: "ApexClass",
  async resolve(conn: Connection, names: readonly string[], targets: readonly ActionTarget[] = []) {
    const detailed = await this.resolveTargets?.(
      conn,
      targets.length > 0
        ? targets
        : names.map((name) => ({ name, target: `apex://${name}`, scheme: "apex", ref_name: name })),
    );
    if (!detailed) return null;
    const found = new Set<string>();
    const targetList =
      targets.length > 0
        ? targets
        : names.map((name) => ({ name, target: `apex://${name}`, scheme: "apex", ref_name: name }));
    for (let i = 0; i < detailed.length; i++) {
      if (detailed[i]?.status === "ok") found.add(targetList[i].ref_name);
    }
    return found;
  },
  async resolveTargets(conn: Connection, targets: readonly ActionTarget[]) {
    const byName = await apexRowsByName(
      conn,
      targets.map((t) => t.ref_name),
    );
    if (!byName) return null;
    return targets.map((target) => verdictForTarget(target, byName.get(target.ref_name)));
  },
  missingDetail(target) {
    if (target.scheme === "apexRest") {
      return `Apex class '${target.ref_name}' not found with @RestResource in the org.`;
    }
    return `Apex class '${target.ref_name}' not found as an invocable action, or its @InvocableVariable names do not match the Agent Script action I/O.`;
  },
  fixHint(name) {
    return `sf project deploy start -m ApexClass:${name}`;
  },
};
