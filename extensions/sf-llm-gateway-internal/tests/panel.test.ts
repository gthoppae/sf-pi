/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the gateway grouped action panel inventory.
 *
 * The runtime component is manually QA'd in Pi, but the pure row builder keeps
 * group labels, scope hints, and command-surface coverage from drifting.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GATEWAY_COMMAND_SURFACE } from "../lib/command-surface.ts";
import { buildGatewayGroupedActionItems, buildGatewayPanelStatusLines } from "../lib/panel.ts";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("gateway grouped panel actions", () => {
  it("groups actions without baking group names into the visible action label", () => {
    const actions = buildGatewayGroupedActionItems("global");
    expect(actions.some((item) => item.group === "Setup")).toBe(true);
    expect(actions.some((item) => item.group === "Discovery & diagnostics")).toBe(true);
    expect(actions.some((item) => item.group === "Utilities")).toBe(true);
    expect(actions.every((item) => !item.label.includes(" — "))).toBe(true);
  });

  it("includes every command-surface action plus scope switching and close", () => {
    const actions = buildGatewayGroupedActionItems("project");
    const values = actions.map((item) => item.value);

    expect(values).toContain("switch-scope");
    expect(values).toContain("close");
    for (const surface of GATEWAY_COMMAND_SURFACE) {
      expect(values).toContain(surface.id);
    }
  });

  it("adds scope hints only to scoped actions", () => {
    const actions = buildGatewayGroupedActionItems("project");
    expect(actions.find((item) => item.value === "setup")?.label).toContain("[project]");
    expect(actions.find((item) => item.value === "doctor")?.label).not.toContain("[project]");
  });
});

describe("gateway panel status", () => {
  it("shows the shared connection status used by sf-welcome", () => {
    const ctx = {
      cwd: makeTempDir("gateway-panel-"),
      model: { provider: "sf-llm-gateway-internal", id: "claude-opus-4-7" },
      getContextUsage: () => null,
      ui: { theme: identityTheme },
    } as any;

    const lines = buildGatewayPanelStatusLines(
      ctx,
      {
        providerRegistered: true,
        scope: "global",
        runtimeState: {
          discovery: null,
          monthlyUsage: null,
          monthlyUsageError: null,
          keyInfo: null,
          keyInfoError: null,
          health: null,
          healthError: null,
          connectionStatus: { kind: "degraded", source: "health", detail: "usage probe failed" },
          dailyActivity: null,
          dailyActivityError: null,
          keyList: null,
          keyListError: null,
          runtimeBetaOverrides: null,
          runtimeExtraBetas: new Set(),
        },
      },
      identityTheme as any,
    );

    const plain = lines.join("\n");
    expect(plain).toContain("Connection");
    expect(plain).toContain("degraded");
    expect(plain).toContain("via health");
  });
});

const identityTheme = {
  fg: (_name: string, value: string) => value,
  bg: (_name: string, value: string) => value,
  bold: (value: string) => value,
};
