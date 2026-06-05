/* SPDX-License-Identifier: Apache-2.0 */
/**
 * read-tools.ts — curated read-only allowlist for Salesforce Google Workspace MCP tools.
 *
 * This module provides:
 *  - A static allowlist of read-only MCP tool names.
 *  - Filter/assertion helpers for the read-only facade tools.
 *
 * The active allowlist covers Drive, Docs, Sheets, Slides, Calendar, and Gmail
 * read-only tools. Forms and Tasks are intentionally deferred to keep the first
 * upstream integration focused; their names are retained in DEFERRED_READ_MCP_TOOLS
 * for future activation.
 */

import type { McpToolInfo } from "./mcp.ts";

/**
 * Type alias for read-only MCP tool names.
 * Runtime enforcement is handled by assertReadMcpTool; this provides
 * documentation intent at the type level.
 */
export type ReadMcpToolName = string;

/**
 * Curated read-only MCP tool allowlist.
 *
 * Only tools in this set are accessible through `google_workspace_read_tool_search`
 * and `google_workspace_read_tool_call`. All write/modify/send/manage operations
 * are excluded regardless of their actual side effects.
 */
export const READ_MCP_TOOLS: ReadonlySet<string> = new Set([
  // Drive / file discovery and metadata
  "check_drive_file_public_access",
  "get_drive_file_content",
  "get_drive_file_download_url",
  "get_drive_file_permissions",
  "get_drive_shareable_link",
  "list_docs_in_folder",
  "list_drive_items",
  "list_spreadsheets",
  "search_docs",
  "search_drive_files",

  // Docs read / inspect
  "debug_table_structure",
  "get_doc_as_markdown",
  "get_doc_content",
  "inspect_doc_structure",
  "list_document_comments",

  // Sheets read
  "get_spreadsheet_info",
  "list_spreadsheet_comments",
  "read_sheet_values",

  // Slides read
  "get_page",
  "get_page_thumbnail",
  "get_presentation",
  "list_presentation_comments",

  // Calendar read
  "get_events",
  "list_calendars",
  "query_freebusy",

  // Gmail read (read-only but sensitive — send/modify/draft excluded)
  "get_gmail_attachment_content",
  "get_gmail_message_content",
  "get_gmail_messages_content_batch",
  "get_gmail_thread_content",
  "get_gmail_threads_content_batch",
  "list_gmail_filters",
  "list_gmail_labels",
  "search_gmail_messages",
]);

/**
 * Read-only tools intentionally not exposed in the first extension cut.
 * Kept here so future work can activate them without rediscovering names.
 */
export const DEFERRED_READ_MCP_TOOLS: ReadonlySet<string> = new Set([
  // Forms read
  "get_form",
  "get_form_response",
  "list_form_responses",

  // Tasks read
  "get_task",
  "get_task_list",
  "list_task_lists",
  "list_tasks",
]);

/**
 * Check whether a tool name is in the read-only allowlist.
 */
export function isReadMcpTool(toolName: string): boolean {
  return READ_MCP_TOOLS.has(toolName);
}

/**
 * Filter a full MCP tool list down to only read-only allowlisted tools.
 */
export function filterReadMcpTools(tools: readonly McpToolInfo[]): McpToolInfo[] {
  return tools.filter((tool) => READ_MCP_TOOLS.has(tool.name));
}

export class ReadToolNotAllowedError extends Error {
  readonly toolName: string;
  constructor(toolName: string) {
    super(
      `Tool "${toolName}" is not in the read-only allowlist. ` +
        `Use google_workspace_read_tool_search to discover available read tools, ` +
        `or use google_workspace_call for the full catalog (write guard still applies).`,
    );
    this.name = "ReadToolNotAllowedError";
    this.toolName = toolName;
  }
}

/**
 * Assert that a tool name is in the read-only allowlist.
 * Throws ReadToolNotAllowedError if not.
 */
export function assertReadMcpTool(toolName: string): void {
  if (!READ_MCP_TOOLS.has(toolName)) {
    throw new ReadToolNotAllowedError(toolName);
  }
}

// --- Schema summarization helpers for compact display ---

/**
 * Summarize a tool description into a single line.
 * Takes the first sentence (up to ~120 chars) and strips excess whitespace.
 */
export function summarizeToolDescription(description: string | undefined): string {
  if (!description) return "";
  const normalized = description.replace(/\s+/g, " ").trim();
  // Take up to first sentence-ending punctuation
  const match = normalized.match(/^(.{1,120}?[.!?])(?:\s|$)/);
  if (match?.[1]) return match[1];
  // No sentence end found — truncate at word boundary
  if (normalized.length <= 120) return normalized;
  const truncated = normalized.slice(0, 120).replace(/\s\S*$/, "");
  return truncated ? `${truncated}…` : `${normalized.slice(0, 117)}…`;
}

