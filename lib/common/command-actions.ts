/* SPDX-License-Identifier: Apache-2.0 */
/**
 * One catalog drives every command surface.
 *
 * ADR 0005 ("Standard Pi-Native Command Panels") asks each command-bearing
 * extension to define its action metadata once and reuse it for:
 *
 *   1. The no-args slash-command panel rows (open via openCommandPanel)
 *   2. `getArgumentCompletions()` returned to Pi
 *   3. `/<id> help` text
 *   4. The README command table
 *
 * Today most extensions hand-maintain those four surfaces independently
 * and they drift. This module centralizes the shape so new (and migrating)
 * extensions can declare the catalog in one place and feed it into every
 * surface with helper functions instead of bespoke parallel lists.
 *
 * Adoption is incremental — the existing `CommandPanelAction` type is still
 * exported from `./command-panel.ts`, and `SfPiCommandAction` is structurally
 * a superset, so panels accept both. New code should prefer
 * `SfPiCommandAction`; old code can migrate one extension at a time.
 *
 * Example:
 *
 * ```ts
 * import {
 *   type SfPiCommandAction,
 *   getCompletionsFromActions,
 *   formatHelpFromActions,
 * } from "../../lib/common/command-actions.ts";
 *
 * const ACTIONS: SfPiCommandAction<"status" | "refresh" | "help" | "close">[] = [
 *   { value: "status", label: "Show status", description: "…", group: "Diagnostics" },
 *   { value: "refresh", label: "Refresh", description: "…", group: "Diagnostics" },
 *   { value: "help", label: "Show help", description: "…", group: "Reference" },
 *   { value: "close", label: "Close", description: "Dismiss this panel.", group: "Lifecycle" },
 * ];
 *
 * pi.registerCommand("sf-foo", {
 *   description: "…",
 *   getArgumentCompletions: (prefix) => getCompletionsFromActions(ACTIONS, prefix),
 *   handler: async (args, ctx) => {
 *     if (!args && ctx.hasUI) return openPanel(ctx);
 *     if (args.trim() === "help") {
 *       ctx.ui.notify(formatHelpFromActions(ACTIONS, "sf-foo"), "info");
 *       return;
 *     }
 *     // …
 *   },
 * });
 * ```
 */
import type { CommandPanelAction } from "./command-panel.ts";

/**
 * One row in an extension's action catalog.
 *
 * Compatible with `CommandPanelAction` from ./command-panel.ts so the same
 * objects can be passed straight to `openCommandPanel`. Extra fields are
 * optional and only consumed by the helper functions below.
 */
export interface SfPiCommandAction<T extends string = string> extends CommandPanelAction<T> {
  /**
   * Logical area the action belongs to. Pure UI hint for filters and
   * tooling; the panel itself uses `group` for display.
   */
  section?: "status" | "setup" | "diagnostics" | "tools" | "help" | "lifecycle";
  /**
   * Hidden actions still exist in the catalog (so /help can describe
   * legacy aliases) but are filtered out of the panel and completions.
   */
  hidden?: boolean;
  /**
   * When set, marks the action as needing user confirmation or write
   * permission. Only advisory; gating still happens in the action handler.
   */
  danger?: "none" | "confirm" | "write";
  /**
   * Slash-command aliases accepted by the parser, e.g. "dr" → "doctor".
   * Surfaced in /help and completions when present.
   */
  aliases?: readonly string[];
}

/**
 * Pi `getArgumentCompletions` helper. Returns null when no actions match
 * (Pi treats that as "no autocompletion" instead of an empty list).
 *
 * Matches by prefix against `value` and any declared aliases.
 */
export function getCompletionsFromActions<T extends string>(
  actions: readonly SfPiCommandAction<T>[],
  prefix: string,
  options?: { excludeValues?: readonly T[] },
): { value: string; label: string; description: string }[] | null {
  const exclude = new Set<string>(options?.excludeValues ?? []);
  const lower = prefix.trim().toLowerCase();
  const matches: { value: string; label: string; description: string }[] = [];

  for (const action of actions) {
    if (action.hidden) continue;
    if (exclude.has(action.value)) continue;
    const candidates = [action.value, ...(action.aliases ?? [])];
    const hit = candidates.find((c) => c.toLowerCase().startsWith(lower));
    if (!hit) continue;
    matches.push({
      value: hit,
      label: hit,
      description: action.description,
    });
  }

  return matches.length > 0 ? matches : null;
}

/**
 * Resolve a typed sub-command string to an action value, accepting
 * aliases. Returns null when nothing matches — callers can then fall
 * back to an "unknown subcommand" message.
 */
export function resolveAction<T extends string>(
  actions: readonly SfPiCommandAction<T>[],
  raw: string,
): T | null {
  const needle = raw.trim().toLowerCase();
  if (needle.length === 0) return null;
  for (const action of actions) {
    if (action.value.toLowerCase() === needle) return action.value;
    if (action.aliases?.some((a) => a.toLowerCase() === needle)) return action.value;
  }
  return null;
}

/**
 * Format a plain-text `/help` block from the catalog. Skips hidden
 * actions and groups by `group` (or `section` when no group is set).
 *
 * The output deliberately stays text-only so the same string works in
 * `ctx.ui.notify`, headless print mode, and an `openInfoPanel` body.
 */
export function formatHelpFromActions<T extends string>(
  actions: readonly SfPiCommandAction<T>[],
  commandName: string,
): string {
  const visible = actions.filter((a) => !a.hidden);
  if (visible.length === 0) return `/${commandName} — no subcommands.`;

  const buckets = new Map<string, SfPiCommandAction<T>[]>();
  for (const action of visible) {
    const key = action.group ?? action.section ?? "Actions";
    const list = buckets.get(key) ?? [];
    list.push(action);
    buckets.set(key, list);
  }

  const lines: string[] = [`/${commandName} subcommands:`];
  for (const [groupName, items] of buckets) {
    lines.push("");
    lines.push(`${groupName}:`);
    for (const action of items) {
      const aliases = action.aliases?.length ? ` (alias: ${action.aliases.join(", ")})` : "";
      lines.push(`  /${commandName} ${action.value}${aliases} — ${action.description}`);
    }
  }
  return lines.join("\n");
}

/**
 * Render a Markdown table suitable for an extension README. Hidden
 * actions are omitted. Useful in the per-extension README "Commands"
 * section so the table never drifts from the catalog.
 */
export function formatReadmeTableFromActions<T extends string>(
  actions: readonly SfPiCommandAction<T>[],
  commandName: string,
): string {
  const visible = actions.filter((a) => !a.hidden);
  const rows = [
    "| Subcommand | Description |",
    "| --- | --- |",
    ...visible.map(
      (action) =>
        `| \`/${commandName} ${action.value}\` | ${action.description.replace(/\|/g, "\\|")} |`,
    ),
  ];
  return rows.join("\n");
}
