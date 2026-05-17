/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  describeOhanaSpinnerSettingsSource,
  normalizeOhanaSpinnerSettings,
  readEffectiveOhanaSpinnerSettings,
  readScopedOhanaSpinnerSettings,
  writeScopedOhanaSpinnerSettings,
} from "../lib/settings.ts";

const tempDirs = new Set<string>();

function tempCwd(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-pi-ohana-spinner-settings-"));
  tempDirs.add(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe("ohana spinner settings", () => {
  it("defaults to Ohana mode", () => {
    expect(normalizeOhanaSpinnerSettings({}).mode).toBe("ohana");
    expect(normalizeOhanaSpinnerSettings({ mode: "invalid" }).mode).toBe("ohana");
  });

  it("falls back to the Ohana default when no project setting exists", () => {
    const cwd = tempCwd();
    const scoped = readScopedOhanaSpinnerSettings(cwd, "project");
    expect(scoped.exists).toBe(false);
    expect(scoped.settings.mode).toBe("ohana");
  });

  it("writes and reads project-scoped calm mode", () => {
    const cwd = tempCwd();
    const saved = writeScopedOhanaSpinnerSettings(cwd, "project", { mode: "calm" });
    const effective = readEffectiveOhanaSpinnerSettings(cwd);

    expect(saved.exists).toBe(true);
    expect(effective.mode).toBe("calm");
    expect(effective.source).toBe("project");
    expect(describeOhanaSpinnerSettingsSource(effective)).toContain(saved.path);
  });
});
