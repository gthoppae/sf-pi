# SF Google Workspace container auth troubleshooting

This note captures a container-specific failure mode seen while testing the
`sf-google-workspace-internal` extension with Salesforce `mcp-adaptor`.

It is intentionally separate from the main extension README because most users
should only need the standard setup flow:

```bash
~/.mcp-adaptor/bin/mcp-adaptor auth
~/.mcp-adaptor/bin/mcp-adaptor auth --provider google-workspace-readonly --env prod
~/.mcp-adaptor/bin/mcp-adaptor auth --validate
```

## Symptom

`mcp-adaptor auth --validate` succeeds and shows a valid OAuth token, but every
Google Workspace MCP operation fails with:

```text
upstream HTTP 401: not authenticated — run 'devbar auth login' and retry
```

A direct MCP smoke test or Pi status may show stderr similar to:

```text
proxy detected
upstream=http://127.0.0.1:13316/proxy/mcp/server/google_workspace/mcp
auth_ok=false
```

## Cause

In this state, `mcp-adaptor serve --server google_workspace` is not taking the
plain direct route to the DX MCP Gateway. It has detected a local DevBar/DX MCP
proxy and is routing through that process:

```text
mcp-adaptor
  → local proxy on 127.0.0.1:13316
  → DX MCP Gateway
  → Google Workspace MCP server
```

The Google Workspace provider token can be valid while the local proxy layer is
stale or unauthenticated (`auth_ok=false`). The proxy then rejects requests
before they reach the Google Workspace MCP backend.

## Recovery

Clear stale proxy/adaptor processes and retry:

```bash
pkill -f 'mcp-adaptor serve --server google_workspace' || true
pkill -f '127.0.0.1:13316' || true
pkill -f 'proxy/mcp/server/google_workspace' || true
pkill -f 'devbar' || true
```

Then validate the raw MCP path with a bounded smoke test:

```bash
cat > /tmp/gws-mcp-smoke.jsonl <<'EOF_SMOKE'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual-smoke","version":"0.0.1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
EOF_SMOKE

timeout 20s ~/.mcp-adaptor/bin/mcp-adaptor serve --server google_workspace \
  < /tmp/gws-mcp-smoke.jsonl \
  > /tmp/gws-mcp-smoke.out \
  2> /tmp/gws-mcp-smoke.err

cat /tmp/gws-mcp-smoke.err
jq -r 'select(.id==2) | .result.tools | length' /tmp/gws-mcp-smoke.out
```

A healthy run returns the live Google Workspace MCP tool count, for example:

```text
85
```

It should not include the `auth_ok=false` proxy line.

## If auth itself is missing

If `mcp-adaptor auth --validate` fails with `no valid Oauth token found`, rerun
keyring setup and auth in the same container/runtime:

```bash
/work/infra/keyring-setup.sh

PATH="/tmp/no-browser:$PATH" \
MCP_ADAPTOR_ENABLE_DEVICE_FLOW=true \
~/.mcp-adaptor/bin/mcp-adaptor auth

PATH="/tmp/no-browser:$PATH" \
MCP_ADAPTOR_ENABLE_DEVICE_FLOW=true \
~/.mcp-adaptor/bin/mcp-adaptor auth --provider google-workspace-readonly --env prod

~/.mcp-adaptor/bin/mcp-adaptor auth --validate
```

The `/tmp/no-browser/xdg-open` shim is useful in headless containers when the
auth command tries to open a browser. It should print the OAuth URL so you can
open it manually on the host.
