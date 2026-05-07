/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { classifyD360Request, normalizeMethod } from "../lib/safety.ts";

describe("sf-data360 safety classifier", () => {
  it("allows reads", () => {
    const decision = classifyD360Request("GET", "/ssot/data-model-objects", "production");
    expect(decision.level).toBe("read");
    expect(decision.requiresConfirmation).toBe(false);
  });

  it("allows known query/search/validation POST paths", () => {
    expect(
      classifyD360Request("POST", "/connect/search/metadata/results", "production")
        .requiresConfirmation,
    ).toBe(false);
    expect(classifyD360Request("POST", "/ssot/query-sql", "production").requiresConfirmation).toBe(
      false,
    );
    expect(
      classifyD360Request("POST", "/ssot/calculated-insights/actions/validate", "production")
        .requiresConfirmation,
    ).toBe(false);
  });

  it("confirms destructive and action paths", () => {
    expect(classifyD360Request("DELETE", "/ssot/segments/123", "sandbox")).toMatchObject({
      level: "delete",
      requiresConfirmation: true,
    });
    expect(
      classifyD360Request("POST", "/ssot/segments/123/actions/publish", "sandbox"),
    ).toMatchObject({ level: "publish", requiresConfirmation: true });
    expect(classifyD360Request("POST", "/ssot/data-streams/123/run", "sandbox")).toMatchObject({
      level: "run",
      requiresConfirmation: true,
    });
  });

  it("confirms unclassified writes only for production-like orgs", () => {
    expect(classifyD360Request("POST", "/ssot/data-model-objects", "sandbox")).toMatchObject({
      level: "create",
      requiresConfirmation: false,
    });
    expect(classifyD360Request("POST", "/ssot/data-model-objects", "unknown")).toMatchObject({
      level: "create",
      requiresConfirmation: true,
    });
    expect(classifyD360Request("PATCH", "/ssot/data-model-objects/X", "production")).toMatchObject({
      level: "update",
      requiresConfirmation: true,
    });
  });

  it("normalizes methods", () => {
    expect(normalizeMethod("get")).toBe("GET");
    expect(() => normalizeMethod("TRACE")).toThrow("Unsupported Data 360 method");
  });
});
