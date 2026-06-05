/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for compact search output, describe tool, and schema summarization helpers.
 *
 * Covers:
 *  - summarizeToolDescription: one-line summary extraction
 *  - extractSchemaParams: required/optional param extraction
 *  - formatCompactReadToolList: compact numbered display
 *  - describeReadTool + formatReadToolDescribe: single-tool full describe
 *  - Smoke tests for the describe + compact search execution paths
 */

import { test, assert } from "vitest";
import {
  describeReadTool,
  extractSchemaParams,
  formatCompactReadToolList,
  formatReadToolDescribe,
  summarizeToolDescription,
} from "../lib/read-tools.ts";
import {
  assertReadMcpTool,
  filterReadMcpTools,
  ReadToolNotAllowedError,
} from "../lib/read-tools.ts";
import { searchTools, stringifyBounded } from "../lib/mcp.ts";
import { getWrapperByPiName } from "../lib/read-wrappers.ts";
import type { McpToolInfo } from "../lib/mcp.ts";

// --- summarizeToolDescription ---

test("summarizeToolDescription returns first sentence for short descriptions", () => {
  const result = summarizeToolDescription("Retrieves events from a specified Google Calendar.");
  assert.equal(result, "Retrieves events from a specified Google Calendar.");
});

test("summarizeToolDescription truncates at first sentence for long descriptions", () => {
  const long =
    "Retrieves events from a specified Google Calendar. Can retrieve a single event by ID or multiple events within a time range. Supports optional filters.";
  const result = summarizeToolDescription(long);
  assert.equal(result, "Retrieves events from a specified Google Calendar.");
});

test("summarizeToolDescription truncates at word boundary for no-sentence text", () => {
  const noSentence =
    "A very long description without sentence endings that goes on and on and on and on and on and on and on and on and on and on and keeps going further";
  const result = summarizeToolDescription(noSentence);
  assert.ok(result.length <= 121); // 120 + ellipsis
  assert.ok(result.endsWith("…"));
});

test("summarizeToolDescription handles empty/undefined", () => {
  assert.equal(summarizeToolDescription(""), "");
  assert.equal(summarizeToolDescription(undefined), "");
});

test("summarizeToolDescription collapses whitespace", () => {
  const multiline = "Retrieves events\n  from a specified\n  Google Calendar.";
  const result = summarizeToolDescription(multiline);
  assert.equal(result, "Retrieves events from a specified Google Calendar.");
});

// --- extractSchemaParams ---

test("extractSchemaParams extracts required and optional from standard schema", () => {
  const schema = {
    type: "object",
    properties: {
      calendar_id: { type: "string" },
      time_min: { type: "string" },
      time_max: { type: "string" },
      max_results: { type: "number" },
    },
    required: ["time_min", "time_max"],
  };
  const result = extractSchemaParams(schema);
  assert.deepEqual(result.required, ["time_min", "time_max"]);
  assert.deepEqual(result.optional, ["calendar_id", "max_results"]);
});

test("extractSchemaParams handles no required array", () => {
  const schema = {
    type: "object",
    properties: {
      calendar_id: { type: "string" },
      max_results: { type: "number" },
    },
  };
  const result = extractSchemaParams(schema);
  assert.deepEqual(result.required, []);
  assert.deepEqual(result.optional, ["calendar_id", "max_results"]);
});

test("extractSchemaParams handles all required", () => {
  const schema = {
    type: "object",
    properties: {
      form_id: { type: "string" },
    },
    required: ["form_id"],
  };
  const result = extractSchemaParams(schema);
  assert.deepEqual(result.required, ["form_id"]);
  assert.deepEqual(result.optional, []);
});

test("extractSchemaParams handles null/undefined schema", () => {
  assert.deepEqual(extractSchemaParams(null), { required: [], optional: [] });
  assert.deepEqual(extractSchemaParams(undefined), { required: [], optional: [] });
});

