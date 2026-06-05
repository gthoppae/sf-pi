/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-google-workspace-internal — native Pi tool surface backed by Salesforce mcp-adaptor.
 *
 * The extension intentionally exposes compact first-class Pi wrappers instead
 * of registering the full Google Workspace MCP catalog in the model context.
 * mcp-adaptor remains a hidden transport: Pi tool -> mcp-adaptor -> DX MCP Gateway.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

import { openCommandPanel, type CommandPanelAction } from "../../lib/common/command-panel.ts";
import { openInfoPanel } from "../../lib/common/info-panel.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import { isSfPiExtensionEnabled } from "../../lib/common/sf-pi-extension-state.ts";
import {
  buildToggleExtensionAction,
  isLifecycleToggleAction,
  LIFECYCLE_GROUP,
  performToggleExtension,
  type LifecycleActionId,
} from "../../lib/common/extension-toggle.ts";

import {
  assertMcpToolAllowed,
  callMcpTool,
  formatMcpToolList,
  listMcpTools,
  resolveMcpTransportConfig,
  sanitizeMcpResult,
  searchTools,
  stringifyBounded,
  validateMcpAuth,
} from "./lib/mcp.ts";
import { formatDriveSearchResult, searchGoogleDrive } from "./lib/drive.ts";
import {
  assertReadMcpTool,
  describeReadTool,
  filterReadMcpTools,
  formatCompactReadToolList,
  formatReadToolDescribe,
  ReadToolNotAllowedError,
} from "./lib/read-tools.ts";
import { executeReadWrapper, getWrapperByPiName, READ_WRAPPER_SPECS } from "./lib/read-wrappers.ts";
import { sanitizeForLog } from "./lib/security.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXTENSION_ID = "sf-google-workspace-internal";
const COMMAND_NAME = "sf-google-workspace";

const EMPTY_PARAMS = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

const TOOL_SEARCH_PARAMS = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description:
        "Keyword(s) to search in Google Workspace MCP tool names/descriptions. Empty returns the first tools.",
    },
    limit: { type: "number", description: "Maximum matching tools to return, default 20, max 50." },
    include_schema: {
      type: "boolean",
      description: "When true, include each matching tool's input schema.",
    },
  },
  required: ["query"],
  additionalProperties: false,
} as const;

const TOOL_CALL_PARAMS = {
  type: "object",
  properties: {
    tool_name: {
      type: "string",
      description: "Exact Google Workspace MCP tool name. Use google_workspace_tool_search first.",
    },
    arguments: { type: "object", description: "JSON object arguments for the MCP tool." },
  },
  required: ["tool_name", "arguments"],
  additionalProperties: false,
} as const;

const READ_TOOL_SEARCH_PARAMS = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description:
        "Keyword(s) to search in read-only Google Workspace MCP tool names/descriptions. Empty returns the first tools.",
    },
    limit: { type: "number", description: "Maximum matching tools to return, default 20, max 50." },
    include_schema: {
      type: "boolean",
      description: "When true, include each matching tool's input schema.",
    },
  },
  required: ["query"],
  additionalProperties: false,
} as const;

const READ_TOOL_DESCRIBE_PARAMS = {
  type: "object",
  properties: {
    tool_name: {
      type: "string",
      description: "Exact read-only Google Workspace MCP tool name. Must be in the read allowlist.",
    },
  },
  required: ["tool_name"],
  additionalProperties: false,
} as const;

const READ_TOOL_CALL_PARAMS = {
  type: "object",
  properties: {
    tool_name: {
      type: "string",
      description:
        "Exact read-only Google Workspace MCP tool name. Use google_workspace_read_tool_search first.",
    },
    arguments: { type: "object", description: "JSON object arguments for the MCP tool." },
  },
  required: ["tool_name", "arguments"],
  additionalProperties: false,
} as const;

