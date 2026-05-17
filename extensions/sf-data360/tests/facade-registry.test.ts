/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import {
  D360_EXAMPLES,
  D360_OPERATIONS,
  D360_RUNBOOKS,
  findOperation,
  findRunbook,
  searchRegistry,
} from "../lib/facade/registry.ts";

describe("d360 facade registry", () => {
  it("keeps operation and runbook names unique", () => {
    const operationNames = D360_OPERATIONS.map((operation) => operation.name);
    const runbookNames = D360_RUNBOOKS.map((runbook) => runbook.name);

    expect(new Set(operationNames).size).toBe(operationNames.length);
    expect(new Set(runbookNames).size).toBe(runbookNames.length);
  });

  it("finds Data 360 families by intent", () => {
    const results = searchRegistry("agent trace errors");

    expect(results[0]?.family).toBe("Agent Observability");
    expect(results[0]?.runbooks).toContain("agent_observability.platform_error_traces");
  });

  it("returns operation and runbook examples that point at registered names", () => {
    for (const example of Object.values(D360_EXAMPLES) as Array<Record<string, unknown>>) {
      const operation = typeof example.operation === "string" ? example.operation : undefined;
      const runbook = typeof example.runbook === "string" ? example.runbook : undefined;
      if (operation) expect(findOperation(operation)).toBeTruthy();
      if (runbook) expect(findRunbook(runbook)).toBeTruthy();
      expect(operation || runbook).toBeTruthy();
    }
  });

  it("marks mutability safety explicitly for every operation", () => {
    for (const operation of D360_OPERATIONS) {
      expect(["read", "safe_post", "confirmed", "destructive"]).toContain(operation.safety);
      expect(operation.path).toMatch(/^\//);
    }
  });
});
