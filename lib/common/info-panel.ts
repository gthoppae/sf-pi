/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared in-TUI information popup for command panels.
 *
 * Use this for status/help/result text that is part of an interactive command
 * flow. It keeps output close to the panel instead of appending long blocks to
 * the transcript. Headless/non-UI callers still fall back to ctx.ui.notify().
 */
import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { iconForSeverity, resolveUiGlyphs, type UiGlyphs } from "./ui-glyphs.ts";

export type InfoPanelSeverity = "info" | "warning" | "error" | "success";

export interface InfoPanelOptions {
  title: string;
  body: string;
  severity?: InfoPanelSeverity;
  footer?: string;
}

export async function openInfoPanel(
  ctx: ExtensionCommandContext,
  options: InfoPanelOptions,
): Promise<void> {
  const severity = options.severity ?? "info";
  const body = options.body.trim() || options.title;
  const glyphs = resolveUiGlyphs(ctx.cwd);

  if (!ctx.hasUI) {
    ctx.ui.notify(body, severity === "success" ? "info" : severity);
    return;
  }

  await ctx.ui.custom<void>(
    (_tui, theme, _keybindings, done) => {
      const panel = new InfoPanelComponent(theme, glyphs, { ...options, body, severity }, done);
      return {
        render: (width: number) => panel.render(width),
        invalidate: () => panel.invalidate(),
        handleInput: (data: string) => panel.handleInput(data),
      };
    },
    {
      overlay: true,
      overlayOptions: {
        width: "62%",
        minWidth: 64,
        maxHeight: "75%",
        anchor: "center",
        margin: 2,
      },
    },
  );
}

// Close keywords mirror the command-panel contract so the same muscle memory
// works in both popups. Kept inline (rather than imported from
// command-panel.ts) so info-panel stays a leaf module with no sibling deps.
const INFO_PANEL_CLOSE_KEYWORDS = ["exit", "quit"] as const;
const INFO_PANEL_MAX_KEYWORD_LEN = Math.max(...INFO_PANEL_CLOSE_KEYWORDS.map((k) => k.length));

class InfoPanelComponent {
  // Sliding window of recent printable keystrokes used to detect typed close
  // keywords (`exit`, `quit`). Reset by Enter/Esc/q so partial matches do not
  // survive across panels.
  private closeKeywordBuffer = "";
  private scrollOffset = 0;
  private lastBodyHeight = 1;

  constructor(
    private readonly theme: Theme,
    private readonly glyphs: UiGlyphs,
    private readonly options: Required<Pick<InfoPanelOptions, "title" | "body" | "severity">> &
      Pick<InfoPanelOptions, "footer">,
    private readonly done: () => void,
  ) {}

  handleInput(data: string): void {
    if (
      matchesKey(data, "escape") ||
      matchesKey(data, "enter") ||
      matchesKey(data, "return") ||
      data === "q"
    ) {
      this.closeKeywordBuffer = "";
      this.done();
      return;
    }
    if (matchesKey(data, "up") || data === "k") {
      this.scrollBy(-1);
      return;
    }
    if (matchesKey(data, "down") || data === "j") {
      this.scrollBy(1);
      return;
    }
    if (data === "\x1b[5~") {
      this.scrollBy(-this.lastBodyHeight);
      return;
    }
    if (data === "\x1b[6~" || data === " ") {
      this.scrollBy(this.lastBodyHeight);
      return;
    }
    if (matchesKey(data, "home")) {
      this.scrollOffset = 0;
      return;
    }
    if (matchesKey(data, "end")) {
      this.scrollOffset = Number.MAX_SAFE_INTEGER;
      return;
    }
    // Detect typed `exit` / `quit` so users who reach for those keywords by
    // muscle memory don’t get stuck inside the popup. Same contract as
    // GroupedActionList in command-panel.ts.
    if (data.length === 1 && /^[a-z]$/i.test(data)) {
      this.closeKeywordBuffer = (this.closeKeywordBuffer + data.toLowerCase()).slice(
        -INFO_PANEL_MAX_KEYWORD_LEN,
      );
      if ((INFO_PANEL_CLOSE_KEYWORDS as readonly string[]).includes(this.closeKeywordBuffer)) {
        this.closeKeywordBuffer = "";
        this.done();
      }
      return;
    }
    this.closeKeywordBuffer = "";
  }

