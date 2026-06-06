# SF Google Workspace Internal

Salesforce-internal Google Workspace tools for Pi and SF Pi, backed by Salesforce `mcp-adaptor`.

This extension intentionally exposes a small, first-class Pi tool surface instead of registering the full Google Workspace MCP catalog in the model context. It uses `mcp-adaptor` only as a private transport:

```text
Pi native tool -> mcp-adaptor serve --server google_workspace -> Salesforce DX MCP Gateway -> Google Workspace APIs
```

## Who can use this

This source is public, but the default transport requires Salesforce-internal `mcp-adaptor` / DX MCP Gateway access and an authenticated Salesforce Google Workspace provider. Non-Salesforce users can read the implementation pattern, but the tools will not function unless they provide a compatible `mcp-adaptor` endpoint.

The extension is `defaultEnabled: false`; enable it explicitly when you have access:

```text
/sf-pi enable sf-google-workspace-internal
/reload
```

## What It Does

SF Google Workspace Internal gives agents a compact, Salesforce-approved path to read Google Workspace data. It keeps direct Google OAuth out of the extension and delegates auth/transport to Salesforce `mcp-adaptor`, then exposes native Pi tools for the common read flows agents need most.

It is not a general MCP host, not a direct Google OAuth client, and not a broad write surface. The default workflow is:

- use first-class read wrappers for Calendar, Drive, Docs, Sheets, Slides, and Gmail;
- use compact read-tool search/describe/call only when a wrapper is not enough;
- use the full MCP catalog escape hatch only for debugging or deliberate extension development.

## Runtime Flow

```text
Extension loads
  ├─ registers /sf-google-workspace
  ├─ does not start mcp-adaptor on the boot path
  └─ waits for enablement/session events before registering tools

session_start / resources_discover when enabled
  ├─ registers compact native Google Workspace tools
  └─ contributes skills/sf-google-workspace-guidance

/sf-google-workspace
  ├─ opens the standard sf-pi command panel
  ├─ offers status, compact read-tool list, full-catalog sample, help, close
  └─ includes the shared lifecycle toggle row

Google Workspace tool call
  ├─ default: spawns ~/.mcp-adaptor/bin/mcp-adaptor for one MCP request
  ├─ optional: GWS_MCP_KEEPALIVE=1 lazily starts one reusable bridge process
  ├─ sends an MCP tools/list or tools/call request
  ├─ sanitizes returned content before surfacing it to the model
  └─ bounds visible output to avoid context bloat
```

## Tools

Core/status and discovery:

- `google_workspace_status`
- `google_workspace_read_tool_search`
- `google_workspace_read_tool_describe`
- `google_workspace_read_tool_call`
- `google_workspace_tool_search` (full catalog escape hatch)
- `google_workspace_call` (full catalog escape hatch, write-name guarded)

Registered first-class wrappers:

- `google_drive_check_public_access`
- `google_drive_get_file_content`
- `google_drive_get_file_download_url`
- `google_drive_get_file_permissions`
- `google_drive_get_shareable_link`
- `google_drive_list_docs_in_folder`
- `google_drive_list_items`
- `google_drive_list_spreadsheets`
- `google_drive_search_docs`
- `google_docs_debug_table_structure`
- `google_docs_get_as_markdown`
- `google_docs_get_content`
- `google_docs_inspect_structure`
- `google_docs_list_comments`
- `google_sheets_get_info`
- `google_sheets_list_comments`
- `google_sheets_read_values`
- `google_slides_get_page`
- `google_slides_get_page_thumbnail`
- `google_slides_get_presentation`
- `google_slides_list_comments`
- `google_calendar_get_events`
- `google_calendar_list_calendars`
- `google_calendar_query_freebusy`
- `google_gmail_get_attachment_content`
- `google_gmail_get_message`
- `google_gmail_get_messages_batch`
- `google_gmail_get_thread`
- `google_gmail_get_threads_batch`
- `google_gmail_list_filters`
- `google_gmail_list_labels`
- `google_gmail_search_messages`

First-class read wrappers cover Drive, Docs, Sheets, Slides, Calendar, and Gmail read operations. Forms and Tasks wrappers are intentionally deferred in code but not registered in the first cut.

## Prerequisites

On a Salesforce-managed macOS setup with DevBar / AI Marketplace installed:

```bash
~/.mcp-adaptor/bin/mcp-adaptor auth
~/.mcp-adaptor/bin/mcp-adaptor auth --provider google-workspace-readonly --env prod
~/.mcp-adaptor/bin/mcp-adaptor auth --validate
```

For read/write experimentation, authenticate `google-workspace-rw`, but this extension currently exposes only read wrappers by default. Generic write-like calls are blocked unless `GWS_ALLOW_MCP_WRITE=true`.

Optional performance mode:

```bash
GWS_MCP_KEEPALIVE=1              # lazily reuse one mcp-adaptor process per Pi session
GWS_MCP_KEEPALIVE_IDLE_MS=300000 # idle shutdown timeout; default 5 minutes
```

Keepalive mode does not add MCP schemas to the model prompt. It only reuses the hidden stdio bridge after the first Google Workspace tool call and is cleaned up on session shutdown/reload.

## Keepalive vs. host-native MCP

`GWS_MCP_KEEPALIVE=1` is a transport optimization inside this extension. It is intentionally **not** the same as configuring Pi, Claude Code, or another host as a general MCP client for Google Workspace.