const DRIVE_SEARCH_PARAMS = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Google Drive search query. Supports Google Drive search operators.",
    },
    limit: { type: "number", description: "Maximum files to return, default 10, max 50." },
    page_token: {
      type: "string",
      description: "Pagination token from a previous google_drive_search result details.",
    },
    drive_id: { type: "string", description: "Optional shared drive ID to scope the search." },
    include_items_from_all_drives: {
      type: "boolean",
      description: "Include shared drive items when no drive_id is set. Default true.",
    },
    corpora: { type: "string", description: "Optional corpus: user, domain, drive, or allDrives." },
    file_type: {
      type: "string",
      description: "Friendly type such as folder, doc, sheet, slides, pdf, or a raw MIME type.",
    },
  },
  required: ["query"],
  additionalProperties: false,
} as const;

type GoogleWorkspaceCommandAction =
  | "status"
  | "read-tools"
  | "tools"
  | "help"
  | "close"
  | LifecycleActionId;

const BASE_COMMAND_ACTIONS: CommandPanelAction<GoogleWorkspaceCommandAction>[] = [
  {
    value: "status",
    label: "Show mcp-adaptor status",
    description: "Check auth validation and Google Workspace MCP bridge availability.",
    group: "Status",
  },
  {
    value: "read-tools",
    label: "List curated read tools",
    description: "Show the compact read-only allowlist exposed through progressive disclosure.",
    group: "Reference",
  },
  {
    value: "tools",
    label: "List full MCP catalog",
    description: "Development/debug escape hatch. Avoid for routine read tasks.",
    group: "Diagnostics",
  },
  {
    value: "help",
    label: "Show help",
    description: "Show setup commands, tool-routing guidance, and command examples.",
    group: "Reference",
  },
  {
    value: "close",
    label: "Close",
    description: "Dismiss this panel.",
    group: LIFECYCLE_GROUP,
  },
];

function buildCommandActions(cwd: string): CommandPanelAction<GoogleWorkspaceCommandAction>[] {
  const toggle = buildToggleExtensionAction({ extensionId: EXTENSION_ID, cwd });
  return toggle ? [...BASE_COMMAND_ACTIONS, toggle] : BASE_COMMAND_ACTIONS;
}

export default function sfGoogleWorkspaceInternal(pi: ExtensionAPI): void {
  if (!requirePiVersion(pi, EXTENSION_ID)) return;

  let toolsRegistered = false;

  function ensureToolsRegistered(): void {
    if (toolsRegistered) return;
    registerGoogleWorkspaceTools(pi);
    toolsRegistered = true;
  }

  pi.on("session_start", (event, ctx) => {
    if (event.reason === "reload") toolsRegistered = false;
    if (isSfPiExtensionEnabled(ctx.cwd, EXTENSION_ID)) ensureToolsRegistered();
  });
  pi.on("session_shutdown", () => {
    toolsRegistered = false;
  });
  pi.on("resources_discover", (event) => {
    if (!isSfPiExtensionEnabled(event.cwd, EXTENSION_ID)) return;
    if (event.reason === "reload") {
      toolsRegistered = false;
      ensureToolsRegistered();
    }
    return { skillPaths: [path.join(__dirname, "skills")] };
  });

  pi.registerCommand(COMMAND_NAME, {
    description: "SF Google Workspace — mcp-adaptor-backed Google Workspace tools",
    getArgumentCompletions: (prefix: string) =>
      ["status", "read-tools", "tools", "help"]
        .filter((value) => value.startsWith(prefix.trim()))
        .map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, COMMAND_NAME, () =>
        handleGoogleWorkspaceCommand(ctx, args || ""),
      );
    },
  });
}

