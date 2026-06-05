/* SPDX-License-Identifier: Apache-2.0 */
/**
 * read-wrappers.ts — first-class native Pi tool wrappers for all read-only MCP tools.
 *
 * Each wrapper:
 *  - Has a concise one-line description and minimal schema.
 *  - Maps friendly params to the underlying MCP tool's arguments.
 *  - Enforces the read-only allowlist via assertReadMcpTool.
 *  - Avoids context bloat: no multi-paragraph MCP descriptions in tool metadata.
 *
 * The wrappers are grouped by service. The existing `google_drive_search` (in drive.ts)
 * already covers `search_drive_files` and is registered separately.
 */

import type { TSchema } from "typebox";
import type { ReadMcpToolName } from "./read-tools.ts";
import { assertReadMcpTool } from "./read-tools.ts";
import { callMcpTool, sanitizeMcpResult, stringifyBounded } from "./mcp.ts";
import {
  buildCalendarEventsArgs,
  buildCalendarFreeBusyArgs,
  type CalendarFreeBusyParams,
  type CalendarGetEventsParams,
} from "./calendar.ts";

// ─── Wrapper spec type ───────────────────────────────────────────────────────

export interface ReadWrapperSpec {
  /** Pi tool name exposed to the model. */
  piToolName: string;
  /** Short label for UI. */
  label: string;
  /** One-line description (concise!). */
  description: string;
  /** The underlying MCP tool name from the read allowlist. */
  underlyingTool: ReadMcpToolName;
  /** JSON Schema for the tool's parameters. Keep minimal. */
  parameters: TSchema;
  /** Optional argument mapper. Defaults to identity pass-through. */
  mapArgs?: (params: Record<string, unknown>) => Record<string, unknown>;
  /** Optional output formatter. Defaults to bounded JSON stringify. */
  format?: (result: unknown) => string;
}

// ─── Shared execution helper ─────────────────────────────────────────────────

export async function executeReadWrapper(
  spec: ReadWrapperSpec,
  params: Record<string, unknown>,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }> {
  assertReadMcpTool(spec.underlyingTool);
  const args = spec.mapArgs ? spec.mapArgs(params) : params;
  const result = await callMcpTool(spec.underlyingTool, args);
  const safe = sanitizeMcpResult(result);
  const text = spec.format ? spec.format(safe) : stringifyBounded(safe, 20_000);
  return {
    content: [{ type: "text", text }],
    details: { ok: true, tool: spec.piToolName, underlying: spec.underlyingTool, result: safe },
  };
}

// ─── Parameter schema fragments ──────────────────────────────────────────────

const FILE_ID_PARAM = {
  file_id: { type: "string", description: "Google Drive file ID." },
} as const;
const DOC_ID_PARAM = {
  document_id: { type: "string", description: "Google Docs document ID." },
} as const;
const SPREADSHEET_ID_PARAM = {
  spreadsheet_id: { type: "string", description: "Google Sheets spreadsheet ID." },
} as const;
const PRESENTATION_ID_PARAM = {
  presentation_id: { type: "string", description: "Google Slides presentation ID." },
} as const;

function obj(props: Record<string, unknown>, required: string[] = []): TSchema {
  return { type: "object", properties: props, required, additionalProperties: false } as TSchema;
}

// ─── Wrapper definitions ─────────────────────────────────────────────────────

