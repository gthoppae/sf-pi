/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the parent-dir auto-expand / no-op detection.
 *
 * The bugs these guard against are the two real ones we shipped in v1
 * and fixed:
 *
 *   1. Toggling enable at a different scope while a parent dir was
 *      already wired produced a duplicate-load warning. planEnable now
 *      returns alreadyCovered=true so the apply path can skip cleanly.
 *
 *   2. Toggling disable while a parent dir was wired silently did
 *      nothing. planDisable now returns coverage='parent' with the
 *      sibling expansion the apply path must write back.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { planDisable, planEnable } from "../lib/settings-coverage.ts";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;

function makeHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-skills-cov-home-"));
  tempDirs.push(dir);
  return dir;
}

function makeCwd(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-skills-cov-cwd-"));
  tempDirs.push(dir);
  return dir;
}

function writeSettings(filePath: string, body: Record<string, unknown>): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

function makeSkill(root: string, name: string): string {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "SKILL.md");
  writeFileSync(file, `---\nname: ${name}\ndescription: ${name}\n---\n`, "utf8");
  return file;
}

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("planDisable", () => {
  it("removes an exact file-path entry verbatim", () => {
    const home = makeHome();
    process.env.HOME = home;
    const root = path.join(home, ".claude", "skills");
    const skill = makeSkill(root, "demo");
    writeSettings(path.join(home, ".pi", "agent", "settings.json"), {
      skills: [skill],
    });

    const plan = planDisable({ skillPath: skill, scope: "global", cwd: makeCwd() });
    expect(plan.coverage).toBe("exact");
    expect(plan.remove).toEqual([skill]);
    expect(plan.add).toEqual([]);
  });

  it("expands a parent-dir entry into per-file entries minus the disabled one", () => {
    const home = makeHome();
    process.env.HOME = home;
    const root = path.join(home, ".claude", "skills");
    const a = makeSkill(root, "alpha");
    const b = makeSkill(root, "beta");
    const c = makeSkill(root, "gamma");
    writeSettings(path.join(home, ".pi", "agent", "settings.json"), {
      skills: ["~/.claude/skills"],
    });

    const plan = planDisable({ skillPath: b, scope: "global", cwd: makeCwd() });
    expect(plan.coverage).toBe("parent");
    expect(plan.remove).toEqual(["~/.claude/skills"]);
    // Order isn't guaranteed by readdirSync — sort for stable assertion.
    expect([...plan.add].sort()).toEqual([a, c].sort());
    expect(plan.expandedFrom).toBe(root);
    expect(plan.expandedSiblingCount).toBe(2);
  });

  it("returns coverage='none' when neither the file nor a parent is wired", () => {
    const home = makeHome();
    process.env.HOME = home;
    // Skill exists, but no settings entry covers it (auto-discovered case).
    const skill = makeSkill(path.join(home, ".pi", "agent", "skills"), "auto");
    const plan = planDisable({ skillPath: skill, scope: "global", cwd: makeCwd() });
    expect(plan.coverage).toBe("none");
    expect(plan.remove).toEqual([]);
    expect(plan.add).toEqual([]);
  });

  it("scopes correctly when called with scope='project'", () => {
    const home = makeHome();
    process.env.HOME = home;
    const cwd = makeCwd();
    const root = path.join(cwd, ".claude", "skills");
    const skill = makeSkill(root, "demo");
    writeSettings(path.join(cwd, ".pi", "settings.json"), {
      skills: ["./.claude/skills"],
    });

    const plan = planDisable({ skillPath: skill, scope: "project", cwd });
    expect(plan.coverage).toBe("parent");
    expect(plan.remove).toEqual(["./.claude/skills"]);
    expect(plan.add).toEqual([]); // only one skill under the parent
  });
});

describe("planEnable", () => {
  it("returns alreadyCovered when the file path is in settings verbatim", () => {
    const home = makeHome();
    process.env.HOME = home;
    const root = path.join(home, ".claude", "skills");
    const skill = makeSkill(root, "demo");
    writeSettings(path.join(home, ".pi", "agent", "settings.json"), {
      skills: [skill],
    });

    const plan = planEnable({ skillPath: skill, scope: "global", cwd: makeCwd() });
    expect(plan.alreadyCovered).toBe(true);
    expect(plan.coveredInScope).toBe("global");
    expect(plan.add).toEqual([]);
  });

  it("returns alreadyCovered when a parent dir entry covers the file", () => {
    const home = makeHome();
    process.env.HOME = home;
    const root = path.join(home, ".claude", "skills");
    const skill = makeSkill(root, "demo");
    writeSettings(path.join(home, ".pi", "agent", "settings.json"), {
      skills: ["~/.claude/skills"],
    });

    const plan = planEnable({ skillPath: skill, scope: "global", cwd: makeCwd() });
    expect(plan.alreadyCovered).toBe(true);
    expect(plan.coveredInScope).toBe("global");
    expect(plan.add).toEqual([]);
  });

  it("queues the file path for add when nothing covers it", () => {
    const home = makeHome();
    process.env.HOME = home;
    const root = path.join(home, ".claude", "skills");
    const skill = makeSkill(root, "demo");
    // Settings empty.
    writeSettings(path.join(home, ".pi", "agent", "settings.json"), { skills: [] });

    const plan = planEnable({ skillPath: skill, scope: "global", cwd: makeCwd() });
    expect(plan.alreadyCovered).toBe(false);
    expect(plan.coveredInScope).toBeUndefined();
    expect(plan.add).toEqual([skill]);
  });

  // Regression: enabling at scope B while scope A already covers the
  // skill used to silently append the file path, producing pi's
  // name-collision warning on reload. Now we detect cross-scope cover.
  it("detects cross-scope coverage (global wired, project toggle)", () => {
    const home = makeHome();
    process.env.HOME = home;
    const cwd = makeCwd();
    const root = path.join(home, ".claude", "skills");
    const skill = makeSkill(root, "demo");
    writeSettings(path.join(home, ".pi", "agent", "settings.json"), {
      skills: ["~/.claude/skills"],
    });
    writeSettings(path.join(cwd, ".pi", "settings.json"), { skills: [] });

    const plan = planEnable({ skillPath: skill, scope: "project", cwd });
    expect(plan.alreadyCovered).toBe(true);
    expect(plan.coveredInScope).toBe("global");
    expect(plan.add).toEqual([]);
  });

  it("detects cross-scope coverage the other direction (project wired, global toggle)", () => {
    const home = makeHome();
    process.env.HOME = home;
    const cwd = makeCwd();
    const root = path.join(cwd, ".claude", "skills");
    const skill = makeSkill(root, "demo");
    writeSettings(path.join(cwd, ".pi", "settings.json"), {
      skills: ["./.claude/skills"],
    });

    const plan = planEnable({ skillPath: skill, scope: "global", cwd });
    expect(plan.alreadyCovered).toBe(true);
    expect(plan.coveredInScope).toBe("project");
    expect(plan.add).toEqual([]);
  });
});