function registerGoogleWorkspaceTools(pi: ExtensionAPI): void {
  pi.registerTool<typeof EMPTY_PARAMS, Record<string, unknown>>({
    name: "google_workspace_status",
    label: "Google Workspace Status",
    description:
      "Check Salesforce mcp-adaptor auth and Google Workspace MCP bridge availability. Use only for setup diagnostics, not before routine reads.",
    promptSnippet:
      "Diagnose Google Workspace mcp-adaptor auth/bridge setup when a call fails or auth is uncertain",
    promptGuidelines: [
      "Do not call google_workspace_status before routine Google Workspace reads; use it only when auth/setup is uncertain or after a Google Workspace tool fails.",
      "If google_workspace_status reports auth failure, tell the user to run mcp-adaptor auth, then mcp-adaptor auth --provider google-workspace-readonly --env prod, then mcp-adaptor auth --validate.",
    ],
    parameters: EMPTY_PARAMS,
    async execute() {
      const text = await buildStatusText();
      return { content: [{ type: "text", text }], details: { ok: true } };
    },
  });

  pi.registerTool<typeof TOOL_SEARCH_PARAMS, Record<string, unknown>>({
    name: "google_workspace_tool_search",
    label: "Google Workspace Tool Search",
    description:
      "Search the Salesforce Google Workspace MCP tool catalog without adding all MCP tools to Pi's system prompt.",
    promptSnippet: "Search available Google Workspace MCP tools by keyword before calling one",
    promptGuidelines: [
      "Use google_workspace_tool_search to discover the exact Google Workspace MCP tool name and argument schema before google_workspace_call.",
      "Prefer read/list/search/get tools. Write-like Google Workspace MCP tools are blocked unless GWS_ALLOW_MCP_WRITE=true.",
    ],
    parameters: TOOL_SEARCH_PARAMS,
    async execute(
      _toolCallId: string,
      params: { query: string; limit?: number; include_schema?: boolean },
    ) {
      const tools = await listMcpTools();
      const matches = searchTools(tools, params.query || "", params.limit ?? 20);
      const text = params.include_schema
        ? stringifyBounded(matches, 16_000)
        : formatMcpToolList(matches);
      return {
        content: [{ type: "text", text }],
        details: { ok: true, count: matches.length, total_tools: tools.length, matches },
      };
    },
  });

  pi.registerTool<typeof DRIVE_SEARCH_PARAMS, Record<string, unknown>>({
    name: "google_drive_search",
    label: "Google Drive Search",
    description:
      "Search Google Drive through Salesforce's approved Google Workspace mcp-adaptor path. Read-only and output-formatted; hides raw pagination blobs from the visible result.",
    promptSnippet: "Search Google Drive files by query through Salesforce Google Workspace",
    promptGuidelines: [
      "Use google_drive_search for Google Drive file discovery instead of generic google_workspace_call when searching files.",
      "Use google_drive_search page_token only when the user asks for more results; the visible output hides the long Google pagination token but details include it.",
    ],
    parameters: DRIVE_SEARCH_PARAMS,
    async execute(
      _toolCallId: string,
      params: {
        query: string;
        limit?: number;
        page_token?: string;
        drive_id?: string;
        include_items_from_all_drives?: boolean;
        corpora?: string;
        file_type?: string;
      },
    ) {
      const result = await searchGoogleDrive(params);
      return {
        content: [{ type: "text", text: formatDriveSearchResult(result) }],
        details: {
          ok: true,
          query: result.query,
          count: result.files.length,
          files: result.files,
          next_page_token: result.nextPageToken,
          has_more: Boolean(result.nextPageToken),
        },
      };
    },
  });

  pi.registerTool<typeof READ_TOOL_SEARCH_PARAMS, Record<string, unknown>>({
    name: "google_workspace_read_tool_search",
    label: "Google Workspace Read Tool Search",
    description:
      "Search curated read-only Google Workspace MCP tools. Excludes all write/modify/send/manage tools. Use this to discover read tools before calling google_workspace_read_tool_call.",
    promptSnippet: "Search curated read-only Google Workspace tools by keyword",
    promptGuidelines: [
      "Use google_workspace_read_tool_search to discover available read-only Google Workspace tools.",
      "This returns only allowlisted read tools — no write/modify/send/manage tools are included.",
    ],
    parameters: READ_TOOL_SEARCH_PARAMS,
    async execute(
      _toolCallId: string,
      params: { query: string; limit?: number; include_schema?: boolean },
    ) {
      const tools = await listMcpTools();
      const readTools = filterReadMcpTools(tools);
      const matches = searchTools(readTools, params.query || "", params.limit ?? 20);

      let text: string;
      if (params.include_schema) {
        // Backwards-compatible escape hatch — bounded to 3 full schemas
        const SCHEMA_CAP = 3;
        const bounded = matches.slice(0, SCHEMA_CAP);
        const warning =
          matches.length > SCHEMA_CAP
            ? `\n\n[Showing schemas for first ${SCHEMA_CAP} of ${matches.length} matches. ` +
              `Prefer google_workspace_read_tool_describe tool_name="<name>" for one tool's full schema.]`
            : matches.length > 0
              ? `\n\n[Tip: Prefer google_workspace_read_tool_describe tool_name="<name>" for targeted schema lookup.]`
              : "";
        text = stringifyBounded(bounded, 16_000) + warning;
      } else {
        // Default: compact output with required/optional params, no full schemas
        text = formatCompactReadToolList(matches);
      }

      return {
        content: [{ type: "text", text }],
        details: { ok: true, count: matches.length, total_read_tools: readTools.length, matches },
      };
    },
  });

  pi.registerTool<typeof READ_TOOL_DESCRIBE_PARAMS, Record<string, unknown>>({
    name: "google_workspace_read_tool_describe",
    label: "Google Workspace Read Tool Describe",
    description:
      "Get the full description and input schema for exactly one read-only Google Workspace MCP tool. Use after google_workspace_read_tool_search to inspect a specific tool before calling it.",
    promptSnippet: "Get full schema for one read-only Google Workspace MCP tool",
    promptGuidelines: [
      "Use google_workspace_read_tool_search first to discover tool names and schemas.",
      "Only read-only allowlisted tools are accepted. Write-like tools are rejected with a clear error.",
      "For write operations, use google_workspace_call with GWS_ALLOW_MCP_WRITE=true.",
    ],
    parameters: READ_TOOL_DESCRIBE_PARAMS,
    async execute(_toolCallId: string, params: { tool_name: string }) {
      const requestedToolName = params.tool_name;
      const wrapper = getWrapperByPiName(requestedToolName);
      const mcpToolName = wrapper?.underlyingTool ?? requestedToolName;
      try {
        assertReadMcpTool(mcpToolName);
      } catch (err) {
        if (err instanceof ReadToolNotAllowedError) {
          return {
            content: [{ type: "text", text: err.message }],
            details: { ok: false, error: "not_in_read_allowlist", tool_name: requestedToolName },
          };
        }
        throw err;
      }

      const tools = await listMcpTools();
      const result = describeReadTool(mcpToolName, tools);
      if (!result) {
        return {
          content: [
            {
              type: "text",
              text: `Tool "${mcpToolName}" is in the read allowlist but was not found in the MCP catalog. The server may be unavailable.`,
            },
          ],
          details: {
            ok: false,
            error: "tool_not_found_in_catalog",
            tool_name: requestedToolName,
            mcp_tool_name: mcpToolName,
          },
        };
      }

      return {
        content: [{ type: "text", text: formatReadToolDescribe(result) }],
        details: { ok: true, tool_name: requestedToolName, mcp_tool_name: mcpToolName, ...result },
      };
    },
  });

  pi.registerTool<typeof READ_TOOL_CALL_PARAMS, Record<string, unknown>>({
    name: "google_workspace_read_tool_call",
    label: "Google Workspace Read Tool Call",
    description:
      "Call a read-only Google Workspace MCP tool. Only allowlisted read tools are accepted; write/modify/send/manage tools are rejected.",
    promptSnippet: "Call a curated read-only Google Workspace MCP tool through mcp-adaptor",
    promptGuidelines: [
      "Use google_workspace_read_tool_search first to discover tool names and schemas.",
      "Only read-only allowlisted tools are accepted. Write-like tools are rejected with a clear error.",
      "For write operations, use google_workspace_call with GWS_ALLOW_MCP_WRITE=true.",
    ],
    parameters: READ_TOOL_CALL_PARAMS,
    async execute(
      _toolCallId: string,
      params: { tool_name: string; arguments: Record<string, unknown> },
    ) {
      try {
        assertReadMcpTool(params.tool_name);
      } catch (err) {
        if (err instanceof ReadToolNotAllowedError) {
          return {
            content: [{ type: "text", text: err.message }],
            details: { ok: false, error: "not_in_read_allowlist", tool_name: params.tool_name },
          };
        }
        throw err;
      }
      const result = await callMcpTool(params.tool_name, params.arguments || {});
      const safe = sanitizeMcpResult(result);
      return {
        content: [{ type: "text", text: stringifyBounded(safe, 20_000) }],
        details: { ok: true, tool_name: params.tool_name, result: safe },
      };
    },
  });

  pi.registerTool<typeof TOOL_CALL_PARAMS, Record<string, unknown>>({
    name: "google_workspace_call",
    label: "Google Workspace Call",
    description:
      "Call one exact Salesforce Google Workspace MCP tool through mcp-adaptor. Read-like tools are allowed by default; write-like tools require GWS_ALLOW_MCP_WRITE=true.",
    promptSnippet: "Call an exact Google Workspace MCP tool through Salesforce mcp-adaptor",
    promptGuidelines: [
      "Use google_workspace_tool_search first; call google_workspace_call only with an exact tool_name and schema-compatible arguments.",
      "Do not use google_workspace_call for write-like tools unless the user explicitly requested the mutation and GWS_ALLOW_MCP_WRITE=true is configured.",
      "Never request or expose Google OAuth tokens; this tool uses mcp-adaptor's approved Salesforce auth path.",
    ],
    parameters: TOOL_CALL_PARAMS,
    async execute(
      _toolCallId: string,
      params: { tool_name: string; arguments: Record<string, unknown> },
    ) {
      const allowWrite =
        process.env.GWS_ALLOW_MCP_WRITE === "1" ||
        process.env.GWS_ALLOW_MCP_WRITE?.toLowerCase() === "true";
      assertMcpToolAllowed(params.tool_name, { allowWrite });
      const result = await callMcpTool(params.tool_name, params.arguments || {});
      const safe = sanitizeMcpResult(result);
      return {
        content: [{ type: "text", text: stringifyBounded(safe, 20_000) }],
        details: { ok: true, tool_name: params.tool_name, result: safe },
      };
    },
  });

  // ─── First-class read wrappers ─────────────────────────────────────────────
  registerReadWrapperTools(pi);
}

