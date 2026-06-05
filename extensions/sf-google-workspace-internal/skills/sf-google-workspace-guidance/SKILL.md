---
name: sf-google-workspace-guidance
description: >
  Guides models to use sf-google-workspace for Google Workspace requests,
  especially calendar/day/schedule questions like "how does my calendar look
  tomorrow", Drive file search, and reading Docs, Sheets, Slides, and Gmail.
  Prefer first-class read wrappers and progressive disclosure to avoid MCP
  schema/context bloat.
license: MIT
metadata:
  version: "0.1.0"
  source_extension: sf-google-workspace
---

# sf-google-workspace-guidance

Use when the user asks about Google Workspace content through sf-pi: Drive files, Docs, Sheets, Slides, Calendar, or Gmail.

This skill intentionally has a different name from the `sf-google-workspace` extension/command to avoid slash-command or resource-name ambiguity.

## Progressive disclosure workflow

Use the smallest tool/context surface that can answer the request:

1. **First-class wrapper** — direct and cheapest. Use wrappers such as `google_calendar_get_events`, `google_drive_search`, `google_docs_get_as_markdown`, `google_sheets_read_values`, or `google_slides_get_presentation` when they fit.
2. **Compact read facade** — when no wrapper fits. Search compactly, describe exactly one tool, then call it:
   ```text
   google_workspace_read_tool_search      # no schemas by default
   → google_workspace_read_tool_describe  # one selected read tool schema
   → google_workspace_read_tool_call      # execute that read tool
   ```
3. **Full catalog escape hatch** — only for debugging or missing read-facade coverage: `google_workspace_tool_search` / `google_workspace_call`.

## Anti-bloat rules

- Do **not** use `include_schema=true` on broad searches. Use `google_workspace_read_tool_describe` for one tool at a time.
- Do **not** use Slack tools (`slack_time_range`) for Google Calendar date ranges. The calendar wrapper handles `date="today"` / `date="tomorrow"` natively.
- Do **not** call `google_workspace_tool_search` when a first-class wrapper exists.
- Keep calendar and Drive overview calls compact first; fetch detailed descriptions, attendees, attachments, or full document bodies only when the user asks.

## Common requests → preferred tools

| User intent                           | Preferred tool                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| “How does my calendar look tomorrow?” | `google_calendar_get_events date="tomorrow"`                                           |
| “Find Drive files about X”            | `google_drive_search query="X"`                                                        |
| “Read this Google Doc”                | `google_docs_get_as_markdown` first, `google_docs_get_content` if plain text is needed |
| “Read this Sheet range”               | `google_sheets_read_values`                                                            |
| “Summarize this deck structure”       | `google_slides_get_presentation`                                                       |
| “Search Gmail for X”                  | `google_gmail_search_messages query="X"`                                               |

## Calendar guidance

For calendar overview questions, use:

```text
google_calendar_get_events date="tomorrow"
```

- `date` accepts: `today`, `tomorrow`, or `YYYY-MM-DD`.
- Default `detailed=false` returns compact time+title output.
- Only pass `detailed=true` when the user asks for attendees, descriptions, attachments, or full event details.
- For explicit time ranges, use `time_min` / `time_max` (RFC-3339) instead of `date`.

## Drive guidance

For file discovery, always prefer:

```text
google_drive_search query="..."
```

It formats results compactly with type, size, and modification date. Use `file_type` for filtering (`folder`, `doc`, `sheet`, `slides`, `pdf`).

## Service-specific read guidance

- Docs: `google_docs_get_as_markdown` for formatted Markdown; `google_docs_get_content` for plain content; `google_docs_inspect_structure` only when structure/indexes matter.
- Sheets: `google_sheets_read_values` with A1 notation range; `google_sheets_get_info` to discover sheet names.
- Slides: `google_slides_get_presentation` for deck structure; `google_slides_get_page` / `google_slides_get_page_thumbnail` for one slide.
- Gmail: use read-only tools only (`google_gmail_search_messages`, `google_gmail_get_message`, `google_gmail_get_thread`). Treat mailbox content as sensitive.
- Forms/Tasks: intentionally not exposed in the first extension cut; use the full catalog only if explicitly debugging or extending the integration.

## Auth issues

Do not call `google_workspace_status` before routine reads. Use it only when auth/setup is uncertain or after a Google Workspace tool fails with an auth/bridge error:

```text
google_workspace_status
```

If auth is missing in the x86/container setup, tell the user to run:

```bash
keyring-setup
~/.mcp-adaptor/bin/mcp-adaptor auth
~/.mcp-adaptor/bin/mcp-adaptor auth --provider google-workspace-readonly --env prod
```

For Salesforce-managed macOS installs, users usually only need the `mcp-adaptor auth` commands; no container keyring setup is required.
