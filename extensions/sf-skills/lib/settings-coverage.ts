/* SPDX-License-Identifier: Apache-2.0 */
/**
 * "Coverage" math for parent-dir vs. per-file skill wiring.
 *
 * Why this module exists
 * ----------------------
 * The datatable apply path used to push the resolved `SKILL.md` path
 * straight into `settings.skills[]`. That worked for skills that were
 * already wired by their exact path, but it produced two ugly outcomes
 * when the wiring was a parent directory (`~/.claude/skills`,
 * `~/.pi/agent/sf-skills/afv-library/skills`, etc.):
 *
 *   1. Toggling "enable" at a different scope just appended the file
 *      path. Pi loaded the same skill twice (parent dir in scope A,
 *      file path in scope B), tripped the name-collision rule, and
 *      logged a warning. Functionally noisy.
 *   2. Toggling "disable" tried to remove the file path from a
 *      settings file that only had the parent dir. The remove was a
 *      no-op. The skill stayed loaded. The UI lied.
 *
 * The fix is the auto-expand / auto-collapse flow we promised in the
 * sf-skills plan but did not ship in v1: when a parent dir covers a
 * skill the user wants to disable, replace that single parent entry
 * with per-file entries for every sibling EXCEPT the disabled one.
 *
 * This module owns just the math; the apply path in index.ts wires
 * the result into `updateSkillSources`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { globalSettingsPath, projectSettingsPath } from "../../../lib/common/pi-paths.ts";
import type { SkillSourceScope } from "../../../lib/common/skill-sources/skill-sources.ts";

// -------------------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------------------

/**
 * What needs to change in a single settings file to disable one skill.
 *
 *   coverage='exact'  — the file path is already in settings; just remove it.
 *   coverage='parent' — a parent dir is wired; expand it to per-file paths
 *                       for every sibling except the one we're disabling.
 *   coverage='none'   — neither the file nor any parent is wired; the skill
 *                       must be auto-discovered by pi (or bundled). The
 *                       caller should refuse the toggle.
 */
export type DisableCoverage = "exact" | "parent" | "none";

export interface DisablePlan {
  coverage: DisableCoverage;
  /** Settings file path we'd write to. */
  settingsPath: string;
  /** Entries to remove (verbatim, as they appear in settings). */
  remove: string[];
  /** Entries to add. Empty unless we're expanding a parent. */
  add: string[];
  /**
   * For parent expansion: the absolute path of the parent dir we expanded
   * + the count of sibling skills we're listing in its place. Useful for
   * "we just expanded `~/.claude/skills` into 12 per-file entries"
   * messages.
   */
  expandedFrom?: string;
  expandedSiblingCount?: number;
}

export interface PlanInput {
  /** Absolute path to the SKILL.md the user is disabling. */
  skillPath: string;
  /** Which settings file to mutate. */
  scope: SkillSourceScope;
  /** Working directory — needed to resolve project-scope paths. */
  cwd: string;
  /** Override $HOME for tests. */
  home?: string;
}

// -------------------------------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------------------------------

/**
 * Compute what to add/remove to disable `skillPath` in the given scope.
 *
 * Pure: reads the settings file + filesystem, returns a plan, never
 * writes. The caller passes the result to `updateSkillSources`.
 */
export function planDisable(input: PlanInput): DisablePlan {
  const home = input.home ?? os.homedir();
  const settingsPath =
    input.scope === "project" ? projectSettingsPath(input.cwd) : globalSettingsPath();
  const skillAbs = path.normalize(input.skillPath);

  const skills = readSkills(settingsPath);

  for (const entry of skills) {
    const entryAbs = path.normalize(expandSettingsValue(entry, settingsPath, home, input.cwd));
    if (!entryAbs) continue;

    if (entryAbs === skillAbs) {
      return { coverage: "exact", settingsPath, remove: [entry], add: [] };
    }
    // Strict prefix match — the entry must be a directory above the file.
    if (skillAbs.startsWith(`${entryAbs}${path.sep}`) && isDirectory(entryAbs)) {
      const siblings = listSkillFiles(entryAbs);
      const keep = siblings.filter((p) => path.normalize(p) !== skillAbs);
      return {
        coverage: "parent",
        settingsPath,
        remove: [entry],
        add: keep,
        expandedFrom: entryAbs,
        expandedSiblingCount: keep.length,
      };
    }
  }

  return { coverage: "none", settingsPath, remove: [], add: [] };
}

