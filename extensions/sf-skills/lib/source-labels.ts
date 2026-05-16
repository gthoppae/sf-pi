/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Convert a raw SKILL.md path into a friendly, scannable source label.
 *
 * The datatable used to render the path-tail (`~/.claude/skills/sf-ai-…`)
 * which truncated to ellipsis on every row and made the column useless.
 * This module names the actual *harness* a skill came from so the
 * "Where it's loaded" column reads as English at a glance:
 *
 *   Claude Code · OpenAI Codex · Cursor
 *   afv-library (global) · afv-library (project)
 *   sf-pi extension (sf-data360)
 *   pi-web-access (npm package)
 *   ~/.pi/agent/skills (auto)
 *
 * No I/O. Pure path inspection.
 */
import os from "node:os";
import path from "node:path";
import { managedClonePath } from "./defaults.ts";

export interface SourceLabelInput {
  skillPath: string;
  cwd: string;
  /** Override $HOME for tests. */
  homeDir?: string;
}

/** Single function consumed by table-data.ts when populating each row. */
export function friendlySourceLabel(input: SourceLabelInput): string {
  const home = input.homeDir ?? os.homedir();
  const abs = path.normalize(input.skillPath);

  // 1. afv-library managed clones (global + project) — we own these.
  const globalAfv = path.normalize(managedClonePath("global"));
  if (isUnder(abs, globalAfv)) return "afv-library (global)";
  const projectAfv = safeProjectAfv(input.cwd);
  if (projectAfv && isUnder(abs, projectAfv)) return "afv-library (project)";

  // 2. Skills bundled inside an sf-pi extension.
  const bundled = /[\\/]extensions[\\/](sf-[^\\/]+)[\\/]skills[\\/]/.exec(abs);
  if (bundled) return `sf-pi extension (${bundled[1]})`;

  // 3. Recognized external skill harnesses (always live under $HOME).
  if (isUnder(abs, path.join(home, ".claude", "skills"))) return "Claude Code";
  if (isUnder(abs, path.join(home, ".codex", "skills"))) return "OpenAI Codex";
  if (isUnder(abs, path.join(home, ".cursor", "skills"))) return "Cursor";

  // 4. Pi auto-discovery roots — labeled "(auto)" so the user knows
  //    settings.skills[] doesn't reach it.
  if (isUnder(abs, path.join(home, ".pi", "agent", "skills"))) {
    return "~/.pi/agent/skills (auto)";
  }
  if (isUnder(abs, path.join(home, ".agents", "skills"))) {
    return "~/.agents/skills (auto)";
  }
  if (isUnder(abs, path.join(input.cwd, ".pi", "skills"))) {
    return "<project>/.pi/skills (project)";
  }
  if (isUnder(abs, path.join(input.cwd, ".agents", "skills"))) {
    return "<project>/.agents/skills (project)";
  }

  // 5. Skills shipped inside an npm package (pi packages, e.g. pi-web-access).
  const npm = /[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?([^\\/]+)[\\/]skills[\\/]/.exec(abs);
  if (npm) return `${npm[1]} (npm package)`;

  // 6. Fallback: tilde / relative form so the user sees a recognizable
  //    path even when nothing matched. Always show the *containing dir*,
  //    not the SKILL.md filename.
  const dir = path.dirname(abs);
  if (dir.startsWith(`${home}${path.sep}`) || dir === home) {
    return `~/${path.relative(home, dir)}`;
  }
  if (dir.startsWith(`${input.cwd}${path.sep}`) || dir === input.cwd) {
    return `./${path.relative(input.cwd, dir)}`;
  }
  return dir;
}

/** Friendly label for the Wired column. Replaces the cryptic G/P/G+P. */
export function friendlyWiredLabel(wired: "global" | "project" | "both" | "none"): string {
  if (wired === "global") return "Global";
  if (wired === "project") return "Project";
  if (wired === "both") return "Both";
  return "—";
}

// -------------------------------------------------------------------------------------------------
// Internal
// -------------------------------------------------------------------------------------------------

function isUnder(abs: string, root: string): boolean {
  if (!root) return false;
  const r = path.normalize(root);
  return abs === r || abs.startsWith(`${r}${path.sep}`);
}

function safeProjectAfv(cwd: string): string | undefined {
  try {
    return path.normalize(managedClonePath("project", cwd));
  } catch {
    return undefined;
  }
}
