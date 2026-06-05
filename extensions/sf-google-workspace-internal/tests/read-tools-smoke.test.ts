/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Smoke tests for google_workspace_read_tool_search and google_workspace_read_tool_call
 * execute paths.
 *
 * These test the full composition of functions that the registered tool execute
 * methods use, verifying integration without requiring a live mcp-adaptor.
 *
 * Pattern: exercise the same code path as the execute functions by composing
 * the same helpers (filterReadMcpTools → searchTools → format, etc.)
 */

import { test, assert } from "vitest";
import { sanitizeMcpResult, searchTools, stringifyBounded } from "../lib/mcp.ts";
import {
  assertReadMcpTool,
  filterReadMcpTools,
  formatCompactReadToolList,
  ReadToolNotAllowedError,
} from "../lib/read-tools.ts";
import type { McpToolInfo } from "../lib/mcp.ts";

// Representative mock of what tools/list returns from the live MCP server
const MOCK_MCP_CATALOG: McpToolInfo[] = [
  // Read tools (in allowlist)
  {
    name: "search_drive_files",
    description: "Search for files in Google Drive",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
  },
  {
    name: "get_doc_as_markdown",
    description: "Get document content as markdown",
    inputSchema: { type: "object", properties: { document_id: { type: "string" } } },
  },
  {
    name: "get_events",
    description: "Get calendar events for a date range",
    inputSchema: { type: "object", properties: { calendar_id: { type: "string" } } },
  },
  {
    name: "read_sheet_values",
    description: "Read values from a spreadsheet range",
    inputSchema: { type: "object", properties: { spreadsheet_id: { type: "string" } } },
  },
  {
    name: "get_gmail_message_content",
    description: "Get email message content by ID",
    inputSchema: { type: "object", properties: { message_id: { type: "string" } } },
  },
  {
    name: "get_presentation",
    description: "Get a Google Slides presentation",
    inputSchema: { type: "object", properties: { presentation_id: { type: "string" } } },
  },
  { name: "get_form", description: "Deferred Google Form read tool" },
  { name: "list_tasks", description: "Deferred Google Tasks read tool" },
  { name: "list_calendars", description: "List available calendars" },
  { name: "get_drive_file_content", description: "Get content of a Drive file" },
  { name: "check_drive_file_public_access", description: "Check if a file is publicly accessible" },
  { name: "list_gmail_labels", description: "List Gmail labels" },
  // Write tools (NOT in allowlist)
  { name: "create_doc", description: "Create a new Google Doc" },
  { name: "send_gmail_message", description: "Send an email via Gmail" },
  { name: "manage_event", description: "Create or update a calendar event" },
  { name: "modify_sheet_values", description: "Modify spreadsheet cell values" },
  { name: "delete_drive_file", description: "Delete a file from Drive" },
  { name: "draft_gmail_message", description: "Draft a Gmail message" },
  { name: "create_presentation", description: "Create a new presentation" },
  { name: "batch_modify_gmail_message_labels", description: "Batch modify Gmail labels" },
];

// --- Simulate google_workspace_read_tool_search execute path ---

function simulateReadToolSearch(params: {
  query: string;
  limit?: number;
  include_schema?: boolean;
}) {
  // This mirrors the exact logic from the registered tool's execute method
  const tools = MOCK_MCP_CATALOG; // in prod: await listMcpTools()
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
    content: [{ type: "text" as const, text }],
    details: { ok: true, count: matches.length, total_read_tools: readTools.length, matches },
  };
}

// --- Simulate google_workspace_read_tool_call execute path ---

function simulateReadToolCall(
  params: { tool_name: string; arguments: Record<string, unknown> },
  mcpResult: unknown,
) {
  // This is the exact logic from the registered tool's execute method
  try {
    assertReadMcpTool(params.tool_name);
  } catch (err) {
    if (err instanceof ReadToolNotAllowedError) {
      return {
        content: [{ type: "text" as const, text: err.message }],
        details: {
          ok: false as const,
          error: "not_in_read_allowlist",
          tool_name: params.tool_name,
        },
      };
    }
    throw err;
  }
  // In prod: const result = await callMcpTool(params.tool_name, params.arguments)
  const safe = sanitizeMcpResult(mcpResult);
  return {
    content: [{ type: "text" as const, text: stringifyBounded(safe, 20_000) }],
    details: { ok: true as const, tool_name: params.tool_name, result: safe },
  };
}

// === google_workspace_read_tool_search smoke tests ===

