/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Pi-native snapshot summarization for SF Browser.
 *
 * agent-browser's raw accessibility tree is excellent for fidelity, but it is
 * too large to send into model context by default on Salesforce pages. This
 * module keeps the default result decision-oriented while preserving the raw
 * snapshot as an artifact.
 */
import { truncateLine } from "@earendil-works/pi-coding-agent";
import { deriveLightningState, formatLightningState } from "./lightning-state.ts";
import { redactUrl } from "./redaction.ts";

export type SnapshotOutputMode = "summary" | "artifact" | "full";

export interface SnapshotSummaryInput {
  snapshot: string;
  fullSnapshotPath: string;
  focus?: string[];
  url?: string;
}

const MAX_LINE_BYTES = 260;
const MAX_FOCUS_LINES = 24;
const MAX_ALERT_LINES = 12;
const MAX_ACTION_LINES = 28;
const MAX_NAV_LINES = 12;
const MAX_COLUMNS = 10;
const MAX_ROWS = 8;
const MIN_FOCUS_TERM_LENGTH = 3;

const GLOBAL_CHROME_LABELS = [
  "Skip to Navigation",
  "Skip to Main Content",
  "Global Actions",
  "Guidance Center",
  "Salesforce Help",
  "Setup",
  "Notifications",
  "View profile",
  "App Launcher",
  "Object Manager List",
  "Favorites list",
  "This item doesn't support favorites",
  "Search Setup",
  "Quick Find",
] as const;

const PRIMARY_ACTION_LABELS = [
  "Save",
  "Cancel",
  "Edit",
  "Delete",
  "New",
  "New Agent",
  "New Flow",
  "New External Client App",
  "Add",
  "Remove",
  "Edit Assignments",
  "Reset Password",
  "Freeze",
  "View Summary",
  "Go to Agentforce Studio",
] as const;

const LOW_VALUE_HEADINGS = new Set(["ADMINISTRATION", "PLATFORM TOOLS", "SETTINGS"]);

export function snapshotOutputModeFromUnknown(value: unknown): SnapshotOutputMode {
  return value === "artifact" || value === "full" || value === "summary" ? value : "summary";
}

