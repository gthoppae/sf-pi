/* SPDX-License-Identifier: Apache-2.0 */
import { test, assert } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFERRED_READ_WRAPPER_SPECS,
  READ_WRAPPER_SPECS,
  getAllWrapperPiNames,
  getAllWrapperUnderlyingNames,
  getWrapperByPiName,
  getWrapperByUnderlying,
} from "../lib/read-wrappers.ts";
import { READ_MCP_TOOLS } from "../lib/read-tools.ts";
import {
  buildCalendarEventsArgs,
  buildCalendarFreeBusyArgs,
  resolveDateBoundaries,
} from "../lib/calendar.ts";
import { parseSizeBytes, formatSizeLabel } from "../lib/drive.ts";

// ─── Wrapper registry integrity ──────────────────────────────────────────────

test("READ_WRAPPER_SPECS covers all read allowlist tools except search_drive_files", () => {
  const coveredByWrappers = new Set(getAllWrapperUnderlyingNames());
  for (const tool of READ_MCP_TOOLS) {
    if (tool === "search_drive_files") continue; // covered by existing google_drive_search
    assert.ok(coveredByWrappers.has(tool), `Missing wrapper for read tool: ${tool}`);
  }
});

test("Every wrapper underlying tool is in the read allowlist", () => {
  for (const spec of READ_WRAPPER_SPECS) {
    assert.ok(
      READ_MCP_TOOLS.has(spec.underlyingTool),
      `Wrapper "${spec.piToolName}" references non-allowlisted tool: ${spec.underlyingTool}`,
    );
  }
});

test("No duplicate Pi tool names in wrapper registry", () => {
  const names = getAllWrapperPiNames();
  const unique = new Set(names);
  assert.equal(names.length, unique.size, "Duplicate Pi tool names found");
});

test("No duplicate underlying tool names in wrapper registry", () => {
  const names = getAllWrapperUnderlyingNames();
  const unique = new Set(names);
  assert.equal(names.length, unique.size, "Duplicate underlying tool names found");
});

test("READ_WRAPPER_SPECS has exactly 32 entries (33 active read tools minus search_drive_files)", () => {
  assert.equal(READ_WRAPPER_SPECS.length, 32);
});

test("DEFERRED_READ_WRAPPER_SPECS keeps Forms and Tasks wrappers out of active registration", () => {
  assert.equal(DEFERRED_READ_WRAPPER_SPECS.length, 7);
  assert.ok(
    DEFERRED_READ_WRAPPER_SPECS.some((spec) => spec.piToolName === "google_forms_get_form"),
  );
  assert.ok(
    DEFERRED_READ_WRAPPER_SPECS.some((spec) => spec.piToolName === "google_tasks_list_tasks"),
  );
  assert.equal(getWrapperByPiName("google_forms_get_form"), undefined);
  assert.equal(getWrapperByPiName("google_tasks_list_tasks"), undefined);
});

test("getWrapperByPiName finds calendar wrapper", () => {
  const spec = getWrapperByPiName("google_calendar_get_events");
  assert.ok(spec);
  assert.equal(spec.underlyingTool, "get_events");
});

test("getWrapperByUnderlying finds docs wrapper", () => {
  const spec = getWrapperByUnderlying("get_doc_as_markdown");
  assert.ok(spec);
  assert.equal(spec.piToolName, "google_docs_get_as_markdown");
});

test("getWrapperByPiName returns undefined for unknown name", () => {
  assert.equal(getWrapperByPiName("nonexistent"), undefined);
});

test("Every wrapper has a non-empty description under 120 chars", () => {
  for (const spec of READ_WRAPPER_SPECS) {
    assert.ok(spec.description.length > 0, `${spec.piToolName} has empty description`);
    assert.ok(
      spec.description.length <= 120,
      `${spec.piToolName} description too long (${spec.description.length} chars)`,
    );
  }
});

test("Every wrapper has valid JSON Schema parameters", () => {
  for (const spec of READ_WRAPPER_SPECS) {
    const params = spec.parameters as Record<string, unknown>;
    assert.equal(params.type, "object", `${spec.piToolName} parameters.type must be object`);
    assert.ok("properties" in params, `${spec.piToolName} must have properties`);
  }
});

// ─── Calendar date resolution ────────────────────────────────────────────────