async function handleGoogleWorkspaceCommand(
  ctx: ExtensionCommandContext,
  args: string,
): Promise<void> {
  const sub = args.trim() as GoogleWorkspaceCommandAction | "";

  if (!sub) {
    if (!ctx.hasUI) {
      await showStatus(ctx);
      return;
    }
    await openGoogleWorkspacePanel(ctx);
    return;
  }

  if (["status", "read-tools", "tools", "help"].includes(sub)) {
    await handlePanelAction(ctx, sub as GoogleWorkspaceCommandAction);
    return;
  }

  ctx.ui.notify(buildCommandHelpText(), "info");
}

async function openGoogleWorkspacePanel(ctx: ExtensionCommandContext): Promise<void> {
  await openCommandPanel(ctx, {
    title: "SF Google Workspace",
    subtitle: "Salesforce-internal Google Workspace through mcp-adaptor; compact wrappers first.",
    statusLines: [
      "Transport: ~/.mcp-adaptor/bin/mcp-adaptor serve --server google_workspace",
      "Model flow: first-class wrappers → read search/describe/call → full catalog only as escape hatch.",
      "Auth: Salesforce mcp-adaptor provider google-workspace-readonly or google-workspace-rw.",
    ],
    actions: () => buildCommandActions(ctx.cwd),
    closeValue: "close",
    onAction: (action) => handlePanelAction(ctx, action),
    closeBeforeAction: isLifecycleToggleAction,
    helpText: "↑↓ move · type filter · Enter run · Esc / type 'exit' close",
  });
}