export function summarizeSnapshot(input: SnapshotSummaryInput): string {
  const lines = input.snapshot
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const { focusTerms, ignoredFocusTerms } = normalizeFocusTerms(input.focus ?? []);
  const focusMatches = collectFocusMatches(lines, focusTerms);
  const alerts = collectAlerts(lines, focusMatches);
  const page = summarizePage(lines, input.url, focusTerms);
  const lightningState = formatLightningState(deriveLightningState({ url: input.url, lines }));
  const surface = classifySurface(lines, input.url);
  const actions = collectPrimaryActions(lines, alerts);
  const setupNavigation = collectSetupNavigation(lines, focusMatches);
  const tableSummary = summarizeTables(lines, focusTerms);

  const sections: string[] = ["🧭 Snapshot summary", ""];
  appendSection(sections, "📍 Page", page);
  appendSection(sections, "⚡ Lightning state", lightningState);
  appendSection(sections, "🧭 Surface", surface);
  if (ignoredFocusTerms.length) {
    appendSection(sections, "🔎 Focus notes", [
      `Ignored short focus terms: ${ignoredFocusTerms.join(", ")}. Use at least ${MIN_FOCUS_TERM_LENGTH} characters to avoid noisy matches.`,
    ]);
  }
  appendSection(sections, "⚠️ Alerts / validation", alerts);
  appendSection(sections, "🎯 Primary actions", actions);
  appendSection(sections, "🗂️ Setup navigation", setupNavigation);
  appendSection(sections, "📊 Tables / lists", tableSummary);
  appendSection(sections, "🔎 Focus matches", focusMatches);
  appendSection(sections, "📄 Artifact", [`Full snapshot: ${input.fullSnapshotPath}`]);

  if (
    !alerts.length &&
    !actions.length &&
    !setupNavigation.length &&
    !tableSummary.length &&
    !focusMatches.length
  ) {
    sections.push(
      "No compact summary lines matched. Use outputMode=full or inspect the full snapshot artifact.",
    );
  } else {
    sections.push("Use outputMode=full only when the compact summary misses needed refs.");
  }

  return sections
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function summarizePage(lines: string[], url: string | undefined, focusTerms: string[]): string[] {
  const headingLines = lines.filter((line) => /^- heading /.test(line));
  const focusHeadings = headingLines.filter((line) =>
    focusTerms.some((term) => line.toLowerCase().includes(term.toLowerCase())),
  );
  const usefulHeadings = headingLines.filter(
    (line) => !LOW_VALUE_HEADINGS.has(extractQuotedName(line)),
  );
  const headings = unique(
    [...focusHeadings, ...usefulHeadings, ...headingLines].map(formatLine),
  ).slice(0, 4);
  return [
    url ? `URL: ${redactUrl(url) ?? url}` : undefined,
    ...headings.map((heading) => `Heading: ${heading}`),
  ].filter((line): line is string => !!line);
}

function classifySurface(lines: string[], url: string | undefined): string[] {
  const joined = lines.join("\n");
  const safeUrl = url ?? "";
  if (/heading "Page not found"/i.test(joined)) return ["Setup page not found"];
  if (
    /\/builder\//i.test(safeUrl) ||
    /\/flowBuilder\//i.test(safeUrl) ||
    /heading "(Flow Builder|Agentforce Builder|Lightning App Builder|Prompt Builder|Testing Center)"/i.test(
      joined,
    )
  ) {
    return ["Builder surface"];
  }
  if (
    /\/lightning\/setup\/ObjectManager/i.test(safeUrl) ||
    /tab "Object Manager" \[selected/i.test(joined)
  ) {
    return ["Object Manager page"];
  }
  if (/\/lightning\/r\//i.test(safeUrl)) return ["Record page"];
  if (/\/lightning\/o\/[^/]+\/new\b/i.test(safeUrl)) return ["Object new page"];
  if (/\/lightning\/o\//i.test(safeUrl)) return ["List view"];
  if (/\/lightning\/(page|n)\//i.test(safeUrl)) return ["Lightning app/page"];

  const iframe = lines.find((line) => /^- Iframe /.test(line));
  if (iframe || /LayoutTable|Classic Setup Surface/i.test(joined)) {
    return [
      "Classic Setup Surface inside iframe",
      ...(iframe ? [`Iframe: ${formatLine(iframe)}`] : []),
    ];
  }
  if (/\/lightning\/setup\//i.test(safeUrl) || /link "SETUP"/.test(joined)) {
    return ["Lightning Setup page"];
  }
  return ["Unknown Salesforce page"];
}

function normalizeFocusTerms(rawTerms: string[]): {
  focusTerms: string[];
  ignoredFocusTerms: string[];
} {
  const focusTerms: string[] = [];
  const ignoredFocusTerms: string[] = [];
  for (const raw of rawTerms) {
    const term = raw.trim();
    if (!term) continue;
    if (term.length < MIN_FOCUS_TERM_LENGTH) {
      ignoredFocusTerms.push(term);
      continue;
    }
    focusTerms.push(term);
  }
  return { focusTerms, ignoredFocusTerms };
}

function collectFocusMatches(lines: string[], focusTerms: string[]): string[] {
  if (focusTerms.length === 0) return [];
  const lowered = focusTerms.map((term) => term.toLowerCase());
  return unique(
    lines
      .filter((line) => {
        const lower = line.toLowerCase();
        return lowered.some((term) => lower.includes(term));
      })
      .slice(0, MAX_FOCUS_LINES)
      .map(formatLine),
  );
}

function collectAlerts(lines: string[], exclude: string[]): string[] {
  const excluded = new Set(exclude);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!isAlertLine(line)) continue;
    for (const nearby of lines.slice(i, i + 10)) {
      const formatted = formatAlertLine(nearby);
      if (!formatted || excluded.has(formatted)) continue;
      out.push(formatted);
      if (out.length >= MAX_ALERT_LINES) return unique(out);
    }
  }
  return unique(out);
}

function collectPrimaryActions(lines: string[], exclude: string[]): string[] {
  const excluded = new Set(exclude);
  const out: string[] = [];
  for (const line of lines) {
    const formatted = formatLine(line);
    if (excluded.has(formatted)) continue;
    if (isGlobalChromeLine(line)) continue;
    if (!isPrimaryActionLine(line)) continue;
    out.push(formatted);
    if (out.length >= MAX_ACTION_LINES) break;
  }
  return unique(out);
}

function collectSetupNavigation(lines: string[], exclude: string[]): string[] {
  const excluded = new Set(exclude);
  const out: string[] = [];
  for (const line of lines) {
    if (!isSetupNavigationLine(line)) continue;
    const formatted = formatLine(line);
    if (excluded.has(formatted)) continue;
    out.push(formatted);
    if (out.length >= MAX_NAV_LINES) break;
  }
  return unique(out);
}

function summarizeTables(lines: string[], focusTerms: string[]): string[] {
  const columns = lines.filter((line) => /^- columnheader /.test(line)).map(extractQuotedName);
  const rows = lines
    .filter((line) => /^- rowheader /.test(line))
    .map(extractQuotedName)
    .map(cleanRowName);
  const focusRows = collectFocusRows(lines, focusTerms);
  const out: string[] = [];
  if (columns.length) out.push(`Columns: ${unique(columns).slice(0, MAX_COLUMNS).join(", ")}`);
  if (rows.length) out.push(`Rows: ${unique(rows).slice(0, MAX_ROWS).join("; ")}`);
  if (focusRows.length) out.push(`Focus rows/cells: ${focusRows.join("; ")}`);
  return out;
}

function collectFocusRows(lines: string[], focusTerms: string[]): string[] {
  if (!focusTerms.length) return [];
  const lowered = focusTerms.map((term) => term.toLowerCase());
  return unique(
    lines
      .filter((line) => isTableLine(line))
      .filter((line) => {
        const lower = line.toLowerCase();
        return lowered.some((term) => lower.includes(term));
      })
      .map(extractQuotedName)
      .map(cleanRowName)
      .filter(Boolean)
      .slice(0, MAX_ROWS),
  );
}

function isAlertLine(line: string): boolean {
  if (/^- (option|treeitem|link|cell|gridcell|rowheader|columnheader)\b/.test(line)) return false;
  if (/^- alert/.test(line)) return true;
  if (!/^- (StaticText|heading|paragraph|text)\b/.test(line)) return false;
  return (
    /Please fix the following|Review the errors|Complete this field|required field|invalid value/i.test(
      line,
    ) ||
    /\b(insufficient|not allowed)\b/i.test(line) ||
    /can't /i.test(line)
  );
}

function isPrimaryActionLine(line: string): boolean {
  if (/^- (switch|checkbox|combobox|searchbox|textbox|listbox) /.test(line)) return true;
  if (!/^- (button|link) /.test(line)) return false;
  const label = extractQuotedName(line);
  if (!label) return false;
  return PRIMARY_ACTION_LABELS.some(
    (primary) => label === primary || label.startsWith(`${primary} `),
  );
}

function isSetupNavigationLine(line: string): boolean {
  return /^- treeitem ".*" .*selected/.test(line) || /^- link "SETUP"/.test(line);
}

function isTableLine(line: string): boolean {
  return /^- (columnheader|rowheader|gridcell|cell) /.test(line);
}

function isGlobalChromeLine(line: string): boolean {
  const label = extractQuotedName(line);
  if (!label) return false;
  return GLOBAL_CHROME_LABELS.some((global) => label === global || label.startsWith(`${global} `));
}

function appendSection(lines: string[], title: string, items: Array<string | undefined>): void {
  const present = items.filter((item): item is string => !!item);
  if (present.length === 0) return;
  lines.push(`${title}:`);
  for (const item of present) lines.push(`- ${item}`);
  lines.push("");
}

function formatAlertLine(line: string): string | null {
  const staticText = line.match(/StaticText "(.*)"/);
  const genericText = staticText?.[1] ?? line;
  const normalized = genericText.replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (/^- (generic|image|layouttable|layouttablerow|layouttablecell)/i.test(normalized))
    return null;
  return formatLine(normalized);
}

function cleanRowName(value: string): string {
  return redactSnapshotText(value.replace(/^Expand\s+(.+)\s+\1$/, "$1"));
}

function extractQuotedName(line: string): string {
  const value = line.match(/"([^"]+)"/)?.[1] ?? formatLine(line).replace(/^- \w+ /, "");
  return redactSnapshotText(value);
}

function formatLine(line: string): string {
  return truncateLine(redactSnapshotText(line).replace(/\s+/g, " "), MAX_LINE_BYTES).text;
}

function redactSnapshotText(text: string): string {
  return text
    .replace(/\bWelcome,\s*[^,"]+/gi, "Welcome, <user>")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<email>")
    .replace(/https?:\/\/[^\s"]+/gi, "<url>");
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
