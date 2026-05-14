/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Resolver for `generatePromptResponse://X` — Prompt Template invocation.
 *
 * Resolves against `Prompt.DeveloperName` via the Tooling API.
 * (`Prompt` is the Tooling sObject; `GenAiPromptTemplate` is sometimes
 * mentioned in docs but isn't exposed as a queryable Tooling type —
 * verified live against AgentforceSTDM.)
 */

import type { Connection } from "@salesforce/core";
import { safeQueryRecords, soqlInList } from "../soql.ts";
import type { TargetResolver } from "../types.ts";

export const promptTemplateResolver: TargetResolver = {
  schemes: ["generatePromptResponse"],
  metadataLabel: "Prompt Template",
  async resolve(conn: Connection, names: readonly string[]) {
    if (names.length === 0) return new Set();
    const soql =
      `SELECT DeveloperName FROM Prompt WHERE DeveloperName IN (${soqlInList(names)}) ` +
      `AND Status = 'Active'`;
    const rows = await safeQueryRecords<{ DeveloperName?: string }>(conn, "/tooling/query", soql);
    if (!rows) return null;
    const found = new Set<string>();
    for (const row of rows) {
      if (typeof row.DeveloperName === "string") found.add(row.DeveloperName);
    }
    return found;
  },
  missingDetail(target) {
    return `Prompt Template '${target.ref_name}' not found in Active status in the org.`;
  },
  fixHint(name) {
    return `sf project deploy start -m GenAiPromptTemplate:${name}`;
  },
};
