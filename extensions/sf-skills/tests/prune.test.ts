/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the prune planner + applier.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyPrunePlan, buildPrunePlan } from "../lib/prune.ts";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;

function makeHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-skills-prune-home-"));
  tempDirs.push(dir);
  return dir;
}

function makeCwd(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-skills-prune-cwd-"));
  tempDirs.push(dir);
  return dir;
}

function writeGlobalSettings(home: string, body: Record<string, unknown>): string {
  const filePath = path.join(home, ".pi", "agent", "settings.json");
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  return filePath;
}

function writeSentinelManagedClone(home: string, name: string): string {
  const root = path.join(home, ".pi", "agent", "sf-skills", name);
  mkdirSync(path.join(root, "skills"), { recursive: true });
  writeFileSync(path.join(root, ".sf-skills-managed"), "managed", "utf8");
  return root;
}

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("buildPrunePlan", () => {
  it("returns empty when nothing is wired and no managed dirs exist", () => {
    process.env.HOME = makeHome();
    const plan = buildPrunePlan(makeCwd());
    expect(plan.staleWired).toEqual([]);
    expect(plan.orphanManagedDirs).toEqual([]);
  });

  it("flags settings entries whose paths no longer exist", () => {
    const home = makeHome();
    process.env.HOME = home;
    writeGlobalSettings(home, { skills: ["~/missing/dir", "~/.claude/skills"] });
    const plan = buildPrunePlan(makeCwd());
    expect(plan.staleWired).toContain("~/missing/dir");
  });

  it("flags managed clone dirs whose skills/ subdir is not referenced", () => {
    const home = makeHome();
    process.env.HOME = home;
    const root = writeSentinelManagedClone(home, "afv-library");
    // Wire something else, NOT this clone.
    writeGlobalSettings(home, { skills: ["~/.claude/skills"] });
    const plan = buildPrunePlan(makeCwd());
    expect(plan.orphanManagedDirs.map((o) => o.absolutePath)).toContain(root);
  });

  it("does not flag managed clones that ARE referenced", () => {
    const home = makeHome();
    process.env.HOME = home;
    writeSentinelManagedClone(home, "afv-library");
    writeGlobalSettings(home, {
      skills: ["~/.pi/agent/sf-skills/afv-library/skills"],
    });
    const plan = buildPrunePlan(makeCwd());
    expect(plan.orphanManagedDirs).toEqual([]);
  });

  it("never flags user-owned dirs (no sentinel)", () => {
    const home = makeHome();
    process.env.HOME = home;
    // No sentinel — user-owned.
    const root = path.join(home, ".pi", "agent", "sf-skills", "user-owned");
    mkdirSync(path.join(root, "skills"), { recursive: true });
    const plan = buildPrunePlan(makeCwd());
    expect(plan.orphanManagedDirs).toEqual([]);
  });
});

describe("applyPrunePlan", () => {
  it("removes stale entries from settings", () => {
    const home = makeHome();
    process.env.HOME = home;
    const settings = writeGlobalSettings(home, {
      skills: ["~/missing/dir", "~/.existing/skills"],
    });
    mkdirSync(path.join(home, ".existing", "skills"), { recursive: true });

    const plan = buildPrunePlan(makeCwd());
    const outcome = applyPrunePlan(plan, makeCwd(), {
      removeStale: true,
      deleteOrphans: false,
    });
    expect(outcome.staleRemoved).toBeGreaterThan(0);

    const next = JSON.parse(readFileSync(settings, "utf8"));
    expect(next.skills).not.toContain("~/missing/dir");
    expect(next.skills).toContain("~/.existing/skills");
  });

  it("deletes orphan managed dirs (sentinel-gated)", () => {
    const home = makeHome();
    process.env.HOME = home;
    const root = writeSentinelManagedClone(home, "afv-library");
    writeGlobalSettings(home, { skills: [] });
    const plan = buildPrunePlan(makeCwd());
    const outcome = applyPrunePlan(plan, makeCwd(), {
      removeStale: false,
      deleteOrphans: true,
    });
    expect(outcome.dirsDeleted).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expect(require("node:fs").existsSync(root)).toBe(false);
  });
});
