/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for mutate dry_run: confirms the file is NOT written and the diff
 * + preview_source are returned.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { applyMutation } from "../lib/mutate.ts";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-dry-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const FIXTURE = [
  "config:",
  '    agent_name: "Test_Bot"',
  '    description: "Demo"',
  "",
  "system:",
  "    instructions: |",
  "        helpful",
  "",
  "topic billing:",
  '    description: "old description"',
  "",
  "start_agent main:",
  '    description: "entry"',
  "    transition to @topic.billing",
  "",
].join("\n");

describe("applyMutation dry_run", () => {
  test("set_field with dry_run=true returns diff + preview_source and does NOT write", async () => {
    const filePath = path.join(workDir, "bot.agent");
    await writeFile(filePath, FIXTURE, "utf8");

    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "topic.billing",
      field: "description",
      value: "new description",
      dry_run: true,
    });
    if (!result.ok) {
      throw new Error(`Expected success, got ${result.reason}: ${result.reason_detail}`);
    }
    expect(result.was_dry_run).toBe(true);
    expect(result.preview_source).toContain("new description");
    expect(result.preview_source).not.toContain("old description");
    expect(typeof result.diff).toBe("string");
    expect(result.diff).toContain("---");
    expect(result.diff).toContain("+++");
    expect(result.diff).toContain("+");

    // File on disk is unchanged.
    const onDisk = await readFile(filePath, "utf8");
    expect(onDisk).toBe(FIXTURE);
    expect(onDisk).toContain("old description");
  });

  test("dry_run=false (default) writes as usual", async () => {
    const filePath = path.join(workDir, "bot.agent");
    await writeFile(filePath, FIXTURE, "utf8");

    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "topic.billing",
      field: "description",
      value: "new description",
    });
    if (!result.ok) {
      throw new Error(`Expected success, got ${result.reason}: ${result.reason_detail}`);
    }
    expect(result.was_dry_run).toBeUndefined();
    expect(result.diff).toBeUndefined();

    const onDisk = await readFile(filePath, "utf8");
    expect(onDisk).toContain("new description");
    expect(onDisk).not.toContain("old description");
  });
});
