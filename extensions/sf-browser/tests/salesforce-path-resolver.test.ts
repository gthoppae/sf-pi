/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for deterministic Salesforce path resolution. */
import { describe, expect, it } from "vitest";
import {
  isResolvedSalesforcePath,
  resolveSalesforcePath,
} from "../lib/salesforce-path-resolver.ts";

describe("salesforce path resolver", () => {
  it("resolves deterministic Lightning routes", () => {
    expect(resolveSalesforcePath({ route: { type: "home" } })).toMatchObject({
      ok: true,
      path: "/lightning/page/home",
      kind: "home",
    });
    expect(
      resolveSalesforcePath({ route: { type: "object-list", objectApiName: "Account" } }),
    ).toMatchObject({ ok: true, path: "/lightning/o/Account/list" });
    expect(
      resolveSalesforcePath({ route: { type: "object-new", objectApiName: "Widget__c" } }),
    ).toMatchObject({ ok: true, path: "/lightning/o/Widget__c/new" });
    expect(
      resolveSalesforcePath({
        route: { type: "record-view", objectApiName: "Account", recordId: "001000000000001AAA" },
      }),
    ).toMatchObject({ ok: true, path: "/lightning/r/Account/001000000000001AAA/view" });
  });

  it("resolves exact and bounded fuzzy setup destinations", () => {
    expect(resolveSalesforcePath({ setup: "agentforce-agents" })).toMatchObject({
      ok: true,
      path: "/lightning/setup/EinsteinCopilot/home",
      destination: "agentforce-agents",
    });
    expect(resolveSalesforcePath({ setup: "agent force" })).toMatchObject({
      ok: true,
      path: "/lightning/setup/EinsteinCopilot/home",
      destination: "agentforce-agents",
    });
  });

  it("returns candidates instead of guessing ambiguous fuzzy destinations", () => {
    const result = resolveSalesforcePath({ setup: "apps" });

    expect(isResolvedSalesforcePath(result)).toBe(false);
    if (!isResolvedSalesforcePath(result)) {
      expect(result.reason).toBe("ambiguous_setup_destination");
      expect(result.candidates?.map((candidate) => candidate.destination)).toEqual(
        expect.arrayContaining(["app-manager", "connected-apps", "external-client-apps"]),
      );
    }
  });

  it("validates structured route inputs locally without live org calls", () => {
    expect(
      resolveSalesforcePath({ route: { type: "object-list", objectApiName: "Bad/Object" } }),
    ).toMatchObject({ ok: false, reason: "invalid_route" });
    expect(
      resolveSalesforcePath({
        route: { type: "record-view", objectApiName: "Account", recordId: "not-an-id" },
      }),
    ).toMatchObject({ ok: false, reason: "invalid_route" });
  });

  it("requires exactly one target", () => {
    expect(resolveSalesforcePath({})).toMatchObject({ ok: false, reason: "missing_target" });
    expect(
      resolveSalesforcePath({ path: "/lightning/page/home", setup: "setup-home" }),
    ).toMatchObject({
      ok: false,
      reason: "multiple_targets",
    });
  });
});