| Aspect              | This extension with keepalive                                                                 | Host-native MCP client                                                      |
| ------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| User setup          | No visible MCP server config; uses Salesforce `mcp-adaptor` path                              | User/host config points directly at an MCP server                           |
| Model-visible tools | Compact native Pi wrappers only                                                               | Usually every MCP tool/schema is exposed to the host/model                  |
| Context impact      | No full Google Workspace MCP catalog in the prompt                                            | Can add broad tool/schema context unless the host filters it                |
| Process lifecycle   | One hidden `mcp-adaptor serve --server google_workspace` process, lazy + idle-timeout cleanup | Host owns MCP server lifecycle and reconnect behavior                       |
| Security boundary   | Google auth remains owned by `mcp-adaptor`/keyring; extension never sees OAuth tokens         | Depends on host MCP config and server implementation                        |
| Write surface       | Read wrappers by default; generic write-like calls are guarded                                | Whatever MCP tools the host exposes are callable unless separately filtered |

So keepalive improves latency by avoiding repeated `mcp-adaptor` spawn/init work, while preserving the extension's main design goal: Google Workspace remains a **hidden Salesforce transport**, and the agent still sees a small, curated Pi tool surface.

## Command panel

Run without arguments to open the standard SF Pi command panel:

```text
/sf-google-workspace
```

Useful explicit commands:

```text
/sf-google-workspace status
/sf-google-workspace read-tools
/sf-google-workspace tools
/sf-google-workspace help
```

The panel includes the standard lifecycle toggle row and uses `openInfoPanel` for status/help details.

## Config panel

`manifest.json` sets `configurable: true`, so the SF Pi manager can open a read-only config/status panel. The panel shows:

- whether the extension is enabled for the active scope
- resolved `mcp-adaptor` path, server, timeout, and transport mode
- active/deferred read-wrapper counts
- setup commands
- safety invariants

## Usage examples

```text
how does my day look like tomorrow in my calendar?
find Drive files matching headless 360, limit 5
what read-only Google Workspace calendar tools are available?
```

## Context-bloat strategy

Use the smallest context surface that can answer the request:

1. First-class wrappers (`google_calendar_get_events`, `google_drive_search`, etc.).
2. Read facade: search compactly -> describe exactly one tool -> call.
3. Full catalog escape hatch only for debugging or extension development.

## Behavior Matrix

| Event/Trigger          | Condition                 | Result                                                       |
| ---------------------- | ------------------------- | ------------------------------------------------------------ |
| extension load         | pi version supported      | Register `/sf-google-workspace`; no mcp-adaptor call         |
| `session_start`        | extension enabled         | Register compact Google Workspace tools                      |
| `resources_discover`   | extension enabled         | Contribute `sf-google-workspace-guidance` skill              |
| `/sf-google-workspace` | no args + interactive TUI | Open standard command panel with status/help/lifecycle rows  |
| `/sf-google-workspace` | no args + headless        | Show mcp-adaptor status                                      |
| `status`               | explicit                  | Validate mcp-adaptor auth and list tool count if auth passes |
| `read-tools`           | explicit                  | Copy compact read allowlist to editor                        |
| `tools`                | explicit                  | Copy bounded full-catalog sample to editor for debugging     |

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-google-workspace-internal/
  lib/
    calendar.ts             ← implementation module
    config-panel.ts         ← implementation module
    drive.ts                ← implementation module
    mcp.ts                  ← implementation module
    read-tools.ts           ← implementation module
    read-wrappers.ts        ← implementation module
    security.ts             ← implementation module
  tests/
    config-panel.test.ts    ← unit / smoke test
    drive.test.ts           ← unit / smoke test
    mcp.test.ts             ← unit / smoke test
    read-tools-describe.test.ts← unit / smoke test
    read-tools-smoke.test.ts← unit / smoke test
    read-tools.test.ts      ← unit / smoke test
    read-wrappers.test.ts   ← unit / smoke test
    security.test.ts        ← unit / smoke test
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
```

<!-- GENERATED:file-structure:end -->

## Safety

- Google OAuth tokens are owned by Salesforce `mcp-adaptor` and the OS keyring, not this extension.
- The default model path is read-only: first-class wrappers plus curated read-tool search/describe/call.
- The full catalog escape hatch checks write-like tool names and refuses them unless `GWS_ALLOW_MCP_WRITE=true`.
- Forms and Tasks remain deferred until there is product need.

## Testing Strategy

Run targeted checks while iterating:

```bash
npm run check
npm test -- extensions/sf-google-workspace-internal
npm run check:panels
npm run generate-catalog:check
```

The standalone prototype also carries a Google Workspace routing eval script; keep generated eval result directories out of the sf-pi PR.

## Troubleshooting

**`/sf-google-workspace status` says mcp-adaptor is missing:**
Confirm DevBar / AI Marketplace installed mcp-adaptor at `~/.mcp-adaptor/bin/mcp-adaptor`, or set `GWS_MCP_ADAPTOR` / `MCP_ADAPTOR_PATH` to the compatible adaptor binary.

**Auth validation fails:**
Run `~/.mcp-adaptor/bin/mcp-adaptor auth`, then `~/.mcp-adaptor/bin/mcp-adaptor auth --provider google-workspace-readonly --env prod`, then `~/.mcp-adaptor/bin/mcp-adaptor auth --validate`. On macOS, credentials should persist through the Go keyring / macOS Keychain.

**The agent uses the full catalog for routine reads:**
Prefer first-class wrappers first, then `google_workspace_read_tool_search` and `google_workspace_read_tool_describe`. The full `google_workspace_tool_search` / `google_workspace_call` path is for debugging and extension development.

**A write-like MCP tool is refused:**
This is intentional. Review the underlying MCP operation and set `GWS_ALLOW_MCP_WRITE=true` only for deliberate write experimentation. Routine extension flows should remain read-only.