test("resolveDateBoundaries: today computes full local day", () => {
  const now = new Date(2026, 5, 4, 14, 30, 0); // June 4, 2026 14:30
  const result = resolveDateBoundaries("today", now);
  assert.ok(result.time_min);
  assert.ok(result.time_max);
  assert.ok(result.time_min.startsWith("2026-06-04T00:00:00"));
  assert.ok(result.time_max.startsWith("2026-06-05T00:00:00"));
});

test("resolveDateBoundaries: tomorrow computes next day", () => {
  const now = new Date(2026, 5, 4, 14, 30, 0); // June 4, 2026
  const result = resolveDateBoundaries("tomorrow", now);
  assert.ok(result.time_min);
  assert.ok(result.time_max);
  assert.ok(result.time_min.startsWith("2026-06-05T00:00:00"));
  assert.ok(result.time_max.startsWith("2026-06-06T00:00:00"));
});

test("resolveDateBoundaries: YYYY-MM-DD computes that specific day", () => {
  const now = new Date(2026, 0, 1);
  const result = resolveDateBoundaries("2026-03-15", now);
  assert.ok(result.time_min);
  assert.ok(result.time_max);
  assert.ok(result.time_min.startsWith("2026-03-15T00:00:00"));
  assert.ok(result.time_max.startsWith("2026-03-16T00:00:00"));
});

test("resolveDateBoundaries: undefined returns empty object", () => {
  const result = resolveDateBoundaries(undefined);
  assert.deepEqual(result, {});
});

test("resolveDateBoundaries: invalid date returns empty object", () => {
  assert.deepEqual(resolveDateBoundaries("not-a-date"), {});
  assert.deepEqual(resolveDateBoundaries("2026-13-45"), {});
});

test("resolveDateBoundaries: case insensitive", () => {
  const now = new Date(2026, 5, 4, 14, 30, 0);
  const result = resolveDateBoundaries("TODAY", now);
  assert.ok(result.time_min);
  assert.ok(result.time_min.startsWith("2026-06-04"));
});

// ─── Calendar args builder ───────────────────────────────────────────────────

test("buildCalendarEventsArgs maps date=tomorrow with defaults", () => {
  const now = new Date(2026, 5, 4, 10, 0, 0);
  const args = buildCalendarEventsArgs({ date: "tomorrow" }, now);
  assert.ok((args.time_min as string).startsWith("2026-06-05"));
  assert.ok((args.time_max as string).startsWith("2026-06-06"));
  assert.equal(args.detailed, undefined); // not set when not provided
  assert.equal(args.calendar_id, undefined);
});

test("buildCalendarEventsArgs passes explicit time_min/time_max over date", () => {
  const args = buildCalendarEventsArgs({
    date: "today",
    time_min: "2026-06-04T08:00:00Z",
    time_max: "2026-06-04T17:00:00Z",
  });
  assert.equal(args.time_min, "2026-06-04T08:00:00Z");
  assert.equal(args.time_max, "2026-06-04T17:00:00Z");
});

test("buildCalendarEventsArgs includes calendar_id and query when provided", () => {
  const args = buildCalendarEventsArgs({
    calendar_id: "work@example.com",
    query: "standup",
    max_results: 10,
    detailed: true,
  });
  assert.equal(args.calendar_id, "work@example.com");
  assert.equal(args.query, "standup");
  assert.equal(args.max_results, 10);
  assert.equal(args.detailed, true);
});

test("buildCalendarEventsArgs with no params returns empty object", () => {
  const args = buildCalendarEventsArgs({});
  assert.deepEqual(args, {});
});

test("buildCalendarFreeBusyArgs maps date and local times", () => {
  const now = new Date(2026, 5, 4, 10, 0, 0);
  const args = buildCalendarFreeBusyArgs(
    { date: "tomorrow", start_time: "1pm", end_time: "2pm" },
    now,
  );
  assert.ok((args.time_min as string).startsWith("2026-06-05T13:00:00"));
  assert.ok((args.time_max as string).startsWith("2026-06-05T14:00:00"));
});

test("buildCalendarFreeBusyArgs prefers explicit time_min/time_max", () => {
  const args = buildCalendarFreeBusyArgs({
    date: "tomorrow",
    start_time: "1pm",
    end_time: "2pm",
    time_min: "2026-06-05T12:00:00Z",
    time_max: "2026-06-05T13:00:00Z",
  });
  assert.equal(args.time_min, "2026-06-05T12:00:00Z");
  assert.equal(args.time_max, "2026-06-05T13:00:00Z");
});

