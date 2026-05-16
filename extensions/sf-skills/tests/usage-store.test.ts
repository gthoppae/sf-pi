/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the usage-store (global + project counters).
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  globalUsageStore,
  loadUsageMap,
  projectUsageStore,
  recordSkillInvocation,
  resetUsage,
} from "../lib/usage-store.ts";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;

function makeHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-skills-usage-home-"));
  tempDirs.push(dir);
  return dir;
}

function makeCwd(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-skills-usage-cwd-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("globalUsageStore", () => {
  it("returns an empty record set when nothing has been written", () => {
    process.env.HOME = makeHome();
    expect(globalUsageStore().read()).toEqual({ records: {} });
  });

  it("persists writes atomically", () => {
    const home = makeHome();
    process.env.HOME = home;
    const store = globalUsageStore();
    store.write({ records: { "sf-apex": { count: 3, lastUsedAt: "2026-05-01T00:00:00.000Z" } } });
    expect(store.read().records["sf-apex"]?.count).toBe(3);

    const raw = JSON.parse(readFileSync(store.path, "utf8"));
    expect(raw.schemaVersion).toBe(1);
    expect(raw.state.records["sf-apex"].count).toBe(3);
  });
});

describe("projectUsageStore", () => {
  it("writes under <cwd>/.pi/sf-skills-usage.json", () => {
    process.env.HOME = makeHome();
    const cwd = makeCwd();
    const store = projectUsageStore(cwd);
    store.bump("sf-soql");
    expect(store.path).toBe(path.join(cwd, ".pi", "sf-skills-usage.json"));
    expect(store.read().records["sf-soql"]?.count).toBe(1);
  });

  it("increments existing counters monotonically", () => {
    process.env.HOME = makeHome();
    const cwd = makeCwd();
    const store = projectUsageStore(cwd);
    store.bump("sf-apex");
    store.bump("sf-apex");
    store.bump("sf-flow");
    const records = store.read().records;
    expect(records["sf-apex"]?.count).toBe(2);
    expect(records["sf-flow"]?.count).toBe(1);
  });
});

describe("recordSkillInvocation", () => {
  it("bumps both global and project counters with one call", () => {
    process.env.HOME = makeHome();
    const cwd = makeCwd();
    recordSkillInvocation("sf-apex", cwd, new Date("2026-05-15T12:00:00Z"));

    const global = globalUsageStore().read().records;
    expect(global["sf-apex"]?.count).toBe(1);
    expect(global["sf-apex"]?.lastUsedAt).toBe("2026-05-15T12:00:00.000Z");

    const project = projectUsageStore(cwd).read().records;
    expect(project["sf-apex"]?.count).toBe(1);
  });

  it("skips the project counter when cwd is '/'", () => {
    process.env.HOME = makeHome();
    recordSkillInvocation("sf-apex", "/");
    expect(globalUsageStore().read().records["sf-apex"]?.count).toBe(1);
  });
});

describe("loadUsageMap", () => {
  it("merges global + project records when scope='all'", () => {
    process.env.HOME = makeHome();
    const cwd = makeCwd();
    globalUsageStore().write({
      records: { "sf-apex": { count: 5, lastUsedAt: "2026-05-15T00:00:00.000Z" } },
    });
    projectUsageStore(cwd).write({
      records: { "sf-apex": { count: 2, lastUsedAt: "2026-05-16T00:00:00.000Z" } },
    });
    const merged = loadUsageMap("all", cwd);
    expect(merged.get("sf-apex")?.count).toBe(7);
    expect(merged.get("sf-apex")?.lastUsedAt).toBe("2026-05-16T00:00:00.000Z");
  });

  it("filters by scope when scope='global' or scope='project'", () => {
    process.env.HOME = makeHome();
    const cwd = makeCwd();
    globalUsageStore().write({
      records: { "sf-apex": { count: 1, lastUsedAt: "2026-05-15T00:00:00.000Z" } },
    });
    projectUsageStore(cwd).write({
      records: { "sf-soql": { count: 4, lastUsedAt: "2026-05-15T00:00:00.000Z" } },
    });
    expect([...loadUsageMap("global", cwd).keys()]).toEqual(["sf-apex"]);
    expect([...loadUsageMap("project", cwd).keys()]).toEqual(["sf-soql"]);
  });
});

describe("resetUsage", () => {
  it("clears the global store", () => {
    process.env.HOME = makeHome();
    const cwd = makeCwd();
    recordSkillInvocation("sf-apex", cwd);
    expect(resetUsage("global", cwd)).toBe(1);
    expect(globalUsageStore().read().records).toEqual({});
  });

  it("clears the project store", () => {
    process.env.HOME = makeHome();
    const cwd = makeCwd();
    recordSkillInvocation("sf-apex", cwd);
    recordSkillInvocation("sf-flow", cwd);
    expect(resetUsage("project", cwd)).toBe(2);
    expect(projectUsageStore(cwd).read().records).toEqual({});
  });
});
