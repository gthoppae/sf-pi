/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Read-only settings/status panel for sf-google-workspace-internal.
 *
 * The extension has no persistent preferences in v1. This panel gives the
 * sf-pi manager a standardized drill-down surface for enablement, transport,
 * setup commands, tool counts, and safety invariants.
 */
import { type Focusable, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import { isSfPiExtensionEnabled } from "../../../lib/common/sf-pi-extension-state.ts";
import { resolveMcpTransportConfig } from "./mcp.ts";
import { READ_MCP_TOOLS, DEFERRED_READ_MCP_TOOLS } from "./read-tools.ts";
import { READ_WRAPPER_SPECS, DEFERRED_READ_WRAPPER_SPECS } from "./read-wrappers.ts";

const EXTENSION_ID = "sf-google-workspace-internal";

function padAnsi(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

class SfGoogleWorkspaceConfigPanel implements Focusable {
  focused = false;

  constructor(
    private readonly theme: Theme,
    private readonly cwd: string,
    private readonly scope: "global" | "project",
    private readonly done: (result: ConfigPanelResult | undefined) => void,
  ) {}

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || data === "q") {
      this.done(undefined);
    }
  }

  renderContent(width: number): string[] {
    const lines: string[] = [];
    const t = this.theme;
    const pad = (content: string) => padAnsi(content, width);
    const enabled = isSfPiExtensionEnabled(this.cwd, EXTENSION_ID);
    const cfg = resolveMcpTransportConfig();

    lines.push(pad(` ${t.fg("muted", "SF Google Workspace — settings & status")}`));
    lines.push(pad(""));

    const dot = enabled ? t.fg("success", "●") : t.fg("error", "○");
    lines.push(
      pad(
        ` ${dot} ${t.fg("text", enabled ? "Enabled" : "Disabled by default/user settings")}   ${t.fg(
          "dim",
          `(scope: ${this.scope})`,
        )}`,
      ),
    );
    lines.push(pad(""));

    lines.push(pad(` ${t.fg("muted", "Transport:")}`));
    lines.push(
      pad(
        `   ${t.fg("text", "Backend")}       ${t.fg("dim", "Salesforce mcp-adaptor / DX MCP Gateway")}`,
      ),
    );
    lines.push(pad(`   ${t.fg("text", "Adaptor")}       ${t.fg("dim", cfg.adaptorPath)}`));
    lines.push(pad(`   ${t.fg("text", "Server")}        ${t.fg("dim", cfg.server)}`));
    lines.push(
      pad(
        `   ${t.fg("text", "Mode")}          ${t.fg("dim", cfg.keepAlive ? "keepalive (lazy, opt-in)" : "one-shot (default)")}`,
      ),
    );
    lines.push(pad(`   ${t.fg("text", "Timeout")}       ${t.fg("dim", `${cfg.timeoutMs}ms`)}`));
    lines.push(
      pad(
        `   ${t.fg("text", "Idle timeout")}  ${t.fg("dim", `${cfg.keepAliveIdleMs}ms (when GWS_MCP_KEEPALIVE=1)`)}`,
      ),
    );
    lines.push(pad(""));

    lines.push(pad(` ${t.fg("muted", "When enabled:")}`));
    lines.push(
      pad(
        `   ${toolDot(t, enabled)} ${t.fg("text", "First-class wrappers")} ${t.fg("dim", `${READ_WRAPPER_SPECS.length + 1} Drive/Docs/Sheets/Slides/Calendar/Gmail read tools`)}`,
      ),
    );
    lines.push(
      pad(
        `   ${toolDot(t, enabled)} ${t.fg("text", "Read MCP allowlist")} ${t.fg("dim", `${READ_MCP_TOOLS.size} underlying read tools`)}`,
      ),
    );
    lines.push(
      pad(
        `   ${toolDot(t, enabled)} ${t.fg("text", "Progressive skill")} ${t.fg("dim", "sf-google-workspace-guidance via resources_discover")}`,
      ),
    );
    lines.push(
      pad(
        `   ${toolDot(t, enabled)} ${t.fg("text", "Deferred")}          ${t.fg("dim", `${DEFERRED_READ_WRAPPER_SPECS.length} Forms/Tasks wrappers, ${DEFERRED_READ_MCP_TOOLS.size} underlying tools`)}`,
      ),
    );
    lines.push(pad(""));

    lines.push(pad(` ${t.fg("muted", "Performance mode:")}`));
    lines.push(
      pad(`   ${t.fg("dim", "•")} Set GWS_MCP_KEEPALIVE=1 to reuse one lazy bridge process`),
    );
    lines.push(pad(`   ${t.fg("dim", "•")} Set GWS_MCP_KEEPALIVE_IDLE_MS to tune idle shutdown`));
    lines.push(pad(""));

    lines.push(pad(` ${t.fg("muted", "Setup:")}`));
    lines.push(
      pad(`   ${t.fg("dim", "1.")} ${t.fg("text", "~/.mcp-adaptor/bin/mcp-adaptor auth")}`),
    );
    lines.push(
      pad(
        `   ${t.fg("dim", "2.")} ${t.fg("text", "~/.mcp-adaptor/bin/mcp-adaptor auth --provider google-workspace-readonly --env prod")}`,
      ),
    );
    lines.push(
      pad(
        `   ${t.fg("dim", "3.")} ${t.fg("text", "~/.mcp-adaptor/bin/mcp-adaptor auth --validate")}`,
      ),
    );
    lines.push(pad(""));

    lines.push(pad(` ${t.fg("muted", "Safety:")}`));
    lines.push(
      pad(
        `   ${t.fg("dim", "•")} Google OAuth tokens are owned by mcp-adaptor/keyring, not this extension`,
      ),
    );
    lines.push(
      pad(
        `   ${t.fg("dim", "•")} Routine tools are read-only and compact; full catalog is an escape hatch`,
      ),
    );
    lines.push(
      pad(`   ${t.fg("dim", "•")} Write-like generic calls require GWS_ALLOW_MCP_WRITE=true`),
    );
    lines.push(pad(""));
    lines.push(
      pad(
        ` ${t.fg("dim", enabled ? "Use /sf-google-workspace status to verify auth. Esc to go back." : "Enable with /sf-pi enable sf-google-workspace-internal, then reload. Esc to go back.")}`,
      ),
    );

    return lines;
  }

  render(width: number): string[] {
    return this.renderContent(width);
  }

  invalidate(): void {}
}

function toolDot(t: Theme, enabled: boolean): string {
  return enabled ? t.fg("success", "●") : t.fg("dim", "○");
}

export const createConfigPanel: ConfigPanelFactory = (theme, cwd, scope, done) => {
  return new SfGoogleWorkspaceConfigPanel(theme, cwd, scope, done);
};