test("smoke/read_search: returns only read-allowlisted tools from full catalog", () => {
  const result = simulateReadToolSearch({ query: "" });
  assert.equal(result.details.ok, true);
  assert.equal(result.details.total_read_tools, 10); // active read tools in mock
  assert.equal(result.details.count, 10);

  const text = result.content[0]!.text;
  // Read tools present
  assert.ok(text.includes("search_drive_files"));
  assert.ok(text.includes("get_doc_as_markdown"));
  assert.ok(text.includes("get_events"));
  assert.ok(!text.includes("list_tasks"));
  assert.ok(!text.includes("get_form"));
  // Write/deferred tools excluded
  assert.ok(!text.includes("create_doc"));
  assert.ok(!text.includes("send_gmail_message"));
  assert.ok(!text.includes("manage_event"));
  assert.ok(!text.includes("modify_sheet_values"));
  assert.ok(!text.includes("delete_drive_file"));
  assert.ok(!text.includes("draft_gmail_message"));
});

test("smoke/read_search: keyword filters within read tools only", () => {
  const result = simulateReadToolSearch({ query: "calendar" });
  assert.equal(result.details.count, 2); // get_events (description) + list_calendars
  const names = result.details.matches.map((m: McpToolInfo) => m.name);
  assert.ok(names.includes("get_events"));
  assert.ok(names.includes("list_calendars"));
  // manage_event matches "calendar" keyword but should NOT appear
  assert.ok(!names.includes("manage_event"));
});

test("smoke/read_search: keyword 'gmail' returns read gmail tools only", () => {
  const result = simulateReadToolSearch({ query: "gmail" });
  const names = result.details.matches.map((m: McpToolInfo) => m.name);
  assert.ok(names.includes("get_gmail_message_content"));
  assert.ok(names.includes("list_gmail_labels"));
  // Write gmail tools excluded
  assert.ok(!names.includes("send_gmail_message"));
  assert.ok(!names.includes("draft_gmail_message"));
  assert.ok(!names.includes("batch_modify_gmail_message_labels"));
});

test("smoke/read_search: keyword 'drive' returns read drive tools only", () => {
  const result = simulateReadToolSearch({ query: "drive" });
  const names = result.details.matches.map((m: McpToolInfo) => m.name);
  assert.ok(names.includes("search_drive_files"));
  assert.ok(names.includes("get_drive_file_content"));
  assert.ok(names.includes("check_drive_file_public_access"));
  // Write drive tools excluded
  assert.ok(!names.includes("delete_drive_file"));
});

test("smoke/read_search: respects limit parameter", () => {
  const result = simulateReadToolSearch({ query: "", limit: 3 });
  assert.equal(result.details.count, 3);
  assert.equal(result.details.matches.length, 3);
});

test("smoke/read_search: include_schema returns bounded JSON with schemas and tip", () => {
  const result = simulateReadToolSearch({ query: "spreadsheet", include_schema: true });
  const text = result.content[0]!.text;
  // JSON is before the appended tip/warning
  const jsonPart = text.split("\n\n[")[0]!;
  const parsed = JSON.parse(jsonPart);
  assert.ok(Array.isArray(parsed));
  assert.ok(parsed.length > 0);
  // Schema should be present
  assert.ok(parsed[0].inputSchema);
  assert.equal(parsed[0].name, "read_sheet_values");
  // Tip text appended (only 1 match for "spreadsheet", so tip not cap warning)
  assert.ok(text.includes("Prefer google_workspace_read_tool_describe"));
});

test("smoke/read_search: without include_schema returns compact list with params", () => {
  const result = simulateReadToolSearch({ query: "sheet" });
  const text = result.content[0]!.text;
  assert.ok(text.includes("1."));
  assert.ok(text.includes("read_sheet_values"));
  // Compact format includes Required/Optional lines
  assert.ok(text.includes("Required:"));
  assert.ok(text.includes("Optional:"));
  // Should not be JSON
  assert.throws(() => JSON.parse(text));
});

// === google_workspace_read_tool_call smoke tests ===

test("smoke/read_call: accepts search_drive_files (spec acceptance criterion)", () => {
  const mcpResult = { content: [{ type: "text", text: "Found 3 files matching query" }] };
  const result = simulateReadToolCall(
    { tool_name: "search_drive_files", arguments: { query: "budget" } },
    mcpResult,
  );
  assert.equal(result.details.ok, true);
  assert.equal(result.details.tool_name, "search_drive_files");
  assert.ok(result.content[0]!.text.includes("Found 3 files"));
});

test("smoke/read_call: accepts get_events", () => {
  const mcpResult = { content: [{ type: "text", text: "3 events found" }] };
  const result = simulateReadToolCall(
    { tool_name: "get_events", arguments: { calendar_id: "primary" } },
    mcpResult,
  );
  assert.equal(result.details.ok, true);
  assert.equal(result.details.tool_name, "get_events");
});

test("smoke/read_call: accepts get_gmail_message_content", () => {
  const mcpResult = { content: [{ type: "text", text: "Subject: Hello\nFrom: user@example.com" }] };
  const result = simulateReadToolCall(
    { tool_name: "get_gmail_message_content", arguments: { message_id: "msg123" } },
    mcpResult,
  );
  assert.equal(result.details.ok, true);
});

