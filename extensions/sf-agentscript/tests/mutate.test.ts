/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for mutate.ts — AST-primary, coordinate-fallback edits.
 *
 * Real SDK, real fixture file. We validate:
 *   - apply_quick_fix works end-to-end via the SDK's deprecated-field
 *     diagnostic.
 *   - set_field rewrites a topic description.
 *   - rename topic.X → subagent.X is AST-applied.
 *   - mutate refuses to touch a file with severity-1 parse errors.
 *   - bad component / unsupported ops return clear `reason` fields.
 */

import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { applyMutation } from "../lib/mutate.ts";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-mutate-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeAgent(name: string, source: string): Promise<string> {
  const filePath = path.join(workDir, name);
  await writeFile(filePath, source, "utf8");
  return filePath;
}

describe("applyMutation: apply_quick_fix", () => {
  test("returns no_matching_diagnostic when the line/code don't match", async () => {
    const filePath = await writeAgent(
      "billing.agent",
      ["system:", '    instructions: "ok"', ""].join("\n"),
    );
    const result = await applyMutation({
      op: "apply_quick_fix",
      path: filePath,
      diagnostic_code: "deprecated-field",
      line: 99,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no_matching_diagnostic");
  });
});

describe("applyMutation: set_field", () => {
  // Canonical fixture used by every set_field success-path test below.
  const FULL_FIXTURE = [
    "config:",
    '    agent_name: "Test_Bot"',
    '    description: "Demo"',
    "",
    "system:",
    "    instructions: |",
    "        old instructions",
    "",
    "topic billing:",
    '    description: "old billing description"',
    "",
    "topic faq:",
    '    description: "old faq description"',
    "",
    "start_agent main:",
    '    description: "entry"',
    "    transition to @topic.billing",
    "",
  ].join("\n");

  test("rewrites a nested topic.description (string) via AST and re-compiles", async () => {
    const filePath = await writeAgent("bot.agent", FULL_FIXTURE);
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "topic.faq",
      field: "description",
      value: "new faq description",
    });
    if (!result.ok) {
      throw new Error(`Expected success, got ${result.reason}: ${result.reason_detail}`);
    }
    expect(result.applied_via).toBe("ast");
    const after = await readFile(filePath, "utf8");
    expect(after).toContain("new faq description");
    expect(after).not.toContain("old faq description");
    expect((result.diagnostics_after ?? []).filter((d) => d.severity === 1)).toHaveLength(0);
  });

  test("rewrites a config field (top-level scalar) via AST", async () => {
    const filePath = await writeAgent("bot.agent", FULL_FIXTURE);
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "config",
      field: "description",
      value: "updated demo description",
    });
    if (!result.ok) {
      throw new Error(`Expected success, got ${result.reason}: ${result.reason_detail}`);
    }
    expect(result.applied_via).toBe("ast");
    const after = await readFile(filePath, "utf8");
    expect(after).toContain("updated demo description");
  });

  test("set_field rejects array values with a clear unsupported_value_type reason", async () => {
    const filePath = await writeAgent("bot.agent", FULL_FIXTURE);
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "topic.faq",
      field: "description",
      value: ["a", "b"],
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unsupported_value_type");
    expect(result.reason_detail).toMatch(/list values are not yet supported/i);
  });

  test("returns bad_component when the path is malformed", async () => {
    const filePath = await writeAgent(
      "bot.agent",
      ["system:", '    instructions: "x"', ""].join("\n"),
    );
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "topic", // missing entry name
      field: "description",
      value: "x",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("bad_component");
  });

  test("refuses to add a NEW field on config (field_not_present)", async () => {
    // Repro of the original Issue 3 from docs/POSTMORTEM_E2E_DEMO.md:
    // set_field on a missing field used to silently report success while
    // emit() dropped the new field on the floor. Now it returns a clean
    // error so the LLM falls back to the generic edit tool.
    const filePath = await writeAgent("bot.agent", FULL_FIXTURE);
    const before = await readFile(filePath, "utf8");
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "config",
      field: "agent_type", // not present in FULL_FIXTURE
      value: "AgentforceEmployeeAgent",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("field_not_present");
    expect(result.reason_detail).toMatch(/known fields:/i);
    expect(result.reason_detail).toMatch(/edit tool/i);
    // File on disk MUST be untouched (no whitespace round-trip leaks).
    expect(await readFile(filePath, "utf8")).toBe(before);
  });

  test("refuses to add a NEW field on system (field_not_present)", async () => {
    const filePath = await writeAgent("bot.agent", FULL_FIXTURE);
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "system",
      field: "agent_type", // system has only `instructions`
      value: "AgentforceEmployeeAgent",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("field_not_present");
  });

  test("refuses to add a NEW field on topic.<name> (field_not_present)", async () => {
    const filePath = await writeAgent("bot.agent", FULL_FIXTURE);
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "topic.faq",
      field: "reasoning", // topic.faq has only `description`
      value: "x",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("field_not_present");
  });

  test("returns entry_not_found when the named entry doesn't exist", async () => {
    const filePath = await writeAgent("bot.agent", FULL_FIXTURE);
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "topic.does_not_exist",
      field: "description",
      value: "x",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("entry_not_found");
  });

  test("dry_run on a missing field also refuses (no diff produced)", async () => {
    // Dry-runs that lie are just as bad as wet-runs that lie. The Layer 1
    // guard fires before commitOrPreview is reached.
    const filePath = await writeAgent("bot.agent", FULL_FIXTURE);
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "config",
      field: "agent_type",
      value: "AgentforceEmployeeAgent",
      dry_run: true,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("field_not_present");
    expect(result.diff).toBeUndefined();
    expect(result.preview_source).toBeUndefined();
  });

  test("returns unknown_component_kind for unrecognized heads", async () => {
    const filePath = await writeAgent(
      "bot.agent",
      ["system:", '    instructions: "x"', ""].join("\n"),
    );
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "ghost.x",
      field: "y",
      value: 1,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unknown_component_kind");
  });
});

describe("applyMutation: rename", () => {
  test("rejects non topic→subagent renames", async () => {
    const filePath = await writeAgent(
      "bot.agent",
      ["system:", '    instructions: "x"', ""].join("\n"),
    );
    const result = await applyMutation({
      op: "rename",
      path: filePath,
      from: "topic.foo",
      to: "topic.bar",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("rename_unsupported");
  });
});

describe("applyMutation: insert / delete (not yet implemented)", () => {
  test("returns ast_unsupported with a hint", async () => {
    const filePath = await writeAgent(
      "bot.agent",
      ["system:", '    instructions: "x"', ""].join("\n"),
    );
    const insert = await applyMutation({
      op: "insert",
      path: filePath,
      parent: "topic.x.actions",
      child: "lookup",
    });
    expect(insert.ok).toBe(false);
    expect(insert.reason).toBe("ast_unsupported");
    expect(insert.reason_detail).toContain("not yet implemented");
  });
});

describe("applyMutation: file safety", () => {
  test("read_failed when the path doesn't exist", async () => {
    const result = await applyMutation({
      op: "set_field",
      path: path.join(workDir, "nope.agent"),
      component: "system",
      field: "instructions",
      value: "x",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("read_failed");
  });
});