// ─── Calendar wrapper mapArgs integration ────────────────────────────────────

test("google_calendar_get_events wrapper has mapArgs that uses buildCalendarEventsArgs", () => {
  const spec = getWrapperByPiName("google_calendar_get_events");
  assert.ok(spec);
  assert.ok(spec.mapArgs);
  const result = spec.mapArgs({ date: "tomorrow", detailed: false });
  assert.ok(result.time_min);
  assert.ok(result.time_max);
  assert.equal(result.detailed, false);
});

// ─── Drive file-size formatting ──────────────────────────────────────────────

test("parseSizeBytes parses numeric string", () => {
  assert.equal(parseSizeBytes("114257101"), 114257101);
  assert.equal(parseSizeBytes("0"), 0);
  assert.equal(parseSizeBytes("6510"), 6510);
});

test("parseSizeBytes returns null for non-numeric", () => {
  assert.equal(parseSizeBytes(null), null);
  assert.equal(parseSizeBytes("unknown"), null);
  assert.equal(parseSizeBytes(""), null);
});

test("formatSizeLabel formats bytes correctly", () => {
  assert.equal(formatSizeLabel(0), "0 B");
  assert.equal(formatSizeLabel(1023), "1023 B");
  assert.equal(formatSizeLabel(1024), "1.00 KB");
  assert.equal(formatSizeLabel(6510), "6.36 KB");
  assert.equal(formatSizeLabel(114257101), "109.0 MB");
  assert.equal(formatSizeLabel(1073741824), "1.00 GB");
});

test("formatSizeLabel returns null for null input", () => {
  assert.equal(formatSizeLabel(null), null);
});

// ─── Drive search result includes size ───────────────────────────────────────

test("parseDriveSearchText populates sizeBytes and sizeLabel", async () => {
  const { parseDriveSearchText } = await import("../lib/drive.ts");
  const sample = `Found 1 file:
- Name: "Big File" (ID: abc123, Type: application/pdf, Size: 114257101, Modified: 2026-05-27T09:16:31.561Z) Link: https://example.com/file`;
  const result = parseDriveSearchText("test", sample);
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0]?.sizeBytes, 114257101);
  assert.equal(result.files[0]?.sizeLabel, "109.0 MB");
});

test("formatDriveSearchResult includes Size line when available", async () => {
  const { formatDriveSearchResult, parseDriveSearchText } = await import("../lib/drive.ts");
  const sample = `Found 1 file:
- Name: "Doc" (ID: abc, Type: text/plain, Size: 6510, Modified: 2026-01-01T00:00:00Z) Link: https://example.com`;
  const result = formatDriveSearchResult(parseDriveSearchText("test", sample));
  assert.ok(result.includes("Size: 6.36 KB"));
});

// ─── Skill file existence and content ────────────────────────────────────────

test("sf-google-workspace-guidance skill file exists under extension-owned skills", () => {
  const skillPath = join(
    import.meta.dirname,
    "..",
    "skills",
    "sf-google-workspace-guidance",
    "SKILL.md",
  );
  assert.ok(existsSync(skillPath), `Skill file not found at ${skillPath}`);
});

test("sf-google-workspace-guidance skill includes key routing rules", () => {
  const skillPath = join(
    import.meta.dirname,
    "..",
    "skills",
    "sf-google-workspace-guidance",
    "SKILL.md",
  );
  const content = readFileSync(skillPath, "utf8");
  assert.ok(
    content.includes("description:"),
    "Skill frontmatter should include required description",
  );
  assert.ok(
    content.includes("Progressive disclosure workflow"),
    "Should explain progressive disclosure",
  );
  assert.ok(content.includes("google_calendar_get_events"), "Should mention calendar wrapper");
  assert.ok(content.includes("google_drive_search"), "Should mention drive search");
  assert.ok(content.includes("google_workspace_read_tool_search"), "Should mention read facade");
  assert.ok(
    content.includes("Do **not** use Slack tools"),
    "Should warn against Slack for calendar",
  );
  assert.ok(content.includes("include_schema"), "Should warn against broad schema fetching");
  assert.ok(content.includes('date="tomorrow"'), "Should show date convenience example");
});
