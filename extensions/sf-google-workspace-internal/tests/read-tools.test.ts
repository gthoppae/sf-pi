/* SPDX-License-Identifier: Apache-2.0 */
import { test, assert } from "vitest";
import {
  READ_MCP_TOOLS,
  ReadToolNotAllowedError,
  assertReadMcpTool,
  filterReadMcpTools,
  isReadMcpTool,
  readToolSummary,
} from "../lib/read-tools.ts";
import type { McpToolInfo } from "../lib/mcp.ts";

// --- isReadMcpTool ---

test("isReadMcpTool returns true for allowlisted tools", () => {
  assert.equal(isReadMcpTool("search_drive_files"), true);
  assert.equal(isReadMcpTool("get_doc_as_markdown"), true);
  assert.equal(isReadMcpTool("read_sheet_values"), true);
  assert.equal(isReadMcpTool("get_events"), true);
  assert.equal(isReadMcpTool("search_gmail_messages"), true);
  assert.equal(isReadMcpTool("get_presentation"), true);
});

test("isReadMcpTool returns false for write/modify/send tools", () => {
  assert.equal(isReadMcpTool("create_doc"), false);
  assert.equal(isReadMcpTool("send_gmail_message"), false);
  assert.equal(isReadMcpTool("manage_event"), false);
  assert.equal(isReadMcpTool("modify_sheet_values"), false);
  assert.equal(isReadMcpTool("delete_drive_file"), false);
  assert.equal(isReadMcpTool("draft_gmail_message"), false);
  assert.equal(isReadMcpTool("update_presentation"), false);
  assert.equal(isReadMcpTool("batch_modify_gmail_message_labels"), false);
});

test("isReadMcpTool returns false for unknown tools", () => {
  assert.equal(isReadMcpTool("nonexistent_tool"), false);
  assert.equal(isReadMcpTool(""), false);
});

// --- filterReadMcpTools ---

test("filterReadMcpTools returns only allowlisted tools", () => {
  const tools: McpToolInfo[] = [
    { name: "search_drive_files", description: "Find files" },
    { name: "create_doc", description: "Create a document" },
    { name: "get_doc_content", description: "Read a document" },
    { name: "send_gmail_message", description: "Send email" },
    { name: "get_events", description: "Get calendar events" },
    { name: "modify_sheet_values", description: "Modify spreadsheet cells" },
    { name: "list_tasks", description: "List tasks" },
  ];
  const result = filterReadMcpTools(tools);
  const names = result.map((t) => t.name);
  assert.deepEqual(names, ["search_drive_files", "get_doc_content", "get_events"]);
});

test("filterReadMcpTools returns empty for all-write tools", () => {
  const tools: McpToolInfo[] = [
    { name: "create_doc", description: "Create" },
    { name: "delete_doc", description: "Delete" },
  ];
  assert.deepEqual(filterReadMcpTools(tools), []);
});

test("filterReadMcpTools preserves tool metadata", () => {
  const schema = { type: "object", properties: { id: { type: "string" } } };
  const tools: McpToolInfo[] = [
    { name: "get_doc_as_markdown", description: "Read doc as markdown", inputSchema: schema },
  ];
  const result = filterReadMcpTools(tools);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.description, "Read doc as markdown");
  assert.deepEqual(result[0]?.inputSchema, schema);
});

// --- assertReadMcpTool ---

test("assertReadMcpTool does not throw for allowlisted tools", () => {
  assert.doesNotThrow(() => assertReadMcpTool("search_drive_files"));
  assert.doesNotThrow(() => assertReadMcpTool("get_gmail_message_content"));
  assert.doesNotThrow(() => assertReadMcpTool("list_calendars"));
});

test("assertReadMcpTool throws ReadToolNotAllowedError for write tools", () => {
  assert.throws(() => assertReadMcpTool("create_doc"), ReadToolNotAllowedError);
  assert.throws(() => assertReadMcpTool("send_gmail_message"), ReadToolNotAllowedError);
  assert.throws(() => assertReadMcpTool("manage_event"), ReadToolNotAllowedError);
  assert.throws(() => assertReadMcpTool("modify_sheet_values"), ReadToolNotAllowedError);
});

test("assertReadMcpTool error message includes tool name and guidance", () => {
  try {
    assertReadMcpTool("create_doc");
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof ReadToolNotAllowedError);
    assert.equal(err.toolName, "create_doc");
    assert.ok(err.message.includes("create_doc"));
    assert.ok(err.message.includes("read-only allowlist"));
    assert.ok(err.message.includes("google_workspace_read_tool_search"));
  }
});

// --- READ_MCP_TOOLS set integrity ---

test("READ_MCP_TOOLS contains expected tool count", () => {
  // 10 Drive + 5 Docs + 3 Sheets + 4 Slides + 3 Calendar + 8 Gmail = 33
  assert.equal(READ_MCP_TOOLS.size, 33);
});

test("READ_MCP_TOOLS does not contain any write/modify/send patterns", () => {
  const writePatterns =
    /^(create|update|delete|remove|send|draft|modify|batch_modify|insert|append|replace|import|upload|copy|move|share|set|grant|revoke|manage)/;
  for (const name of READ_MCP_TOOLS) {
    assert.ok(!writePatterns.test(name), `Unexpected write-pattern tool in allowlist: ${name}`);
  }
});

test("READ_MCP_TOOLS includes all spec-defined Drive tools", () => {
  const driveTools = [
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
  ];
  for (const tool of driveTools) {
    assert.ok(READ_MCP_TOOLS.has(tool), `Missing Drive tool: ${tool}`);
  }
});

test("READ_MCP_TOOLS includes all spec-defined Gmail tools", () => {
  const gmailTools = [
    "get_gmail_attachment_content",
    "get_gmail_message_content",
    "get_gmail_messages_content_batch",
    "get_gmail_thread_content",
    "get_gmail_threads_content_batch",
    "list_gmail_filters",
    "list_gmail_labels",
    "search_gmail_messages",
  ];
  for (const tool of gmailTools) {
    assert.ok(READ_MCP_TOOLS.has(tool), `Missing Gmail tool: ${tool}`);
  }
});

test("READ_MCP_TOOLS includes all spec-defined Calendar tools", () => {
  const calendarTools = ["get_events", "list_calendars", "query_freebusy"];
  for (const tool of calendarTools) {
    assert.ok(READ_MCP_TOOLS.has(tool), `Missing Calendar tool: ${tool}`);
  }
});

test("READ_MCP_TOOLS intentionally excludes deferred Forms and Tasks tools", () => {
  const deferredTools = [
    "get_form",
    "get_form_response",
    "list_form_responses",
    "get_task",
    "get_task_list",
    "list_task_lists",
    "list_tasks",
  ];
  for (const tool of deferredTools) {
    assert.equal(READ_MCP_TOOLS.has(tool), false, `Deferred tool should not be active: ${tool}`);
  }
});

// --- readToolSummary ---

test("readToolSummary returns correct total", () => {
  const summary = readToolSummary();
  assert.equal(summary.total, 33);
});

test("readToolSummary categorizes tools", () => {
  const summary = readToolSummary();
  assert.ok(summary.categories.drive!.length > 0);
  assert.ok(summary.categories.gmail!.length > 0);
  assert.ok(summary.categories.calendar!.length > 0);
  assert.equal(summary.categories.forms, undefined);
  assert.equal(summary.categories.tasks, undefined);
});
