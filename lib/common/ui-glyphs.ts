/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Semantic UI glyphs for SF Pi command panels and popups.
 *
 * This sits on top of the shared glyph policy used by the DevBar: rich glyphs
 * on capable terminals, ASCII fallbacks when `SF_PI_ASCII_ICONS=1` or
 * `sfPi.asciiIcons` asks for them.
 */
import { resolveGlyphMode, type GlyphMode } from "./glyph-policy.ts";

export interface UiGlyphs {
  mode: GlyphMode;
  status: string;
  actions: string;
  selected: string;
  setup: string;
  controls: string;
  diagnostics: string;
  discovery: string;
  troubleshooting: string;
  utilities: string;
  reference: string;
  scope: string;
  links: string;
  feedback: string;
  success: string;
  info: string;
  warning: string;
  error: string;
  loading: string;
  selectedRow: string;
}

const RICH: Omit<UiGlyphs, "mode"> = {
  status: "◆",
  actions: "▸",
  selected: "◆",
  setup: "⚙",
  controls: "◉",
  diagnostics: "🩺",
  discovery: "🔎",
  troubleshooting: "🛠",
  utilities: "◧",
  reference: "?",
  scope: "◈",
  links: "🔗",
  feedback: "✎",
  success: "✓",
  info: "ⓘ",
  warning: "⚠",
  error: "✗",
  loading: "◐",
  selectedRow: "→",
};

const ASCII: Omit<UiGlyphs, "mode"> = {
  status: "*",
  actions: ">",
  selected: ">",
  setup: "*",
  controls: "o",
  diagnostics: "!",
  discovery: "?",
  troubleshooting: "!",
  utilities: "+",
  reference: "?",
  scope: "#",
  links: "@",
  feedback: "+",
  success: "+",
  info: "i",
  warning: "!",
  error: "x",
  loading: "~",
  selectedRow: ">",
};

export function resolveUiGlyphs(cwd: string): UiGlyphs {
  const mode = resolveGlyphMode({ cwd });
  return { mode, ...(mode === "ascii" ? ASCII : RICH) };
}

export function iconForCommandGroup(group: string, glyphs: UiGlyphs): string {
  const normalized = group.trim().toLowerCase();
  if (normalized.includes("scope")) return glyphs.scope;
  if (normalized.includes("setup")) return glyphs.setup;
  if (normalized.includes("control")) return glyphs.controls;
  if (normalized.includes("troubleshoot")) return glyphs.troubleshooting;
  if (normalized.includes("diagnostic")) return glyphs.diagnostics;
  if (normalized.includes("discovery")) return glyphs.discovery;
  if (normalized.includes("utilit")) return glyphs.utilities;
  if (normalized.includes("reference")) return glyphs.reference;
  if (normalized.includes("feedback") || normalized.includes("create issue"))
    return glyphs.feedback;
  if (normalized.includes("link")) return glyphs.links;
  if (normalized.includes("status")) return glyphs.status;
  return glyphs.actions;
}

export function iconForSeverity(
  severity: "info" | "warning" | "error" | "success",
  glyphs: UiGlyphs,
): string {
  if (severity === "success") return glyphs.success;
  if (severity === "warning") return glyphs.warning;
  if (severity === "error") return glyphs.error;
  return glyphs.info;
}
