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

export type SnapshotOutputMode = "summary" | "artifact" | "full";

export interface SnapshotSummaryInput {
  snapshot: string;
  fullSnapshotPath: string;
  focus?: string[];
}

const MAX_LINE_BYTES = 260;
const MAX_FOCUS_LINES = 24;
const MAX_LANDMARK_LINES = 16;
const MAX_CONTROL_LINES = 28;
const MAX_TABLE_LINES = 24;
const MAX_ALERT_LINES = 12;

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
  const landmarks = collectMatching(lines, isLandmarkLine, MAX_LANDMARK_LINES, [
    ...focusMatches,
    ...alerts,
  ]);
  const controls = collectMatching(lines, isControlLine, MAX_CONTROL_LINES, [
    ...focusMatches,
    ...landmarks,
  ]);
  const tablePreview = collectMatching(lines, isTableLine, MAX_TABLE_LINES, [
    ...focusMatches,
    ...landmarks,
    ...controls,
  ]);

  const sections: string[] = ["Snapshot summary", `Full snapshot: ${input.fullSnapshotPath}`, ""];

  if (ignoredFocusTerms.length) {
    sections.push(
      `Ignored short focus terms: ${ignoredFocusTerms.join(", ")}. Use at least 3 characters to avoid noisy matches.`,
    );
    sections.push("");
  }

  appendSection(sections, "Focus matches", focusMatches);
  appendSection(sections, "Alerts / validation", alerts);
  appendSection(sections, "Page landmarks", landmarks);
  appendSection(sections, "Key controls", controls);
  appendSection(sections, "Table/list preview", tablePreview);

  if (
    !focusMatches.length &&
    !alerts.length &&
    !landmarks.length &&
    !controls.length &&
    !tablePreview.length
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

function normalizeFocusTerms(rawTerms: string[]): {
  focusTerms: string[];
  ignoredFocusTerms: string[];
} {
  const focusTerms: string[] = [];
  const ignoredFocusTerms: string[] = [];
  for (const raw of rawTerms) {
    const term = raw.trim();
    if (!term) continue;
    if (term.length < 3) {
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

function collectMatching(
  lines: string[],
  predicate: (line: string) => boolean,
  limit: number,
  exclude: string[],
): string[] {
  const excluded = new Set(exclude);
  const out: string[] = [];
  for (const line of lines) {
    const formatted = formatLine(line);
    if (excluded.has(formatted)) continue;
    if (!predicate(line)) continue;
    out.push(formatted);
    if (out.length >= limit) break;
  }
  return unique(out);
}

function isAlertLine(line: string): boolean {
  return (
    /^- alert/.test(line) ||
    /Please fix the following/i.test(line) ||
    /\b(error|invalid|insufficient|not allowed)\b/i.test(line) ||
    /can't /i.test(line)
  );
}

function isLandmarkLine(line: string): boolean {
  return (
    /^- heading /.test(line) ||
    /^- tab ".*" \[selected/.test(line) ||
    /^- treeitem ".*" .*selected/.test(line) ||
    /^- link "SETUP"/.test(line)
  );
}

function isControlLine(line: string): boolean {
  return /^- (button|switch|combobox|searchbox|textbox|link) /.test(line);
}

function isTableLine(line: string): boolean {
  return /^- (columnheader|rowheader|gridcell|cell) /.test(line);
}

function appendSection(lines: string[], title: string, items: string[]): void {
  if (items.length === 0) return;
  lines.push(`${title}:`);
  for (const item of items) lines.push(`- ${item}`);
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

function formatLine(line: string): string {
  return truncateLine(line.replace(/\s+/g, " "), MAX_LINE_BYTES).text;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