test("extractSchemaParams handles schema without properties", () => {
  assert.deepEqual(extractSchemaParams({ type: "object" }), { required: [], optional: [] });
  assert.deepEqual(extractSchemaParams({}), { required: [], optional: [] });
});

// --- formatCompactReadToolList ---

test("formatCompactReadToolList produces compact numbered format", () => {
  const tools: McpToolInfo[] = [
    {
      name: "get_events",
      description:
        "Retrieves events from a specified Google Calendar. Can retrieve a single event by ID or multiple events within a time range.",
      inputSchema: {
        type: "object",
        properties: {
          calendar_id: { type: "string" },
          event_id: { type: "string" },
          time_min: { type: "string" },
          time_max: { type: "string" },
        },
      },
    },
    {
      name: "query_freebusy",
      description: "Returns free/busy information for calendars.",
      inputSchema: {
        type: "object",
        properties: {
          time_min: { type: "string" },
          time_max: { type: "string" },
          calendar_ids: { type: "array" },
        },
        required: ["time_min", "time_max"],
      },
    },
  ];

  const text = formatCompactReadToolList(tools);

  // Contains tool names
  assert.ok(text.includes("get_events"));
  assert.ok(text.includes("query_freebusy"));

  // Contains one-line summaries
  assert.ok(text.includes("Retrieves events from a specified Google Calendar."));
  assert.ok(text.includes("Returns free/busy information for calendars."));

  // Contains required/optional
  assert.ok(text.includes("Required: none"));
  assert.ok(text.includes("Optional: calendar_id, event_id, time_min, time_max"));
  assert.ok(text.includes("Required: time_min, time_max"));
  assert.ok(text.includes("Optional: calendar_ids"));

  // Does NOT contain raw JSON schema
  assert.ok(!text.includes('"type": "object"'));
  assert.ok(!text.includes("inputSchema"));
});

test("formatCompactReadToolList returns message for empty list", () => {
  const text = formatCompactReadToolList([]);
  assert.ok(text.includes("No read-only Google Workspace tools matched"));
});

test("formatCompactReadToolList handles tools without schema", () => {
  const tools: McpToolInfo[] = [
    { name: "list_calendars", description: "List available calendars" },
  ];
  const text = formatCompactReadToolList(tools);
  assert.ok(text.includes("list_calendars"));
  assert.ok(text.includes("Required: none"));
  assert.ok(text.includes("Optional: none"));
});

// --- describeReadTool ---

test("describeReadTool returns full tool info for valid tool", () => {
  const tools: McpToolInfo[] = [
    {
      name: "get_events",
      description: "Retrieves events from a specified Google Calendar.",
      inputSchema: {
        type: "object",
        properties: {
          calendar_id: { type: "string" },
          time_min: { type: "string" },
        },
        required: ["time_min"],
      },
    },
  ];
  const result = describeReadTool("get_events", tools);
  assert.ok(result !== null);
  assert.equal(result.name, "get_events");
  assert.equal(result.description, "Retrieves events from a specified Google Calendar.");
  assert.deepEqual(result.required, ["time_min"]);
  assert.deepEqual(result.optional, ["calendar_id"]);
  assert.ok(result.inputSchema !== null);
});

test("describeReadTool returns null for tool not in catalog", () => {
  const tools: McpToolInfo[] = [{ name: "list_calendars", description: "List calendars" }];
  const result = describeReadTool("nonexistent_tool", tools);
  assert.equal(result, null);
});

// --- formatReadToolDescribe ---

test("formatReadToolDescribe produces human-readable output", () => {
  const result = formatReadToolDescribe({
    name: "get_events",
    description: "Retrieves events from a specified Google Calendar.",
    required: ["time_min"],
    optional: ["calendar_id", "max_results"],
    inputSchema: {
      type: "object",
      properties: { time_min: { type: "string" } },
      required: ["time_min"],
    },
  });

  assert.ok(result.startsWith("get_events"));
  assert.ok(result.includes("Retrieves events from a specified Google Calendar."));
  assert.ok(result.includes("Required: time_min"));
  assert.ok(result.includes("Optional: calendar_id, max_results"));
  assert.ok(result.includes("Schema:"));
  assert.ok(result.includes('"type": "object"'));
});

