/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Per-skill usage counters (project + global).
 *
 * The HUD detects skill usage in-session; this module persists the
 * count across sessions so the Stats tab and `/sf-skills metrics` have
 * something honest to show.
 *
 * Signal: explicit `/skill:<name>` invocations only — same trigger we
 * agreed on for v1. We listen on `before_agent_start` and parse the
 * raw user text via pi's `parseSkillBlock`, which is the exact code
 * path pi uses to expand the slash command into a system message.
 *
 * Two separate stores:
 *
 *   global  — `<globalAgentDir>/sf-pi/sf-skills/usage.json`
 *             via lib/common/state-store.ts (canonical path).
 *
 *   project — `<projectRoot>/.pi/sf-skills-usage.json` (only when cwd
 *             is inside the repo). We don't use state-store here
 *             because it always writes under the global agent dir.
 *
 * Both are atomic-write JSON with schemaVersion = 1.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createStateStore, type StateStore } from "../../../lib/common/state-store.ts";
import { projectConfigDir } from "../../../lib/common/pi-paths.ts";

// -------------------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------------------

export interface UsageRecord {
  count: number;
  /** ISO 8601 timestamp of the most recent invocation. */
  lastUsedAt: string;
}

export interface UsageState {
  /** schemaVersion for migrations — kept inside `state` for portability between scopes. */
  records: Record<string, UsageRecord>;
}

const SCHEMA_VERSION = 1;
const PROJECT_FILENAME = "sf-skills-usage.json";

// -------------------------------------------------------------------------------------------------
// Stores
// -------------------------------------------------------------------------------------------------

/** Global counters store — sits next to the rest of the sf-pi state files. */
export function globalUsageStore(): StateStore<UsageState> {
  return createStateStore<UsageState>({
    namespace: "sf-skills",
    filename: "usage.json",
    schemaVersion: SCHEMA_VERSION,
    defaults: { records: {} },
  });
}

/**
 * Project counters live under `<cwd>/.pi/sf-skills-usage.json`.
 *
 * We can't reuse createStateStore because it writes under the global
 * agent dir. Implementation matches state-store.ts atomic-write +
 * schemaVersion envelope so hand-edits remain forwards-compatible.
 */
export interface ProjectStore {
  read(): UsageState;
  write(state: UsageState): void;
  bump(name: string, when?: Date): UsageState;
  readonly path: string;
}

export function projectUsageStore(cwd: string): ProjectStore {
  const filePath = path.join(projectConfigDir(cwd), PROJECT_FILENAME);

  function read(): UsageState {
    if (!existsSync(filePath)) return { records: {} };
    try {
      const raw = readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return { records: {} };
      const env = parsed as { schemaVersion?: number; state?: { records?: unknown } };
      if (env.schemaVersion !== SCHEMA_VERSION) return { records: {} };
      const records = env.state?.records;
      if (!records || typeof records !== "object") return { records: {} };
      return { records: records as Record<string, UsageRecord> };
    } catch {
      return { records: {} };
    }
  }

  function write(state: UsageState): void {
    const dir = path.dirname(filePath);
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      return;
    }
    const envelope = { schemaVersion: SCHEMA_VERSION, state };
    const tmp = `${filePath}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
      renameSync(tmp, filePath);
    } catch {
      // best-effort
    }
  }

  function bump(name: string, when: Date = new Date()): UsageState {
    const current = read();
    const next: UsageState = { records: { ...current.records } };
    const prev = next.records[name] ?? { count: 0, lastUsedAt: "" };
    next.records[name] = { count: prev.count + 1, lastUsedAt: when.toISOString() };
    write(next);
    return next;
  }

  return { read, write, bump, path: filePath };
}

// -------------------------------------------------------------------------------------------------
// Public API used by the extension entry point
// -------------------------------------------------------------------------------------------------

/**
 * Bump the count for one skill name across both scopes.
 *
 * The project counter is only updated when `cwd` looks like a project
 * (a `.git` dir somewhere up the tree, or any non-undefined cwd in
 * v1 — we leave the trim-to-repo-root tightening for a follow-up
 * iteration so the data set lands first).
 */
export function recordSkillInvocation(name: string, cwd: string, when: Date = new Date()): void {
  const iso = when.toISOString();

  // Global
  globalUsageStore().update((current) => {
    const records = { ...current.records };
    const prev = records[name] ?? { count: 0, lastUsedAt: "" };
    records[name] = { count: prev.count + 1, lastUsedAt: iso };
    return { records };
  });

  // Project — only when cwd is non-trivial (covers most real sessions
  // and skips noisy ad-hoc cwd values like "/").
  if (cwd && cwd !== "/") {
    projectUsageStore(cwd).bump(name, when);
  }
}

/** Build a `name → record` map for quick row lookup in the datatable. */
export function loadUsageMap(
  scope: "global" | "project" | "all",
  cwd: string,
): Map<string, UsageRecord> {
  const merged = new Map<string, UsageRecord>();
  const merge = (records: Record<string, UsageRecord>) => {
    for (const [name, rec] of Object.entries(records)) {
      const existing = merged.get(name);
      if (!existing) {
        merged.set(name, rec);
        continue;
      }
      merged.set(name, {
        count: existing.count + rec.count,
        lastUsedAt: existing.lastUsedAt > rec.lastUsedAt ? existing.lastUsedAt : rec.lastUsedAt,
      });
    }
  };

  if (scope === "global" || scope === "all") merge(globalUsageStore().read().records);
  if ((scope === "project" || scope === "all") && cwd) {
    merge(projectUsageStore(cwd).read().records);
  }
  return merged;
}

/** Reset counters in a scope. Returns the count of entries cleared. */
export function resetUsage(scope: "global" | "project", cwd: string): number {
  if (scope === "global") {
    const store = globalUsageStore();
    const before = Object.keys(store.read().records).length;
    store.write({ records: {} });
    return before;
  }
  const store = projectUsageStore(cwd);
  const before = Object.keys(store.read().records).length;
  store.write({ records: {} });
  return before;
}