  render(width: number): string[] {
    const innerWidth = Math.max(20, width - 4);
    const terminalRows = process.stdout.rows || 32;
    const maxRows = Math.max(10, Math.floor(terminalRows * 0.75));
    const bodyHeight = Math.max(3, maxRows - 5);
    this.lastBodyHeight = bodyHeight;

    const lines: string[] = [];
    const borderChars = this.borderChars();
    const title = `${iconForSeverity(this.options.severity, this.glyphs)} ${this.options.title}`;
    const bodyLines = this.bodyLines(innerWidth);
    const maxOffset = Math.max(0, bodyLines.length - bodyHeight);
    this.scrollOffset = Math.min(Math.max(0, this.scrollOffset), maxOffset);
    const visibleBodyLines = bodyLines.slice(this.scrollOffset, this.scrollOffset + bodyHeight);

    lines.push(
      this.borderLine(borderChars.topLeft, borderChars.horizontal, borderChars.topRight, width),
    );
    lines.push(this.contentLine(` ${this.colorBorder(this.theme.bold(title))}`, width));
    lines.push(
      this.borderLine(
        borderChars.leftJoin,
        borderChars.horizontalMuted,
        borderChars.rightJoin,
        width,
      ),
    );

    for (let index = 0; index < bodyHeight; index++) {
      const raw = visibleBodyLines[index] ?? "";
      const scrollBar = this.scrollBar(index, bodyHeight, maxOffset);
      lines.push(this.contentLine(`  ${this.theme.fg("text", raw)}`, width, scrollBar));
    }

    lines.push(
      this.borderLine(
        borderChars.leftJoin,
        borderChars.horizontalMuted,
        borderChars.rightJoin,
        width,
      ),
    );
    lines.push(
      this.contentLine(
        ` ${this.theme.fg(
          "dim",
          this.options.footer ??
            (maxOffset > 0
              ? "↑↓/j/k scroll · PgUp/PgDn page · Home/End jump · Enter/Esc / type 'exit' close"
              : "Enter/Esc / type 'exit' return to the previous panel"),
        )}`,
        width,
      ),
    );
    lines.push(
      this.borderLine(
        borderChars.bottomLeft,
        borderChars.horizontal,
        borderChars.bottomRight,
        width,
      ),
    );
    return lines.map((line) => truncateToWidth(line, width, ""));
  }

  invalidate(): void {}

  private bodyLines(innerWidth: number): string[] {
    const lines: string[] = [];
    for (const rawLine of this.options.body.split(/\r?\n/)) {
      if (!rawLine.trim()) {
        lines.push("");
        continue;
      }
      lines.push(...wrapTextWithAnsi(rawLine, innerWidth));
    }
    return lines;
  }

  private scrollBy(delta: number): void {
    this.scrollOffset = Math.max(0, this.scrollOffset + delta);
  }

  private scrollBar(index: number, bodyHeight: number, maxOffset: number): string {
    if (maxOffset <= 0) return "";
    const absolute = this.scrollOffset + index;
    if (absolute === 0) return this.theme.fg("accent", "▲");
    if (absolute >= maxOffset + bodyHeight - 1) return this.theme.fg("accent", "▼");
    return this.theme.fg("dim", "│");
  }

  private borderChars(): {
    topLeft: string;
    topRight: string;
    bottomLeft: string;
    bottomRight: string;
    leftJoin: string;
    rightJoin: string;
    horizontal: string;
    horizontalMuted: string;
    vertical: string;
  } {
    if (this.glyphs.mode === "ascii") {
      return {
        topLeft: "+",
        topRight: "+",
        bottomLeft: "+",
        bottomRight: "+",
        leftJoin: "+",
        rightJoin: "+",
        horizontal: "-",
        horizontalMuted: "-",
        vertical: "|",
      };
    }
    return {
      topLeft: "╭",
      topRight: "╮",
      bottomLeft: "╰",
      bottomRight: "╯",
      leftJoin: "├",
      rightJoin: "┤",
      horizontal: "─",
      horizontalMuted: "─",
      vertical: "│",
    };
  }

  private borderLine(left: string, fill: string, right: string, width: number): string {
    const content = `${this.colorBorder(left)}${this.colorBorder(fill.repeat(Math.max(0, width - 2)))}${this.colorBorder(right)}`;
    return this.bg(content);
  }

  private contentLine(content: string, width: number, scrollBar = ""): string {
    const chars = this.borderChars();
    const scrollBarWidth = scrollBar ? 1 : 0;
    const innerWidth = Math.max(0, width - 2 - scrollBarWidth);
    const padded = this.pad(truncateToWidth(content, innerWidth, ""), innerWidth);
    return this.bg(
      `${this.colorBorder(chars.vertical)}${padded}${scrollBar}${this.colorBorder(chars.vertical)}`,
    );
  }

  private pad(content: string, width: number): string {
    return `${content}${" ".repeat(Math.max(0, width - visibleWidth(content)))}`;
  }

  private bg(content: string): string {
    return this.theme.bg("customMessageBg", content);
  }

  private colorBorder(content: string): string {
    if (this.options.severity === "success") return this.theme.fg("success", content);
    if (this.options.severity === "warning") return this.theme.fg("warning", content);
    if (this.options.severity === "error") return this.theme.fg("error", content);
    return this.theme.fg("borderAccent", content);
  }
}
