/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for lib/preview/session-store.ts.
 *
 * In-process: no Connection, no SDK. Round-trips through tmpdir.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  cleanupSessions,
  endSession,
  getSessionDir,
  initSession,
  loadSession,
  logTrace,
  logTurn,
  type PreviewMetadata,
} from "../lib/preview/session-store.ts";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-preview-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("session lifecycle", () => {
  test("initSession creates the standard layout under .sfdx/agents/...", async () => {
    const dir = await initSession(workDir, {
      sessionId: "S1",
      agentName: "Billing_Bot",
      startTime: "2026-05-10T00:00:00Z",
      mockMode: "Mock",
    });
    expect(dir).toBe(getSessionDir(workDir, "Billing_Bot", "S1"));
    const metaRaw = await readFile(path.join(dir, "metadata.json"), "utf8");
    const meta = JSON.parse(metaRaw) as PreviewMetadata;
    expect(meta).toMatchObject({
      sessionId: "S1",
      agentName: "Billing_Bot",
      startTime: "2026-05-10T00:00:00Z",
      mockMode: "Mock",
      planIds: [],
    });
  });

  test("logTurn appends to transcript.jsonl", async () => {
    const dir = await initSession(workDir, {
      sessionId: "S1",
      agentName: "B",
      startTime: "t0",
      mockMode: "Mock",
    });
    await logTurn(dir, {
      timestamp: "t1",
      agentName: "B",
      sessionId: "S1",
      role: "user",
      text: "hello",
    });
    await logTurn(dir, {
      timestamp: "t2",
      agentName: "B",
      sessionId: "S1",
      role: "agent",
      text: "hi",
      planId: "P1",
    });
    const { transcript } = await loadSession(workDir, "B", "S1");
    expect(transcript).toHaveLength(2);
    expect(transcript[0].role).toBe("user");
    expect(transcript[1].planId).toBe("P1");
  });

  test("logTrace writes the file and updates planIds", async () => {
    const dir = await initSession(workDir, {
      sessionId: "S1",
      agentName: "B",
      startTime: "t0",
      mockMode: "Mock",
    });
    await logTrace(dir, "P1", { steps: [{ type: "UpdateTopicStep", topic: "billing" }] });
    const { metadata } = await loadSession(workDir, "B", "S1");
    expect(metadata.planIds).toContain("P1");
    const traceRaw = await readFile(path.join(dir, "traces", "P1.json"), "utf8");
    expect(JSON.parse(traceRaw)).toMatchObject({ steps: [{ topic: "billing" }] });
  });

  test("endSession writes endTime", async () => {
    const dir = await initSession(workDir, {
      sessionId: "S1",
      agentName: "B",
      startTime: "t0",
      mockMode: "Mock",
    });
    const meta = await endSession(dir, "tEnd");
    expect(meta.endTime).toBe("tEnd");
  });
});

describe("cleanupSessions", () => {
  test("removes sessions older than the cutoff and keeps recent ones", async () => {
    // Old session: startTime 100 days ago.
    const oldStart = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    await initSession(workDir, {
      sessionId: "old",
      agentName: "B",
      startTime: oldStart,
      mockMode: "Mock",
    });
    // Recent session: startTime now.
    await initSession(workDir, {
      sessionId: "fresh",
      agentName: "B",
      startTime: new Date().toISOString(),
      mockMode: "Mock",
    });

    const result = await cleanupSessions(workDir, 30);
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0].session_id).toBe("old");
    expect(result.kept_count).toBe(1);

    // The fresh one is still there, the old one is gone.
    const { metadata: keptMeta } = await loadSession(workDir, "B", "fresh");
    expect(keptMeta.sessionId).toBe("fresh");
    await expect(loadSession(workDir, "B", "old")).rejects.toThrow();
  });

  test("dry_run reports what would be removed without deleting", async () => {
    const oldStart = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    await initSession(workDir, {
      sessionId: "old",
      agentName: "B",
      startTime: oldStart,
      mockMode: "Mock",
    });
    const result = await cleanupSessions(workDir, 30, true);
    expect(result.removed).toHaveLength(1);
    // Still on disk.
    const { metadata } = await loadSession(workDir, "B", "old");
    expect(metadata.sessionId).toBe("old");
  });

  test("returns empty when no sessions exist", async () => {
    const result = await cleanupSessions(workDir, 30);
    expect(result.removed).toEqual([]);
    expect(result.kept_count).toBe(0);
  });
});
