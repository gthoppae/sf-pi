/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared grouped command panel for SF Pi extension commands.
 *
 * Pi's stock SelectList is intentionally flat: label + description rows with
 * no non-selectable group headers. SF Pi command surfaces need the same native
 * `ctx.ui.custom()` feel, but with stronger visual hierarchy, semantic icons,
 * preserved selection/filter state, in-place action execution, and a full-width
 * selected-action detail pane so long help text does not clip.
 */
import type { Component } from "@mariozechner/pi-tui";
import type { ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import {
  Container,
  type KeybindingsManager,
  matchesKey,
  Spacer,
  Text,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@mariozechner/pi-tui";
import { iconForCommandGroup, resolveUiGlyphs, type UiGlyphs } from "./ui-glyphs.ts";

export interface CommandPanelAction<T extends string = string> {
  value: T;
  label: string;
  description: string;
  group: string;
}

export interface CommandPanelState<T extends string = string> {
  selectedValue?: T;
  filter?: string;
}

export interface CommandPanelOptions<T extends string = string> {
  title: string;
  subtitle?: string;
  statusLines?: string[] | (() => string[]);
  actions: CommandPanelAction<T>[] | (() => CommandPanelAction<T>[]);
  closeValue: T;
  statusHeading?: string;
  actionsHeading?: string;
  helpText?: string;
  state?: CommandPanelState<T>;
  /**
   * When set, Enter runs this action without closing the panel. This is the
   * preferred mode for interactive command menus: action results can open an
   * overlay and return to the same selected row without the close/reopen flicker.
   */
  onAction?: (action: T) => Promise<void> | void;
}

export async function openCommandPanel<T extends string>(
  ctx: ExtensionCommandContext,
  options: CommandPanelOptions<T>,
): Promise<T | null> {
  const state = options.state;
  const glyphs = resolveUiGlyphs(ctx.cwd);
  const result = await ctx.ui.custom<T | null>((tui, theme, keybindings, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((s: string) => theme.fg("borderAccent", s)));
    container.addChild(new Text(theme.fg("accent", theme.bold(options.title)), 1, 0));
    if (options.subtitle) {
      container.addChild(new Text(theme.fg("muted", options.subtitle), 1, 0));
    }

    if (options.statusLines) {
      container.addChild(new Spacer(1));
      container.addChild(
        new StatusBlock(theme, glyphs, options.statusHeading ?? "Status", options.statusLines),
      );
    }

    container.addChild(new Spacer(1));
    container.addChild(
      new SectionHeading(theme, glyphs.actions, options.actionsHeading ?? "Actions"),
    );
    const list = new GroupedActionList(
      theme,
      keybindings,
      glyphs,
      options.actions,
      options.closeValue,
      done,
      () => tui.requestRender(),
      state,
      options.onAction,
    );
    container.addChild(list);

    container.addChild(new Spacer(1));
    container.addChild(new Rule(theme));
    container.addChild(
      new Text(
        theme.fg(
          "dim",
          options.helpText ?? "↑↓ move · type filter · Backspace edit · Enter run · Esc close",
        ),
        1,
        0,
      ),
    );
    container.addChild(new DynamicBorder((s: string) => theme.fg("borderAccent", s)));

    return {
      render: (w) => container.render(w),
      invalidate: () => container.invalidate(),
      handleInput: (data) => {
        list.handleInput(data);
        tui.requestRender();
      },
    };
  });

  return result ?? null;
}

class GroupedActionList<T extends string> implements Component {
  private filter = "";
  private selectedIndex = 0;
  private actionInFlight = false;

  constructor(
    private readonly theme: Theme,
    private readonly keybindings: KeybindingsManager,
    private readonly glyphs: UiGlyphs,
    private readonly actionSource: CommandPanelAction<T>[] | (() => CommandPanelAction<T>[]),
    private readonly closeValue: T,
    private readonly done: (result: T | null) => void,
    private readonly requestRender: () => void,
    private readonly state?: CommandPanelState<T>,
    private readonly onAction?: (action: T) => Promise<void> | void,
  ) {
    this.filter = state?.filter ?? "";
    this.selectedIndex = this.indexForSelectedValue(state?.selectedValue);
    this.persistSelection();
  }

  render(width: number): string[] {
    const lines: string[] = [];
    const filtered = this.filteredItems();

    if (this.filter) {
      lines.push(
        truncateToWidth(
          `  ${this.theme.fg("muted", "Filter")} ${this.theme.fg("accent", this.filter)} ${this.theme.fg("dim", `(${filtered.length}/${this.items().length})`)}`,
          width,
          "",
        ),
      );
      lines.push("");
    }

    if (filtered.length === 0) {
      lines.push(this.theme.fg("warning", "  No matching actions"));
      lines.push(this.theme.fg("dim", "  Backspace edits the filter; Esc closes the panel."));
      return lines;
    }

    this.selectedIndex = Math.min(this.selectedIndex, filtered.length - 1);
    this.persistSelection();

    let currentGroup: string | undefined;
    for (let i = 0; i < filtered.length; i++) {
      const item = filtered[i];
      if (!item) continue;
      if (item.group !== currentGroup) {
        currentGroup = item.group;
        if (i > 0) lines.push("");
        lines.push(this.renderGroupHeading(currentGroup, width));
      }
      lines.push(this.renderActionLine(item, i === this.selectedIndex, width));
    }

    const selected = filtered[this.selectedIndex];
    if (selected) {
      lines.push("");
      lines.push(this.renderDetailHeader(width));
      const status = this.actionInFlight
        ? ` ${this.theme.fg("warning", `${this.glyphs.loading} running`)}`
        : "";
      lines.push(
        truncateToWidth(
          `  ${this.theme.fg("accent", this.theme.bold(selected.label))}${status}`,
          width,
          "",
        ),
      );
      for (const wrapped of wrapTextWithAnsi(selected.description, Math.max(20, width - 4))) {
        lines.push(`  ${this.theme.fg("text", wrapped)}`);
      }
    }

    return lines;
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (this.actionInFlight) return;

    if (this.keybindings.matches(data, "tui.select.up")) {
      this.move(-1);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.down")) {
      this.move(1);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.confirm")) {
      const selected = this.filteredItems()[this.selectedIndex];
      if (selected) {
        if (this.state) this.state.selectedValue = selected.value;
        if (this.onAction) {
          this.runAction(selected.value);
        } else {
          this.done(selected.value);
        }
      }
      return;
    }
    if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.done(this.closeValue);
      return;
    }
    if (matchesKey(data, "backspace")) {
      this.filter = this.filter.slice(0, -1);
      this.selectedIndex = 0;
      this.persistSelection();
      return;
    }
    if (isPrintableFilterInput(data)) {
      this.filter += data;
      this.selectedIndex = 0;
      this.persistSelection();
    }
  }

  private runAction(action: T): void {
    this.actionInFlight = true;
    this.requestRender();
    void Promise.resolve(this.onAction?.(action)).finally(() => {
      this.actionInFlight = false;
      this.requestRender();
    });
  }

  private renderGroupHeading(group: string, width: number): string {
    const icon = iconForCommandGroup(group, this.glyphs);
    const label = `  ${this.theme.fg("accent", this.theme.bold(`${icon} ${group.toUpperCase()}`))}`;
    const remaining = Math.max(0, width - visibleWidth(label) - 2);
    return truncateToWidth(
      `${label} ${this.theme.fg("borderMuted", "─".repeat(remaining))}`,
      width,
      "",
    );
  }

  private renderActionLine(item: CommandPanelAction<T>, selected: boolean, width: number): string {
    const marker = selected
      ? this.theme.fg("accent", this.glyphs.selectedRow)
      : this.theme.fg("dim", " ");
    const label = selected
      ? this.theme.fg("accent", this.theme.bold(item.label))
      : this.theme.fg("text", item.label);
    return truncateToWidth(`  ${marker} ${label}`, width, "");
  }

  private renderDetailHeader(width: number): string {
    const label = `  ${this.theme.fg("accent", this.theme.bold(`${this.glyphs.selected} SELECTED`))}`;
    const remaining = Math.max(0, width - visibleWidth(label) - 2);
    return truncateToWidth(
      `${label} ${this.theme.fg("borderMuted", "─".repeat(remaining))}`,
      width,
      "",
    );
  }

  private move(delta: number): void {
    const len = this.filteredItems().length;
    if (len === 0) return;
    this.selectedIndex = (this.selectedIndex + delta + len) % len;
    this.persistSelection();
  }

  private filteredItems(): CommandPanelAction<T>[] {
    const needle = this.filter.trim().toLowerCase();
    const items = this.items();
    if (!needle) return items;
    return items.filter((item) =>
      `${item.group} ${item.label} ${item.description} ${item.value}`
        .toLowerCase()
        .includes(needle),
    );
  }

  private items(): CommandPanelAction<T>[] {
    return typeof this.actionSource === "function" ? this.actionSource() : this.actionSource;
  }

  private indexForSelectedValue(value: T | undefined): number {
    if (!value) return 0;
    const index = this.filteredItems().findIndex((item) => item.value === value);
    return index >= 0 ? index : 0;
  }

  private persistSelection(): void {
    if (!this.state) return;
    this.state.filter = this.filter;
    const selected = this.filteredItems()[this.selectedIndex];
    if (selected) this.state.selectedValue = selected.value;
  }
}

