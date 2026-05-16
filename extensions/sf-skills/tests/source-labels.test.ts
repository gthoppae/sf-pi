/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the friendly source-label helper.
 *
 * The previous formatSourceLabel showed `~/.claude/skills/sf-ai-…` per
 * row, which truncated to ellipsis and made the column useless. These
 * tests pin the human-readable replacements.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { friendlySourceLabel, friendlyWiredLabel } from "../lib/source-labels.ts";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;

function makeHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-skills-source-home-"));
  tempDirs.push(dir);
  // managedClonePath() reads HOME via pi's getAgentDir(); keep them in sync
  // so the global-afv-library detection lines up with the fake home.
  process.env.HOME = dir;
  return dir;
}
function makeCwd(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-skills-source-cwd-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("friendlySourceLabel", () => {
  it("recognizes Claude Code", () => {
    const home = makeHome();
    expect(
      friendlySourceLabel({
        skillPath: path.join(home, ".claude", "skills", "brave", "SKILL.md"),
        cwd: makeCwd(),
        homeDir: home,
      }),
    ).toBe("Claude Code");
  });

  it("recognizes OpenAI Codex and Cursor", () => {
    const home = makeHome();
    const cwd = makeCwd();
    expect(
      friendlySourceLabel({
        skillPath: path.join(home, ".codex", "skills", "x", "SKILL.md"),
        cwd,
        homeDir: home,
      }),
    ).toBe("OpenAI Codex");
    expect(
      friendlySourceLabel({
        skillPath: path.join(home, ".cursor", "skills", "y", "SKILL.md"),
        cwd,
        homeDir: home,
      }),
    ).toBe("Cursor");
  });

  it("recognizes managed afv-library at global scope", () => {
    const home = makeHome();
    expect(
      friendlySourceLabel({
        skillPath: path.join(
          home,
          ".pi",
          "agent",
          "sf-skills",
          "afv-library",
          "skills",
          "sf-apex",
          "SKILL.md",
        ),
        cwd: makeCwd(),
        homeDir: home,
      }),
    ).toBe("afv-library (global)");
  });

  it("recognizes managed afv-library at project scope", () => {
    const home = makeHome();
    const cwd = makeCwd();
    expect(
      friendlySourceLabel({
        skillPath: path.join(
          cwd,
          ".pi",
          "sf-skills",
          "afv-library",
          "skills",
          "sf-flow",
          "SKILL.md",
        ),
        cwd,
        homeDir: home,
      }),
    ).toBe("afv-library (project)");
  });

  it("recognizes bundled sf-pi extension skills", () => {
    expect(
      friendlySourceLabel({
        skillPath: "/Users/me/work/sf/sf-pi/extensions/sf-data360/skills/sf-data360/SKILL.md",
        cwd: "/Users/me/work/sf/sf-pi",
        homeDir: "/Users/me",
      }),
    ).toBe("sf-pi extension (sf-data360)");
  });

  it("recognizes pi auto-discovery roots with the (auto) suffix", () => {
    const home = makeHome();
    expect(
      friendlySourceLabel({
        skillPath: path.join(home, ".pi", "agent", "skills", "auto", "SKILL.md"),
        cwd: makeCwd(),
        homeDir: home,
      }),
    ).toBe("~/.pi/agent/skills (auto)");
  });

  it("recognizes project auto-discovery roots", () => {
    const home = makeHome();
    const cwd = makeCwd();
    expect(
      friendlySourceLabel({
        skillPath: path.join(cwd, ".pi", "skills", "x", "SKILL.md"),
        cwd,
        homeDir: home,
      }),
    ).toBe("<project>/.pi/skills (project)");
  });

  it("recognizes npm package skills", () => {
    expect(
      friendlySourceLabel({
        skillPath: "/opt/homebrew/lib/node_modules/pi-web-access/skills/librarian/SKILL.md",
        cwd: "/Users/me",
        homeDir: "/Users/me",
      }),
    ).toBe("pi-web-access (npm package)");
  });

  it("recognizes scoped npm package skills", () => {
    expect(
      friendlySourceLabel({
        skillPath: "/opt/homebrew/lib/node_modules/@earendil-works/pi-tooling/skills/foo/SKILL.md",
        cwd: "/Users/me",
        homeDir: "/Users/me",
      }),
    ).toBe("pi-tooling (npm package)");
  });

  it("falls back to ~/<rel> for unrecognized paths under home", () => {
    const home = makeHome();
    expect(
      friendlySourceLabel({
        skillPath: path.join(home, "experiments", "skills", "demo", "SKILL.md"),
        cwd: makeCwd(),
        homeDir: home,
      }),
    ).toBe("~/experiments/skills/demo");
  });
});

describe("friendlyWiredLabel", () => {
  it("uses words instead of single-letter codes", () => {
    expect(friendlyWiredLabel("global")).toBe("Global");
    expect(friendlyWiredLabel("project")).toBe("Project");
    expect(friendlyWiredLabel("both")).toBe("Both");
    expect(friendlyWiredLabel("none")).toBe("—");
  });
});