test("smoke/read_call: rejects create_doc (spec acceptance criterion)", () => {
  const result = simulateReadToolCall(
    { tool_name: "create_doc", arguments: { title: "Bad" } },
    null,
  );
  assert.equal(result.details.ok, false);
  assert.equal(result.details.error, "not_in_read_allowlist");
  assert.equal(result.details.tool_name, "create_doc");
  assert.ok(result.content[0]!.text.includes("not in the read-only allowlist"));
  assert.ok(result.content[0]!.text.includes("google_workspace_read_tool_search"));
});

test("smoke/read_call: rejects send_gmail_message (spec acceptance criterion)", () => {
  const result = simulateReadToolCall(
    { tool_name: "send_gmail_message", arguments: { to: "x@x.com" } },
    null,
  );
  assert.equal(result.details.ok, false);
  assert.equal(result.details.error, "not_in_read_allowlist");
});

test("smoke/read_call: rejects manage_event (spec acceptance criterion)", () => {
  const result = simulateReadToolCall({ tool_name: "manage_event", arguments: {} }, null);
  assert.equal(result.details.ok, false);
  assert.equal(result.details.error, "not_in_read_allowlist");
});

test("smoke/read_call: rejects modify_sheet_values (spec acceptance criterion)", () => {
  const result = simulateReadToolCall({ tool_name: "modify_sheet_values", arguments: {} }, null);
  assert.equal(result.details.ok, false);
  assert.equal(result.details.error, "not_in_read_allowlist");
});

test("smoke/read_call: rejects unknown/invented tool names", () => {
  const result = simulateReadToolCall({ tool_name: "totally_fake_tool", arguments: {} }, null);
  assert.equal(result.details.ok, false);
  assert.equal(result.details.error, "not_in_read_allowlist");
});

test("smoke/read_call: rejects delete_drive_file", () => {
  const result = simulateReadToolCall(
    { tool_name: "delete_drive_file", arguments: { file_id: "x" } },
    null,
  );
  assert.equal(result.details.ok, false);
});

test("smoke/read_call: rejects batch_modify_gmail_message_labels", () => {
  const result = simulateReadToolCall(
    { tool_name: "batch_modify_gmail_message_labels", arguments: {} },
    null,
  );
  assert.equal(result.details.ok, false);
});

// --- Output safety and formatting ---

test("smoke/read_call: sanitizes Bearer tokens in MCP response", () => {
  const mcpResult = {
    content: [{ type: "text", text: "Auth: Bearer ya29.super-secret-access-token-here" }],
  };
  const result = simulateReadToolCall({ tool_name: "get_events", arguments: {} }, mcpResult);
  assert.equal(result.details.ok, true);
  assert.ok(!result.content[0]!.text.includes("ya29.super-secret"));
  assert.ok(result.content[0]!.text.includes("[REDACTED]"));
});

test("smoke/read_call: sanitizes secret-named keys in MCP response", () => {
  const mcpResult = {
    access_token: "ya29.very-secret-token-value",
    data: "safe data here",
  };
  const result = simulateReadToolCall({ tool_name: "list_calendars", arguments: {} }, mcpResult);
  assert.equal(result.details.ok, true);
  assert.ok(!result.content[0]!.text.includes("ya29.very-secret"));
  assert.ok(result.content[0]!.text.includes("safe data here"));
});

test("smoke/read_call: truncates very large MCP responses", () => {
  const mcpResult = { content: [{ type: "text", text: "x".repeat(30_000) }] };
  const result = simulateReadToolCall({ tool_name: "get_events", arguments: {} }, mcpResult);
  assert.equal(result.details.ok, true);
  assert.ok(result.content[0]!.text.length <= 21_000);
  assert.ok(result.content[0]!.text.includes("Output truncated"));
});

test("smoke/read_call: handles empty/null MCP response gracefully", () => {
  const result = simulateReadToolCall({ tool_name: "list_calendars", arguments: {} }, null);
  assert.equal(result.details.ok, true);
  assert.equal(result.content[0]!.text, "null");
});

// --- Full catalog vs read facade contrast ---

test("smoke/contrast: full searchTools returns write tools, filterReadMcpTools does not", () => {
  // Full catalog search
  const fullResults = searchTools(MOCK_MCP_CATALOG, "gmail", 50);
  const fullNames = fullResults.map((t) => t.name);
  assert.ok(fullNames.includes("send_gmail_message"));
  assert.ok(fullNames.includes("draft_gmail_message"));
  assert.ok(fullNames.includes("batch_modify_gmail_message_labels"));

  // Read-only facade
  const readResults = searchTools(filterReadMcpTools(MOCK_MCP_CATALOG), "gmail", 50);
  const readNames = readResults.map((t) => t.name);
  assert.ok(!readNames.includes("send_gmail_message"));
  assert.ok(!readNames.includes("draft_gmail_message"));
  assert.ok(!readNames.includes("batch_modify_gmail_message_labels"));
  // But read gmail tools ARE present
  assert.ok(readNames.includes("get_gmail_message_content"));
  assert.ok(readNames.includes("list_gmail_labels"));
});
