/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Mutate result renderer.
 *
 * Renders a small "diff card" showing what changed structurally, with the
 * recompile result inline (✓ N issues post-mutate, or rolled-back hint).
 */

import { Text } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { clipLine, fmtMs } from "./shared.ts";

export interface MutateResultDetails {
  ok?: boolean;
  op?: string;
  path?: string;
  component?: string;
  field?: string;
  before?: unknown;
  after?: unknown;
  dry_run?: boolean;
  written?: boolean;
  reason?: string;
  reason_detail?: string;
  diagnostics_after?: Array<{
    severity: number;
    code?: string;
    message?: string;
    range?: { start?: { line?: number } };
  }>;
  diagnostics_after_clean?: boolean;
  // For apply_quick_fix
  diagnostic_code?: string;
  line?: number;
  // Stats from the mutation engine, when present.
  duration_ms?: number;
}

interface MutateArgs {
  op?: string;
  path?: string;
  component?: string;
  field?: string;
  diagnostic_code?: string;
  line?: number;
  dry_run?: boolean;
}

// ─── renderCall ───────────────────────────────────────────────────────────────

export function renderMutateCall(args: MutateArgs, theme: Theme): Text {
  const label = theme.fg("toolTitle", theme.bold("🧬 Agent Script mutate "));
  const op = args.op ?? "?";
  let summary = `${op}`;
  if (op === "set_field" && args.component && args.field) {
    summary = `set_field · ${args.component}.${args.field}`;
  } else if (op === "apply_quick_fix") {
    summary = `apply_quick_fix · ${args.diagnostic_code ?? "?"} @ L${args.line ?? "?"}`;
  } else if (op === "rename") {
    summary = `rename`;
  }
  if (args.dry_run) summary += theme.fg("warning", " (dry-run)");
  return new Text(label + theme.fg("muted", summary), 0, 0);
}

// ─── renderResult ─────────────────────────────────────────────────────────────

export function renderMutateResult(
  result: { details?: MutateResultDetails | unknown; content?: unknown[] },
  opts: { isPartial?: boolean; expanded?: boolean },
  theme: Theme,
): Text {
  if (opts.isPartial) return new Text(theme.fg("warning", "🧬 mutate · running…"), 0, 0);
  const details = (result.details ?? {}) as MutateResultDetails;
  if (!details.ok) {
    return new Text(
      theme.fg("error", `✗ ${getFirstText(result.content) || "mutate failed"}`),
      0,
      0,
    );
  }
  return new Text(formatMutateBody(details, theme, /*ansi=*/ true), 0, 0);
}

// ─── Markdown emitter ─────────────────────────────────────────────────────────

export function mutateResultMarkdown(details: MutateResultDetails): string {
  return formatMutateBody(details, undefined, /*ansi=*/ false);
}

// ─── Shared body formatter ────────────────────────────────────────────────────

function formatMutateBody(
  details: MutateResultDetails,
  theme: Theme | undefined,
  ansi: boolean,
): string {
  const fg = (token: Parameters<Theme["fg"]>[0], s: string): string =>
    theme ? theme.fg(token, s) : s;
  const bold = (s: string): string => (theme ? theme.bold(s) : `**${s}**`);
  const dim = (s: string): string => fg("dim", s);
  const ok = (s: string): string => fg("success", s);
  const err = (s: string): string => fg("error", s);
  const warn = (s: string): string => fg("warning", s);
  const code = (s: string): string => fg("mdCode", s);

  const lines: string[] = [];

  // Header
  const dryTag = details.dry_run ? warn(" (dry-run)") : "";
  const target = [details.component, details.field].filter(Boolean).join(".");
  const headerExtras: string[] = [];
  if (details.op === "apply_quick_fix" && details.diagnostic_code) {
    headerExtras.push(code(details.diagnostic_code));
  }
  if (details.duration_ms) headerExtras.push(dim(fmtMs(details.duration_ms)));
  const headerExtrasStr = headerExtras.length ? "  " + headerExtras.join(" · ") : "";
  lines.push(
    bold(`🧬 ${details.op ?? "?"}${target ? "  " + code(target) : ""}`) + dryTag + headerExtrasStr,
  );

  // Diff card — only render when before/after look like scalars.
  const beforeStr = scalarToStr(details.before);
  const afterStr = scalarToStr(details.after);
  if (beforeStr !== undefined || afterStr !== undefined) {
    lines.push("");
    if (beforeStr !== undefined) lines.push(`  ${err("-")} ${dim(clipLine(beforeStr, 100))}`);
    if (afterStr !== undefined) lines.push(`  ${ok("+")} ${clipLine(afterStr, 100)}`);
  }

  // Recompile result
  lines.push("");
  if (details.reason === "emit_regression") {
    lines.push(
      err(
        "🧯 Refused to write — SDK emit produced a regression. The file on disk was NOT modified.",
      ),
    );
    if (details.reason_detail) lines.push(dim(`   ${clipLine(details.reason_detail, 200)}`));
    return lines.join("\n");
  }
  const diags = details.diagnostics_after ?? [];
  if (diags.length === 0) {
    const ms = details.duration_ms ? ` ${dim(`(${fmtMs(details.duration_ms)})`)}` : "";
    lines.push(`  ${ok("✅")} recompile clean${ms}`);
  } else {
    const sev1 = diags.filter((d) => d.severity === 1).length;
    const sev2 = diags.filter((d) => d.severity === 2).length;
    const bits: string[] = [];
    if (sev1 > 0) bits.push(err(`${sev1} error${sev1 === 1 ? "" : "s"}`));
    if (sev2 > 0) bits.push(warn(`${sev2} warning${sev2 === 1 ? "" : "s"}`));
    lines.push(`  ${warn("⚠")} recompile after mutate: ${bits.join(", ")}`);
    for (const d of diags.slice(0, 3)) {
      const dot = d.severity === 1 ? err("●") : warn("⚠");
      const ln = (d.range?.start?.line ?? 0) + 1;
      lines.push(
        `     ${dot} ${code(d.code ?? "(no-code)")} ${dim(`L${ln}`)} ${clipLine(d.message ?? "", 70)}`,
      );
    }
  }

  if (details.dry_run) {
    lines.push("");
    lines.push(dim("ⓘ dry-run: no file written. Re-run without dry_run=true to apply."));
  }

  void ansi;
  return lines.join("\n");
}

function scalarToStr(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  // Skip objects/arrays — diff card is for scalar fields.
  return undefined;
}

function getFirstText(content: unknown[] | undefined): string {
  const first = content?.[0];
  if (typeof first !== "object" || first === null || !("text" in first)) return "";
  const text = (first as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}
