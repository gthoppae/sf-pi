---
title: "SF Google Workspace Internal"
description: "Let agents read Salesforce-internal Google Workspace through mcp-adaptor without dumping the full MCP catalog into context."
---

# SF Google Workspace Internal

<p class="sfpi-page-lead">Let agents read Salesforce-internal Google Workspace through mcp-adaptor without dumping the full MCP catalog into context.</p>

<div class="sfpi-action-card"><span>Best for</span><strong>Google Drive, Calendar, Gmail, Docs, Sheets, and Slides reads</strong><p>Let agents read Salesforce-internal Google Workspace through mcp-adaptor without dumping the full MCP catalog into context.</p></div>

## Why you'll use it

<div class="sfpi-benefit-grid">
<div class="sfpi-benefit-card">Uses Salesforce mcp-adaptor and DX MCP Gateway instead of direct Google OAuth handling.</div>
<div class="sfpi-benefit-card">Keeps the model prompt compact with first-class wrappers and read-only progressive disclosure.</div>
<div class="sfpi-benefit-card">Provides a standard sf-pi panel and manager config screen for setup and status checks.</div>
</div>

## Try it first

Open the Google Workspace panel

```text
/sf-google-workspace
```

You can also manage this extension from the SF Pi home base:

```text
/sf-pi status sf-google-workspace-internal
/sf-pi enable sf-google-workspace-internal
/sf-pi disable sf-google-workspace-internal
```

## Common use cases

- Check tomorrow's calendar or query free/busy availability.
- Search Drive files, list Sheets, or read known Docs/Slides by ID.
- Search Gmail messages or inspect labels using read-only tools.
- Discover one Google Workspace read tool schema without loading the full MCP catalog.

## What you get

- First-class read wrappers for Drive, Docs, Sheets, Slides, Calendar, and Gmail.
- Curated read-tool search/describe/call helpers with write-like tools excluded.
- A full MCP catalog escape hatch guarded by write-name checks for development/debugging.

## Safety notes

- Uses Salesforce mcp-adaptor auth path; Google OAuth tokens are not exposed or stored by the extension.
- First-class wrappers are read-only; Forms/Tasks are deferred; generic write-like calls are blocked unless GWS_ALLOW_MCP_WRITE=true.
- Skill guidance is extension-owned and should be contributed only while the extension is enabled.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-google-workspace-internal`
- **Category:** Agent Tool
- **Maturity:** experimental
- **Default state:** opt-in
- **Commands:** `/sf-google-workspace`
- **LLM tools:** `google_workspace_status`, `google_drive_search`, `google_workspace_read_tool_search`, `google_workspace_read_tool_describe`, `google_workspace_read_tool_call`, `google_workspace_tool_search`, `google_workspace_call`, `google_drive_check_public_access`, `google_drive_get_file_content`, `google_drive_get_file_download_url`, `google_drive_get_file_permissions`, `google_drive_get_shareable_link`, `google_drive_list_docs_in_folder`, `google_drive_list_items`, `google_drive_list_spreadsheets`, `google_drive_search_docs`, `google_docs_debug_table_structure`, `google_docs_get_as_markdown`, `google_docs_get_content`, `google_docs_inspect_structure`, `google_docs_list_comments`, `google_sheets_get_info`, `google_sheets_list_comments`, `google_sheets_read_values`, `google_slides_get_page`, `google_slides_get_page_thumbnail`, `google_slides_get_presentation`, `google_slides_list_comments`, `google_calendar_get_events`, `google_calendar_list_calendars`, `google_calendar_query_freebusy`, `google_gmail_get_attachment_content`, `google_gmail_get_message`, `google_gmail_get_messages_batch`, `google_gmail_get_thread`, `google_gmail_get_threads_batch`, `google_gmail_list_filters`, `google_gmail_list_labels`, `google_gmail_search_messages`
- **Providers:** _none_
- **Events/hooks:** `session_start`, `session_shutdown`, `resources_discover`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-google-workspace-internal/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-google-workspace-internal)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-google-workspace-internal/README.md#troubleshooting) for extension-specific recovery steps.