async function handlePanelAction(
  ctx: ExtensionCommandContext,
  action: GoogleWorkspaceCommandAction,
): Promise<void> {
  switch (action) {
    case "status":
      await showStatus(ctx);
      return;
    case "read-tools":
      await showReadTools(ctx);
      return;
    case "tools":
      await showFullCatalog(ctx);
      return;
    case "help":
      await openInfoPanel(ctx, {
        title: "SF Google Workspace help",
        body: buildCommandHelpText(),
        severity: "info",
      });
      return;
    case "lifecycle.toggle":
      await performToggleExtension(ctx, EXTENSION_ID);
      return;
    default:
      return;
  }
}

async function showStatus(ctx: ExtensionCommandContext): Promise<void> {
  const text = await buildStatusText();
  await openInfoPanel(ctx, { title: "SF Google Workspace status", body: text, severity: "info" });
}

async function showReadTools(ctx: ExtensionCommandContext): Promise<void> {
  const tools = filterReadMcpTools(await listMcpTools());
  const text = formatCompactReadToolList(searchTools(tools, "", 50));
  ctx.ui.setEditorText(text);
  ctx.ui.notify("SF Google Workspace read tools copied to editor.", "info");
}

async function showFullCatalog(ctx: ExtensionCommandContext): Promise<void> {
  const tools = await listMcpTools();
  const text = formatMcpToolList(searchTools(tools, "", 50));
  ctx.ui.setEditorText(text);
  ctx.ui.notify("Google Workspace MCP catalog sample copied to editor.", "info");
}