class StatusBlock implements Component {
  constructor(
    private readonly theme: Theme,
    private readonly glyphs: UiGlyphs,
    private readonly label: string,
    private readonly statusLines: string[] | (() => string[]),
  ) {}

  render(width: number): string[] {
    const lines = [
      new SectionHeading(this.theme, this.glyphs.status, this.label).render(width)[0] ?? "",
    ];
    const statusLines =
      typeof this.statusLines === "function" ? this.statusLines() : this.statusLines;
    for (const line of statusLines) {
      lines.push(truncateToWidth(`  ${line}`, width, ""));
    }
    return lines;
  }

  invalidate(): void {}
}

class SectionHeading implements Component {
  constructor(
    private readonly theme: Theme,
    private readonly icon: string,
    private readonly label: string,
  ) {}

  render(width: number): string[] {
    const text = ` ${this.theme.fg("accent", this.theme.bold(`${this.icon} ${this.label.toUpperCase()}`))}`;
    const remaining = Math.max(0, width - visibleWidth(text) - 1);
    return [
      truncateToWidth(`${text} ${this.theme.fg("borderMuted", "─".repeat(remaining))}`, width, ""),
    ];
  }

  invalidate(): void {}
}

class Rule implements Component {
  constructor(private readonly theme: Theme) {}

  render(width: number): string[] {
    return [this.theme.fg("borderMuted", "─".repeat(Math.max(0, width)))];
  }

  invalidate(): void {}
}

function isPrintableFilterInput(data: string): boolean {
  return data.length === 1 && data >= " " && data !== "\x7f";
}