test("formatReadToolDescribe handles no schema", () => {
  const result = formatReadToolDescribe({
    name: "list_calendars",
    description: "List available calendars.",
    required: [],
    optional: [],
    inputSchema: null,
  });
  assert.ok(result.includes("list_calendars"));
  assert.ok(!result.includes("Schema:"));
});

// --- Smoke: simulated compact search execution path ---

const MOCK_CATALOG: McpToolInfo[] = [
  {
    name: "get_events",
    description:
      "Retrieves events from a specified Google Calendar. Can retrieve a single event by ID.",
    inputSchema: {
      type: "object",
      properties: {
        calendar_id: { type: "string" },
        event_id: { type: "string" },
        time_min: { type: "string" },
        time_max: { type: "string" },
        max_results: { type: "number" },
        query: { type: "string" },
        detailed: { type: "boolean" },
        include_attachments: { type: "boolean" },
      },
    },
  },
  {
    name: "list_calendars",
    description: "Retrieves calendars accessible to the authenticated user.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "query_freebusy",
    description: "Returns free/busy information for calendars.",
    inputSchema: {
      type: "object",
      properties: {
        time_min: { type: "string" },
        time_max: { type: "string" },
        calendar_ids: { type: "array" },
        group_expansion_max: { type: "number" },
        calendar_expansion_max: { type: "number" },
      },
      required: ["time_min", "time_max"],
    },
  },
  { name: "create_doc", description: "Create a new Google Doc" },
  { name: "send_gmail_message", description: "Send an email via Gmail" },
  {
    name: "search_drive_files",
    description: "Search for files in Google Drive",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "get_doc_as_markdown",
    description: "Get document content as markdown",
    inputSchema: {
      type: "object",
      properties: { document_id: { type: "string" } },
      required: ["document_id"],
    },
  },
  {
    name: "list_tasks",
    description: "List tasks in a task list",
    inputSchema: { type: "object", properties: { task_list_id: { type: "string" } } },
  },
];

function simulateCompactSearch(params: {
  query: string;
  limit?: number;
  include_schema?: boolean;
}) {
  const readTools = filterReadMcpTools(MOCK_CATALOG);
  const matches = searchTools(readTools, params.query || "", params.limit ?? 20);

  let text: string;
  if (params.include_schema) {
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
    text = formatCompactReadToolList(matches);
  }
  return { text, count: matches.length, matches };
}

function simulateDescribe(params: { tool_name: string }) {
  const wrapper = getWrapperByPiName(params.tool_name);
  const mcpToolName = wrapper?.underlyingTool ?? params.tool_name;
  try {
    assertReadMcpTool(mcpToolName);
  } catch (err) {
    if (err instanceof ReadToolNotAllowedError) {
      return {
        ok: false as const,
        error: "not_in_read_allowlist",
        tool_name: params.tool_name,
        text: err.message,
      };
    }
    throw err;
  }
  const result = describeReadTool(mcpToolName, MOCK_CATALOG);
  if (!result) {
    return {
      ok: false as const,
      error: "tool_not_found_in_catalog",
      tool_name: params.tool_name,
      mcp_tool_name: mcpToolName,
      text: `Tool "${mcpToolName}" not found`,
    };
  }
  return {
    ok: true as const,
    tool_name: params.tool_name,
    mcp_tool_name: mcpToolName,
    text: formatReadToolDescribe(result),
    ...result,
  };
}

// --- Compact search tests ---

