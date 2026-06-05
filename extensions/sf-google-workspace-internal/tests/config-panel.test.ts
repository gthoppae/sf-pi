/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, test } from "vitest";
import { createConfigPanel } from "../lib/config-panel.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

test("manifest exposes sf-pi manager config panel", () => {
  const manifestPath = join(import.meta.dirname, "..", "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.configurable, true);
  assert.ok(manifest.docs.primaryFiles.includes("lib/config-panel.ts"));
});

test("config panel renders enablement, transport, setup, and safety sections", () => {
  const panel = createConfigPanel(
    theme as never,
    "/tmp/sf-pi-test",
    "global",
    () => undefined,
  ) as unknown as {
    render(width: number): string[];
  };
  const text = panel.render(120).join("\n");

  assert.ok(text.includes("SF Google Workspace — settings & status"));
  assert.ok(text.includes("Transport:"));
  assert.ok(text.includes("mcp-adaptor"));
  assert.ok(text.includes("Setup:"));
  assert.ok(text.includes("Safety:"));
});