export const READ_WRAPPER_SPECS: readonly ReadWrapperSpec[] = [
  // ─── Drive / file ───
  {
    piToolName: "google_drive_check_public_access",
    label: "Check Drive File Public Access",
    description: "Check whether a Drive file is publicly accessible.",
    underlyingTool: "check_drive_file_public_access",
    parameters: obj(FILE_ID_PARAM, ["file_id"]),
  },
  {
    piToolName: "google_drive_get_file_content",
    label: "Get Drive File Content",
    description: "Get the text content of a Drive file.",
    underlyingTool: "get_drive_file_content",
    parameters: obj(FILE_ID_PARAM, ["file_id"]),
  },
  {
    piToolName: "google_drive_get_file_download_url",
    label: "Get Drive File Download URL",
    description: "Get a temporary download URL for a Drive file.",
    underlyingTool: "get_drive_file_download_url",
    parameters: obj(FILE_ID_PARAM, ["file_id"]),
  },
  {
    piToolName: "google_drive_get_file_permissions",
    label: "Get Drive File Permissions",
    description: "List permissions on a Drive file.",
    underlyingTool: "get_drive_file_permissions",
    parameters: obj(FILE_ID_PARAM, ["file_id"]),
  },
  {
    piToolName: "google_drive_get_shareable_link",
    label: "Get Drive Shareable Link",
    description: "Get a shareable link for a Drive file.",
    underlyingTool: "get_drive_shareable_link",
    parameters: obj(FILE_ID_PARAM, ["file_id"]),
  },
  {
    piToolName: "google_drive_list_docs_in_folder",
    label: "List Docs in Folder",
    description: "List documents inside a specific Drive folder.",
    underlyingTool: "list_docs_in_folder",
    parameters: obj({ folder_id: { type: "string", description: "Drive folder ID." } }, [
      "folder_id",
    ]),
  },
  {
    piToolName: "google_drive_list_items",
    label: "List Drive Items",
    description: "List items in Google Drive with optional filtering.",
    underlyingTool: "list_drive_items",
    parameters: obj({
      folder_id: { type: "string", description: "Drive folder ID. Default: root." },
      page_size: { type: "number", description: "Max items to return. Default 100." },
      page_token: { type: "string", description: "Pagination token." },
      drive_id: { type: "string", description: "Optional shared drive ID." },
      include_items_from_all_drives: {
        type: "boolean",
        description: "Include all accessible shared drives. Default true.",
      },
      corpora: { type: "string", description: "Corpus: user, drive, or allDrives." },
      file_type: { type: "string", description: "Friendly file type or raw MIME type." },
    }),
  },
  {
    piToolName: "google_drive_list_spreadsheets",
    label: "List Spreadsheets",
    description: "List Google Sheets spreadsheets in Drive.",
    underlyingTool: "list_spreadsheets",
    parameters: obj({
      max_results: { type: "number", description: "Max spreadsheets to return. Default 25." },
      limit: { type: "number", description: "Alias for max_results." },
    }),
    mapArgs(params) {
      const maxResults = params.max_results ?? params.limit;
      return maxResults == null ? {} : { max_results: maxResults };
    },
  },
  {
    piToolName: "google_drive_search_docs",
    label: "Search Docs",
    description: "Search for Google Docs documents by name or content.",
    underlyingTool: "search_docs",
    parameters: obj({ query: { type: "string", description: "Search query." } }, ["query"]),
  },
  // NOTE: search_drive_files is handled by the existing google_drive_search tool in drive.ts

  // ─── Docs ───
  {
    piToolName: "google_docs_debug_table_structure",
    label: "Debug Table Structure",
    description: "Inspect the structural layout of tables in a Google Doc.",
    underlyingTool: "debug_table_structure",
    parameters: obj(DOC_ID_PARAM, ["document_id"]),
  },
  {
    piToolName: "google_docs_get_as_markdown",
    label: "Get Doc as Markdown",
    description: "Read a Google Doc converted to Markdown.",
    underlyingTool: "get_doc_as_markdown",
    parameters: obj(DOC_ID_PARAM, ["document_id"]),
  },
  {
    piToolName: "google_docs_get_content",
    label: "Get Doc Content",
    description: "Read the raw content of a Google Doc.",
    underlyingTool: "get_doc_content",
    parameters: obj(DOC_ID_PARAM, ["document_id"]),
  },
  {
    piToolName: "google_docs_inspect_structure",
    label: "Inspect Doc Structure",
    description: "Inspect the structural elements of a Google Doc.",
    underlyingTool: "inspect_doc_structure",
    parameters: obj(DOC_ID_PARAM, ["document_id"]),
  },
  {
    piToolName: "google_docs_list_comments",
    label: "List Document Comments",
    description: "List comments on a Google Doc.",
    underlyingTool: "list_document_comments",
    parameters: obj(DOC_ID_PARAM, ["document_id"]),
  },

  // ─── Sheets ───
  {
    piToolName: "google_sheets_get_info",
    label: "Get Spreadsheet Info",
    description: "Get metadata about a Google Sheets spreadsheet.",
    underlyingTool: "get_spreadsheet_info",
    parameters: obj(SPREADSHEET_ID_PARAM, ["spreadsheet_id"]),
  },
  {
    piToolName: "google_sheets_list_comments",
    label: "List Spreadsheet Comments",
    description: "List comments on a Google Sheets spreadsheet.",
    underlyingTool: "list_spreadsheet_comments",
    parameters: obj(SPREADSHEET_ID_PARAM, ["spreadsheet_id"]),
  },
  {
    piToolName: "google_sheets_read_values",
    label: "Read Sheet Values",
    description: "Read cell values from a Google Sheets range.",
    underlyingTool: "read_sheet_values",
    parameters: obj(
      {
        ...SPREADSHEET_ID_PARAM,
        range: { type: "string", description: "A1 notation range, e.g. Sheet1!A1:D10." },
      },
      ["spreadsheet_id", "range"],
    ),
  },

  // ─── Slides ───
  {
    piToolName: "google_slides_get_page",
    label: "Get Slide Page",
    description: "Get a specific page/slide from a presentation.",
    underlyingTool: "get_page",
    parameters: obj(
      {
        ...PRESENTATION_ID_PARAM,
        page_id: { type: "string", description: "Page/slide object ID." },
      },
      ["presentation_id", "page_id"],
    ),
  },
  {
    piToolName: "google_slides_get_page_thumbnail",
    label: "Get Slide Page Thumbnail",
    description: "Get a thumbnail image URL for a slide page.",
    underlyingTool: "get_page_thumbnail",
    parameters: obj(
      {
        ...PRESENTATION_ID_PARAM,
        page_id: { type: "string", description: "Page/slide object ID." },
      },
      ["presentation_id", "page_id"],
    ),
  },
  {
    piToolName: "google_slides_get_presentation",
    label: "Get Presentation",
    description: "Get metadata and structure of a Google Slides presentation.",
    underlyingTool: "get_presentation",
    parameters: obj(PRESENTATION_ID_PARAM, ["presentation_id"]),
  },
  {
    piToolName: "google_slides_list_comments",
    label: "List Presentation Comments",
    description: "List comments on a Google Slides presentation.",
    underlyingTool: "list_presentation_comments",
    parameters: obj(PRESENTATION_ID_PARAM, ["presentation_id"]),
  },

  // ─── Calendar ───
  {
    piToolName: "google_calendar_get_events",
    label: "Get Calendar Events",
    description:
      "Get calendar events. Supports date='today'/'tomorrow'/YYYY-MM-DD for quick lookups.",
    underlyingTool: "get_events",
    parameters: obj({
      calendar_id: { type: "string", description: "Calendar ID. Default: primary." },
      date: { type: "string", description: "Convenience date: today, tomorrow, or YYYY-MM-DD." },
      time_min: { type: "string", description: "Explicit start boundary (RFC-3339)." },
      time_max: { type: "string", description: "Explicit end boundary (RFC-3339)." },
      query: { type: "string", description: "Free-text event search." },
      max_results: { type: "number", description: "Max events to return. Default 25." },
      detailed: {
        type: "boolean",
        description: "Include full descriptions/attendees. Default false.",
      },
      include_attachments: {
        type: "boolean",
        description: "Include attachment info. Default false.",
      },
    }),
    mapArgs(params) {
      return buildCalendarEventsArgs(params as CalendarGetEventsParams);
    },
  },
  {
    piToolName: "google_calendar_list_calendars",
    label: "List Calendars",
    description: "List all calendars accessible to the authenticated user.",
    underlyingTool: "list_calendars",
    parameters: obj({}),
  },
  {
    piToolName: "google_calendar_query_freebusy",
    label: "Query Free/Busy",
    description: "Check if calendars are free/busy in a time range; use for 'am I free' questions.",
    underlyingTool: "query_freebusy",
    parameters: obj({
      time_min: { type: "string", description: "Start of range (RFC-3339)." },
      time_max: { type: "string", description: "End of range (RFC-3339)." },
      date: { type: "string", description: "Convenience date: today, tomorrow, or YYYY-MM-DD." },
      start_time: { type: "string", description: "Local start time with date, e.g. 1pm or 13:00." },
      end_time: { type: "string", description: "Local end time with date, e.g. 2pm or 14:00." },
      calendar_ids: {
        type: "array",
        items: { type: "string" },
        description: "Calendar IDs to check.",
      },
    }),
    mapArgs(params) {
      return buildCalendarFreeBusyArgs(params as CalendarFreeBusyParams);
    },
  },

  // ─── Gmail ───
  {
    piToolName: "google_gmail_get_attachment_content",
    label: "Get Gmail Attachment",
    description: "Get the content of a Gmail message attachment.",
    underlyingTool: "get_gmail_attachment_content",
    parameters: obj(
      {
        message_id: { type: "string", description: "Gmail message ID." },
        attachment_id: { type: "string", description: "Attachment ID." },
      },
      ["message_id", "attachment_id"],
    ),
  },
  {
    piToolName: "google_gmail_get_message",
    label: "Get Gmail Message",
    description: "Get the content of a specific Gmail message.",
    underlyingTool: "get_gmail_message_content",
    parameters: obj(
      {
        message_id: { type: "string", description: "Gmail message ID." },
      },
      ["message_id"],
    ),
  },
  {
    piToolName: "google_gmail_get_messages_batch",
    label: "Get Gmail Messages Batch",
    description: "Get content of multiple Gmail messages by ID.",
    underlyingTool: "get_gmail_messages_content_batch",
    parameters: obj(
      {
        message_ids: {
          type: "array",
          items: { type: "string" },
          description: "Gmail message IDs.",
        },
      },
      ["message_ids"],
    ),
  },
  {
    piToolName: "google_gmail_get_thread",
    label: "Get Gmail Thread",
    description: "Get all messages in a Gmail thread.",
    underlyingTool: "get_gmail_thread_content",
    parameters: obj(
      {
        thread_id: { type: "string", description: "Gmail thread ID." },
      },
      ["thread_id"],
    ),
  },
  {
    piToolName: "google_gmail_get_threads_batch",
    label: "Get Gmail Threads Batch",
    description: "Get multiple Gmail threads by ID.",
    underlyingTool: "get_gmail_threads_content_batch",
    parameters: obj(
      {
        thread_ids: { type: "array", items: { type: "string" }, description: "Gmail thread IDs." },
      },
      ["thread_ids"],
    ),
  },
  {
    piToolName: "google_gmail_list_filters",
    label: "List Gmail Filters",
    description: "List Gmail filters for the authenticated user.",
    underlyingTool: "list_gmail_filters",
    parameters: obj({}),
  },
  {
    piToolName: "google_gmail_list_labels",
    label: "List Gmail Labels",
    description: "List Gmail labels for the authenticated user.",
    underlyingTool: "list_gmail_labels",
    parameters: obj({}),
  },
  {
    piToolName: "google_gmail_search_messages",
    label: "Search Gmail",
    description: "Search Gmail messages using Gmail search syntax.",
    underlyingTool: "search_gmail_messages",
    parameters: obj(
      {
        query: {
          type: "string",
          description: "Gmail search query (same syntax as Gmail search bar).",
        },
        page_size: { type: "number", description: "Max messages to return. Default 10." },
        page_token: { type: "string", description: "Pagination token." },
        max_results: { type: "number", description: "Alias for page_size." },
        limit: { type: "number", description: "Alias for page_size." },
      },
      ["query"],
    ),
    mapArgs(params) {
      const out: Record<string, unknown> = { query: params.query };
      const pageSize = params.page_size ?? params.max_results ?? params.limit;
      if (pageSize != null) out.page_size = pageSize;
      if (params.page_token) out.page_token = params.page_token;
      return out;
    },
  },
];