function buildCommandHelpText(): string {
  return [
    "SF Google Workspace",
    "",
    "Usage:",
    "  /sf-google-workspace                 Open the standard sf-pi command panel",
    "  /sf-google-workspace status          Check mcp-adaptor auth/bridge status",
    "  /sf-google-workspace read-tools      List active read-only tools compactly",
    "  /sf-google-workspace tools           List full MCP catalog sample (debug/development)",
    "  /sf-google-workspace help            Show this help",
    "",
    "Preferred model flow:",
    "  first-class wrapper -> read_tool_search -> read_tool_describe -> read_tool_call",
    "",
    "Setup if auth fails:",
    "  ~/.mcp-adaptor/bin/mcp-adaptor auth",
    "  ~/.mcp-adaptor/bin/mcp-adaptor auth --provider google-workspace-readonly --env prod",
    "  ~/.mcp-adaptor/bin/mcp-adaptor auth --validate",
    "",
    "Avoid full catalog tools for routine read tasks.",
  ].join("\n");
}

function registerReadWrapperTools(pi: ExtensionAPI): void {
  for (const spec of READ_WRAPPER_SPECS) {
    pi.registerTool<TSchema, Record<string, unknown>>({
      name: spec.piToolName,
      label: spec.label,
      description: spec.description,
      parameters: spec.parameters,
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        return executeReadWrapper(spec, params);
      },
    });
  }
}

async function buildStatusText(): Promise<string> {
  const cfg = resolveMcpTransportConfig();
  const auth = await validateMcpAuth(cfg);
  let toolCount: number | null = null;
  let listError: unknown;
  if (auth.ok) {
    try {
      toolCount = (await listMcpTools(cfg)).length;
    } catch (err) {
      listError = sanitizeForLog(err instanceof Error ? err.message : String(err));
    }
  }

  return [
    "Salesforce Google Workspace MCP status",
    `- adaptor: ${cfg.adaptorPath}`,
    `- server: ${cfg.server}`,
    `- auth: ${auth.ok ? "ok" : "failed"}`,
    auth.stdout ? `- auth stdout: ${auth.stdout}` : "",
    auth.stderr ? `- auth stderr: ${auth.stderr}` : "",
    toolCount == null ? "" : `- tools: ${toolCount}`,
    listError ? `- tools/list error: ${JSON.stringify(listError)}` : "",
    "",
    "Setup if auth fails:",
    "1. ~/.mcp-adaptor/bin/mcp-adaptor auth",
    "2. ~/.mcp-adaptor/bin/mcp-adaptor auth --provider google-workspace-readonly --env prod",
    "3. ~/.mcp-adaptor/bin/mcp-adaptor auth --validate",
  ]
    .filter(Boolean)
    .join("\n");
}
