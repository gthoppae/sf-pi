/* SPDX-License-Identifier: Apache-2.0 */
import { test, assert } from "vitest";
import {
  McpAdaptorError,
  assertMcpToolAllowed,
  formatMcpToolList,
  isLikelyWriteTool,
  resolveMcpTransportConfig,
  searchTools,
  stringifyBounded,
} from "../lib/mcp.ts";

test("resolveMcpTransportConfig defaults to google_workspace", () => {
  const cfg = resolveMcpTransportConfig({ HOME: "/home/agent" });
  assert.equal(cfg.server, "google_workspace");
  assert.equal(cfg.timeoutMs, 60_000);
  assert.equal(cfg.keepAlive, false);
  assert.equal(cfg.keepAliveIdleMs, 300_000);
  assert.ok(cfg.adaptorPath.endsWith("/.mcp-adaptor/bin/mcp-adaptor"));
});

test("resolveMcpTransportConfig honors env overrides", () => {
  const cfg = resolveMcpTransportConfig({
    GWS_MCP_ADAPTOR: "/tmp/mcp-adaptor",
    GWS_MCP_SERVER: "google_workspace_custom",
    GWS_MCP_TIMEOUT_MS: "1234",
    GWS_MCP_KEEPALIVE: "1",
    GWS_MCP_KEEPALIVE_IDLE_MS: "4567",
  });
  assert.equal(cfg.adaptorPath, "/tmp/mcp-adaptor");
  assert.equal(cfg.server, "google_workspace_custom");
  assert.equal(cfg.timeoutMs, 1234);
  assert.equal(cfg.keepAlive, true);
  assert.equal(cfg.keepAliveIdleMs, 4567);
});

test("resolveMcpTransportConfig supports transport mode keepalive", () => {
  const cfg = resolveMcpTransportConfig({ GWS_MCP_TRANSPORT_MODE: "keepalive" });
  assert.equal(cfg.keepAlive, true);
});

test("searchTools filters names and descriptions", () => {
  const tools = [
    { name: "search_drive_files", description: "Find files" },
    { name: "get_doc_content", description: "Read a document" },
    { name: "create_presentation", description: "Make slides" },
  ];
  assert.deepEqual(
    searchTools(tools, "doc").map((t) => t.name),
    ["get_doc_content"],
  );
  assert.deepEqual(
    searchTools(tools, "files").map((t) => t.name),
    ["search_drive_files"],
  );
  assert.deepEqual(
    searchTools(tools, "drive files").map((t) => t.name),
    ["search_drive_files"],
  );
  assert.deepEqual(
    searchTools([{ name: "get_form", description: "Get a form." }], "forms").map((t) => t.name),
    ["get_form"],
  );
});

test("searchTools ranks name matches ahead of description-only matches", () => {
  const tools = [
    { name: "check_drive_file_public_access", description: "Can be used in Google Forms." },
    { name: "get_form", description: "Get a form." },
    { name: "list_form_responses", description: "List a form's responses." },
  ];
  assert.deepEqual(
    searchTools(tools, "forms", 3).map((t) => t.name),
    ["get_form", "list_form_responses", "check_drive_file_public_access"],
  );
});

test("write-like tool names require opt-in", () => {
  assert.equal(isLikelyWriteTool("get_doc_content"), false);
  assert.equal(isLikelyWriteTool("search_drive_files"), false);
  assert.equal(isLikelyWriteTool("create_presentation"), true);
  assert.equal(isLikelyWriteTool("batch_modify_gmail_message_labels"), true);
  assert.throws(() => assertMcpToolAllowed("create_presentation"), McpAdaptorError);
  assert.doesNotThrow(() => assertMcpToolAllowed("create_presentation", { allowWrite: true }));
});

test("formatMcpToolList stays compact", () => {
  const text = formatMcpToolList([
    { name: "search_drive_files", description: "Find files\nacross Drive" },
  ]);
  assert.equal(text, "1. search_drive_files — Find files across Drive");
});

test("stringifyBounded truncates large payloads", () => {
  const text = stringifyBounded("x".repeat(100), 10);
  assert.ok(text.startsWith("xxxxxxxxxx"));
  assert.ok(text.includes("Output truncated"));
});