/**
 * Deferred wrappers: useful future code, intentionally not registered today.
 * Forms and Tasks are not needed for the first sf-google-workspace cut.
 */
export const DEFERRED_READ_WRAPPER_SPECS: readonly ReadWrapperSpec[] = [
  // ─── Forms ───
  {
    piToolName: "google_forms_get_form",
    label: "Get Form",
    description: "Get the structure and questions of a Google Form.",
    underlyingTool: "get_form",
    parameters: obj(
      {
        form_id: { type: "string", description: "Google Form ID." },
      },
      ["form_id"],
    ),
  },
  {
    piToolName: "google_forms_get_response",
    label: "Get Form Response",
    description: "Get a specific response to a Google Form.",
    underlyingTool: "get_form_response",
    parameters: obj(
      {
        form_id: { type: "string", description: "Google Form ID." },
        response_id: { type: "string", description: "Form response ID." },
      },
      ["form_id", "response_id"],
    ),
  },
  {
    piToolName: "google_forms_list_responses",
    label: "List Form Responses",
    description: "List all responses to a Google Form.",
    underlyingTool: "list_form_responses",
    parameters: obj(
      {
        form_id: { type: "string", description: "Google Form ID." },
      },
      ["form_id"],
    ),
  },

  // ─── Tasks ───
  {
    piToolName: "google_tasks_get_task",
    label: "Get Task",
    description: "Get a specific task by ID.",
    underlyingTool: "get_task",
    parameters: obj(
      {
        task_list_id: { type: "string", description: "Task list ID." },
        task_id: { type: "string", description: "Task ID." },
      },
      ["task_list_id", "task_id"],
    ),
  },
  {
    piToolName: "google_tasks_get_task_list",
    label: "Get Task List",
    description: "Get metadata for a specific task list.",
    underlyingTool: "get_task_list",
    parameters: obj(
      {
        task_list_id: { type: "string", description: "Task list ID." },
      },
      ["task_list_id"],
    ),
  },
  {
    piToolName: "google_tasks_list_task_lists",
    label: "List Task Lists",
    description: "List all task lists for the authenticated user.",
    underlyingTool: "list_task_lists",
    parameters: obj({}),
  },
  {
    piToolName: "google_tasks_list_tasks",
    label: "List Tasks",
    description: "List tasks in a task list.",
    underlyingTool: "list_tasks",
    parameters: obj(
      {
        task_list_id: { type: "string", description: "Task list ID." },
      },
      ["task_list_id"],
    ),
  },
];

// ─── Lookup helpers ──────────────────────────────────────────────────────────

const _byPiName = new Map<string, ReadWrapperSpec>();
const _byUnderlying = new Map<string, ReadWrapperSpec>();

for (const spec of READ_WRAPPER_SPECS) {
  _byPiName.set(spec.piToolName, spec);
  _byUnderlying.set(spec.underlyingTool, spec);
}

/** Get a wrapper spec by its Pi tool name. */
export function getWrapperByPiName(piToolName: string): ReadWrapperSpec | undefined {
  return _byPiName.get(piToolName);
}

/** Get a wrapper spec by its underlying MCP tool name. */
export function getWrapperByUnderlying(mcpToolName: string): ReadWrapperSpec | undefined {
  return _byUnderlying.get(mcpToolName);
}

/** All Pi tool names from the wrapper registry. */
export function getAllWrapperPiNames(): string[] {
  return READ_WRAPPER_SPECS.map((s) => s.piToolName);
}

/** All underlying MCP tool names covered by wrappers. */
export function getAllWrapperUnderlyingNames(): string[] {
  return READ_WRAPPER_SPECS.map((s) => s.underlyingTool);
}

// Re-export the type for external use
export type { ReadMcpToolName };