/**
 * Compute what to add to enable `skillPath` in the given scope.
 *
 * Pi loads skills additively from BOTH global and project settings. So
 * "already covered" must mean "covered in any scope" — not just the
 * target scope. If we only check the target scope, toggling p on a row
 * that's already wired globally appends the file path to project
 * settings, pi loads the same skill twice (parent dir from global +
 * file path from project), and the name-collision warning fires.
 *
 * The returned `coveredInScope` lets the caller surface a clear
 * message: "already loaded via global; toggle that scope first".
 */
export function planEnable(input: PlanInput): {
  alreadyCovered: boolean;
  coveredInScope?: SkillSourceScope;
  settingsPath: string;
  add: string[];
} {
  const home = input.home ?? os.homedir();
  const targetSettingsPath =
    input.scope === "project" ? projectSettingsPath(input.cwd) : globalSettingsPath();
  const skillAbs = path.normalize(input.skillPath);

  // Walk both scopes — target scope first so an exact-match in the
  // target wins for the `coveredInScope` reporting.
  const scopes: Array<{ scope: SkillSourceScope; settingsPath: string }> = [
    { scope: input.scope, settingsPath: targetSettingsPath },
    {
      scope: input.scope === "project" ? "global" : "project",
      settingsPath:
        input.scope === "project" ? globalSettingsPath() : projectSettingsPath(input.cwd),
    },
  ];

  for (const { scope, settingsPath } of scopes) {
    for (const entry of readSkills(settingsPath)) {
      const entryAbs = path.normalize(expandSettingsValue(entry, settingsPath, home, input.cwd));
      if (!entryAbs) continue;
      if (entryAbs === skillAbs) {
        return {
          alreadyCovered: true,
          coveredInScope: scope,
          settingsPath: targetSettingsPath,
          add: [],
        };
      }
      if (skillAbs.startsWith(`${entryAbs}${path.sep}`) && isDirectory(entryAbs)) {
        return {
          alreadyCovered: true,
          coveredInScope: scope,
          settingsPath: targetSettingsPath,
          add: [],
        };
      }
    }
  }

  return { alreadyCovered: false, settingsPath: targetSettingsPath, add: [input.skillPath] };
}

// -------------------------------------------------------------------------------------------------
// Internal helpers
// -------------------------------------------------------------------------------------------------

function readSkills(settingsPath: string): string[] {
  if (!existsSync(settingsPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const skills = (parsed as Record<string, unknown>).skills;
    return Array.isArray(skills) ? skills.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function expandSettingsValue(
  value: string,
  settingsPath: string,
  home: string,
  cwd: string,
): string {
  if (!value) return "";
  if (value.startsWith("~/")) return path.join(home, value.slice(2));
  if (value === "~") return home;
  if (path.isAbsolute(value)) return value;
  // Pi resolves relative entries against the settings file's directory
  // for project settings, and against $HOME for global settings.
  const isProject = settingsPath.includes(`${path.sep}.pi${path.sep}settings.json`);
  return path.resolve(isProject ? cwd : home, value);
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Recursively walk a directory and return absolute paths for every
 * SKILL.md we find. Mirrors pi's discovery convention: a directory
 * containing `SKILL.md` is one skill; loose `.md` files at the root
 * count too.
 *
 * The walk is bounded — we only recurse into directories that don't
 * begin with `.` to avoid scanning `.git` and friends. Errors on a
 * single entry don't stop the walk.
 */
function listSkillFiles(root: string): string[] {
  const out: string[] = [];
  walk(root, root, out, 0);
  return out;
}

function walk(root: string, cur: string, out: string[], depth: number): void {
  if (depth > 6) return; // safety cap
  let entries: string[];
  try {
    entries = readdirSync(cur);
  } catch {
    return;
  }
  // Loose .md at the root counts as a skill in the auto-discoverable
  // root convention; mirror that for parent dirs we expand.
  if (depth === 0) {
    for (const entry of entries) {
      if (entry.toLowerCase() === "skill.md") continue; // not at the root
      if (entry.toLowerCase().endsWith(".md")) {
        out.push(path.join(cur, entry));
      }
    }
  }
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const full = path.join(cur, entry);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const skillMd = path.join(full, "SKILL.md");
    if (existsSync(skillMd)) {
      out.push(skillMd);
      // Don't recurse into a skill that already declared itself.
      continue;
    }
    walk(root, full, out, depth + 1);
  }
}
