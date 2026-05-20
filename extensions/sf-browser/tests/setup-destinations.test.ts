/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for curated Salesforce Setup destinations. */
import { describe, expect, it } from "vitest";
import {
  formatKnownSetupDestinations,
  resolveSetupDestination,
} from "../lib/setup-destinations.ts";
import { resolveOpenPath } from "../lib/salesforce-open.ts";

describe("setup destinations", () => {
  it("resolves curated setup destinations", () => {
    expect(resolveSetupDestination("agentforce-agents")).toBe(
      "/lightning/setup/EinsteinCopilot/home",
    );
    expect(resolveSetupDestination("object_manager")).toBe("/lightning/setup/ObjectManager/home");
  });

  it("rejects combining setup and path", () => {
    expect(() =>
      resolveOpenPath({ setup: "setup-home", path: "/lightning/setup/Flows/home" }),
    ).toThrow("Pass either path or setup");
  });

  it("lists known destinations for unknown setup names", () => {
    expect(() => resolveOpenPath({ setup: "not-a-real-page" })).toThrow(
      formatKnownSetupDestinations(),
    );
  });
});