test("smoke/compact_search: default output is compact (no full schemas)", () => {
  const { text } = simulateCompactSearch({ query: "calendar" });
  // Should have tool names and summaries
  assert.ok(text.includes("get_events"));
  assert.ok(text.includes("list_calendars"));
  assert.ok(text.includes("query_freebusy"));
  // Should have Required/Optional lines
  assert.ok(text.includes("Required:"));
  assert.ok(text.includes("Optional:"));
  // Should NOT contain raw JSON schema objects
  assert.ok(!text.includes('"type": "object"'));
  assert.ok(!text.includes("inputSchema"));
});

test("smoke/compact_search: include_schema bounded to 3 with warning", () => {
  // Search for something that returns > 3 matches
  const { text, count } = simulateCompactSearch({ query: "", include_schema: true });
  assert.ok(count > 3, "need > 3 matches for this test");
  // Only 3 tools' schemas should appear (bounded)
  const parsed = JSON.parse(text.split("\n\n[")[0]!);
  assert.equal(parsed.length, 3);
  // Warning text present
  assert.ok(text.includes("Prefer google_workspace_read_tool_describe"));
  assert.ok(text.includes(`first 3 of ${count} matches`));
});

test("smoke/compact_search: include_schema with <= 3 results shows tip", () => {
  const { text, count } = simulateCompactSearch({ query: "freebusy", include_schema: true });
  assert.ok(count <= 3);
  assert.ok(count > 0);
  assert.ok(text.includes("[Tip: Prefer google_workspace_read_tool_describe"));
});

test("smoke/compact_search: compact output includes required params for query_freebusy", () => {
  const { text } = simulateCompactSearch({ query: "freebusy" });
  assert.ok(text.includes("Required: time_min, time_max"));
  assert.ok(text.includes("Optional: calendar_ids, group_expansion_max, calendar_expansion_max"));
});

test("smoke/compact_search: compact output shows 'none' for tools without required params", () => {
  const { text } = simulateCompactSearch({ query: "list_calendars" });
  assert.ok(text.includes("Required: none"));
  assert.ok(text.includes("Optional: none"));
});

// --- Describe tests ---

test("smoke/describe: returns full schema for valid read tool", () => {
  const result = simulateDescribe({ tool_name: "get_events" });
  assert.equal(result.ok, true);
  assert.ok(result.text.includes("get_events"));
  assert.ok(result.text.includes("Retrieves events"));
  assert.ok(result.text.includes("Schema:"));
  assert.ok(result.text.includes("calendar_id"));
  assert.ok(result.text.includes("time_min"));
});

test("smoke/describe: rejects create_doc", () => {
  const result = simulateDescribe({ tool_name: "create_doc" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "not_in_read_allowlist");
});

test("smoke/describe: rejects send_gmail_message", () => {
  const result = simulateDescribe({ tool_name: "send_gmail_message" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "not_in_read_allowlist");
});

test("smoke/describe: accepts first-class wrapper names by resolving to underlying read tool", () => {
  const result = simulateDescribe({ tool_name: "google_docs_get_as_markdown" });
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("expected ok describe result");
  assert.equal(result.name, "get_doc_as_markdown");
  assert.equal(result.mcp_tool_name, "get_doc_as_markdown");
});

test("smoke/describe: rejects deferred first-class wrapper names", () => {
  const result = simulateDescribe({ tool_name: "google_forms_get_form" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "not_in_read_allowlist");
});

test("smoke/describe: returns not_found for allowlisted tool missing from catalog", () => {
  // get_drive_file_content is in the active allowlist but not in MOCK_CATALOG
  const result = simulateDescribe({ tool_name: "get_drive_file_content" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "tool_not_found_in_catalog");
});

test("smoke/describe: includes required and optional in result", () => {
  const result = simulateDescribe({ tool_name: "query_freebusy" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.required, ["time_min", "time_max"]);
    assert.ok(result.optional.includes("calendar_ids"));
  }
});

test("smoke/describe: search_drive_files shows required query param", () => {
  const result = simulateDescribe({ tool_name: "search_drive_files" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.required, ["query"]);
  }
});