/**
 * Extract required and optional parameter names from an MCP tool's inputSchema.
 */
export function extractSchemaParams(inputSchema: unknown): {
  required: string[];
  optional: string[];
} {
  if (!inputSchema || typeof inputSchema !== "object") {
    return { required: [], optional: [] };
  }
  const schema = inputSchema as Record<string, unknown>;
  const properties = schema.properties;
  if (!properties || typeof properties !== "object") {
    return { required: [], optional: [] };
  }

  const allKeys = Object.keys(properties as Record<string, unknown>);
  const requiredSet = new Set<string>(
    Array.isArray(schema.required) ? (schema.required as string[]) : [],
  );

  const required = allKeys.filter((k) => requiredSet.has(k));
  const optional = allKeys.filter((k) => !requiredSet.has(k));
  return { required, optional };
}

/**
 * Format a compact tool list suitable for LLM consumption without full schemas.
 * Each entry shows: name, one-line summary, required params, optional params.
 */
export function formatCompactReadToolList(tools: readonly McpToolInfo[]): string {
  if (tools.length === 0) return "No read-only Google Workspace tools matched.";

  const lines = tools.map((tool, index) => {
    const summary = summarizeToolDescription(tool.description);
    const { required, optional } = extractSchemaParams(tool.inputSchema);
    const parts: string[] = [];
    parts.push(`${index + 1}. ${tool.name}${summary ? ` — ${summary}` : ""}`);
    parts.push(`   Required: ${required.length > 0 ? required.join(", ") : "none"}`);
    parts.push(`   Optional: ${optional.length > 0 ? optional.join(", ") : "none"}`);
    return parts.join("\n");
  });

  return lines.join("\n\n");
}

export interface ReadToolDescribeResult {
  name: string;
  description: string;
  required: string[];
  optional: string[];
  inputSchema: unknown;
}

/**
 * Describe a single read-only tool: full description, schema, and extracted params.
 * Returns null if the tool is not found in the provided catalog.
 */
export function describeReadTool(
  toolName: string,
  tools: readonly McpToolInfo[],
): ReadToolDescribeResult | null {
  const tool = tools.find((t) => t.name === toolName);
  if (!tool) return null;
  const { required, optional } = extractSchemaParams(tool.inputSchema);
  return {
    name: tool.name,
    description: tool.description || "",
    required,
    optional,
    inputSchema: tool.inputSchema ?? null,
  };
}

/**
 * Format a single tool describe result as human-readable text.
 */
export function formatReadToolDescribe(result: ReadToolDescribeResult): string {
  const lines: string[] = [
    result.name,
    result.description || "(no description)",
    "",
    `Required: ${result.required.length > 0 ? result.required.join(", ") : "none"}`,
    `Optional: ${result.optional.length > 0 ? result.optional.join(", ") : "none"}`,
  ];
  if (result.inputSchema) {
    lines.push("", "Schema:", JSON.stringify(result.inputSchema, null, 2));
  }
  return lines.join("\n");
}

/**
 * Return a short summary of the read-only allowlist for diagnostics.
 */
export function readToolSummary(): { total: number; categories: Record<string, string[]> } {
  const categories: Record<
    "drive" | "docs" | "sheets" | "slides" | "calendar" | "gmail",
    string[]
  > = {
    drive: [],
    docs: [],
    sheets: [],
    slides: [],
    calendar: [],
    gmail: [],
  };

  for (const name of READ_MCP_TOOLS) {
    if (
      name.includes("drive") ||
      name.includes("docs_in_folder") ||
      name === "list_spreadsheets" ||
      name === "search_docs"
    ) {
      categories.drive.push(name);
    } else if (name.includes("doc") || name.includes("table_structure")) {
      categories.docs.push(name);
    } else if (name.includes("sheet") || name.includes("spreadsheet")) {
      categories.sheets.push(name);
    } else if (
      name.includes("page") ||
      name.includes("presentation") ||
      name === "list_presentation_comments"
    ) {
      categories.slides.push(name);
    } else if (name.includes("calendar") || name.includes("event") || name.includes("freebusy")) {
      categories.calendar.push(name);
    } else if (name.includes("gmail")) {
      categories.gmail.push(name);
    }
  }

  return { total: READ_MCP_TOOLS.size, categories };
}
