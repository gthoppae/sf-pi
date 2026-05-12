/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Sticky SFAP host pinning for preview sessions.
 *
 * Sessions are shard-local on the SFAP infrastructure: a session created on
 * `test.api.salesforce.com` doesn't exist on `api.salesforce.com`. Without
 * pinning, send/end can hit the wrong shard and surface "Session not found"
 * after a successful start.
 *
 * These tests cover both transport-layer pinning (sfapRequest skips the host
 * walk when `pinnedEndpoint` is set) and storage-layer pinning (the start
 * call's endpoint is captured in metadata.json and reused on subsequent
 * calls). Legacy sessions written before this field existed must keep
 * working via the original host walk.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { sfapRequest } from "../lib/eval/sfap.ts";
import {
  getSessionDir,
  initSession,
  loadSession,
  type PreviewMetadata,
  type SfapHostPrefix,
} from "../lib/preview/session-store.ts";

// -------------------------------------------------------------------------------------------------
// Transport-layer: sfapRequest honors pinnedEndpoint
// -------------------------------------------------------------------------------------------------

describe("sfapRequest pinnedEndpoint", () => {
  test("skips the host walk and uses only the pinned endpoint", async () => {
    const calls: string[] = [];
    const conn = {
      request: vi.fn(async (req: { url: string }) => {
        calls.push(req.url);
        return { ok: true };
      }),
    };
    const res = await sfapRequest(conn as never, {
      url: "https://api.salesforce.com/einstein/ai-agent/v1/sessions/abc/messages",
      method: "POST",
      pinnedEndpoint: "test.",
    });
    expect(res.status).toBe(200);
    expect(res.endpoint).toBe("test.");
    expect(calls).toEqual([
      "https://test.api.salesforce.com/einstein/ai-agent/v1/sessions/abc/messages",
    ]);
  });

  test("pins to production when endpoint is empty string", async () => {
    const calls: string[] = [];
    const conn = {
      request: vi.fn(async (req: { url: string }) => {
        calls.push(req.url);
        return { ok: true };
      }),
    };
    await sfapRequest(conn as never, {
      url: "https://api.salesforce.com/einstein/ai-agent/v1/sessions/abc/messages",
      method: "POST",
      pinnedEndpoint: "",
    });
    expect(calls).toEqual([
      "https://api.salesforce.com/einstein/ai-agent/v1/sessions/abc/messages",
    ]);
  });

  test("does not fall back to other hosts even on 404 when pinned", async () => {
    const calls: string[] = [];
    const conn = {
      request: vi.fn(async (req: { url: string }) => {
        calls.push(req.url);
        const e = new Error("not found");
        (e as Error & { errorCode?: string }).errorCode = "ERROR_HTTP_404";
        throw e;
      }),
    };
    const res = await sfapRequest(conn as never, {
      url: "https://api.salesforce.com/x",
      method: "GET",
      pinnedEndpoint: "test.",
    });
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(1); // no walk
  });

  test("default behavior unchanged when pinnedEndpoint is omitted", async () => {
    const calls: string[] = [];
    const conn = {
      request: vi.fn(async (req: { url: string }) => {
        calls.push(req.url);
        if (calls.length < 2) {
          const e = new Error("");
          (e as Error & { errorCode?: string }).errorCode = "ERROR_HTTP_404";
          throw e;
        }
        return { ok: true };
      }),
    };
    const res = await sfapRequest(conn as never, {
      url: "https://api.salesforce.com/x",
      method: "GET",
    });
    expect(res.status).toBe(200);
    expect(res.endpoint).toBe("test.");
    expect(calls).toEqual(["https://api.salesforce.com/x", "https://test.api.salesforce.com/x"]);
  });
});

// -------------------------------------------------------------------------------------------------
// Storage-layer: initSession captures endpoint, loadSession returns it,
// legacy sessions without it still parse cleanly
// -------------------------------------------------------------------------------------------------

describe("session-store endpoint persistence", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-pin-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("initSession persists endpoint and loadSession returns it", async () => {
    const sessionDir = await initSession(dir, {
      sessionId: "abc",
      agentName: "Bot",
      startTime: "2026-01-01T00:00:00Z",
      mockMode: "Mock",
      sessionKind: "agent_file",
      endpoint: "test." as SfapHostPrefix,
    });
    expect(sessionDir).toBe(getSessionDir(dir, "Bot", "abc"));
    const { metadata } = await loadSession(dir, "Bot", "abc");
    expect(metadata.endpoint).toBe("test.");

    // The on-disk metadata.json round-trips cleanly.
    const raw = JSON.parse(
      await readFile(path.join(sessionDir, "metadata.json"), "utf8"),
    ) as PreviewMetadata;
    expect(raw.endpoint).toBe("test.");
  });

  test("initSession omitting endpoint leaves it undefined (legacy-compatible)", async () => {
    await initSession(dir, {
      sessionId: "abc",
      agentName: "Bot",
      startTime: "2026-01-01T00:00:00Z",
      mockMode: "Mock",
      sessionKind: "agent_file",
    });
    const { metadata } = await loadSession(dir, "Bot", "abc");
    expect(metadata.endpoint).toBeUndefined();
  });

  test("initSession persists targetOrg and loadSession returns it", async () => {
    await initSession(dir, {
      sessionId: "abc",
      agentName: "Bot",
      startTime: "2026-01-01T00:00:00Z",
      mockMode: "Mock",
      sessionKind: "agent_file",
      endpoint: "" as SfapHostPrefix,
      targetOrg: "MyDemoOrg",
    });
    const { metadata } = await loadSession(dir, "Bot", "abc");
    expect(metadata.targetOrg).toBe("MyDemoOrg");
  });

  test("loadSession parses pre-existing metadata.json without endpoint", async () => {
    // Simulate a session written before sticky-host pinning landed.
    const sessionDir = getSessionDir(dir, "Bot", "abc");
    await writeFile(path.join(sessionDir, "..", "..", "..", "..", "..", ".keepalive"), "x", {
      flag: "w",
    }).catch(() => {
      /* nested mkdir handled inside initSession on first run */
    });
    // Easier: bootstrap via initSession then strip `endpoint` from the file.
    await initSession(dir, {
      sessionId: "abc",
      agentName: "Bot",
      startTime: "2026-01-01T00:00:00Z",
      mockMode: "Mock",
      sessionKind: "agent_file",
    });
    const metaPath = path.join(sessionDir, "metadata.json");
    const obj = JSON.parse(await readFile(metaPath, "utf8")) as Record<string, unknown>;
    delete obj.endpoint; // legacy file shape
    await writeFile(metaPath, JSON.stringify(obj));

    const { metadata } = await loadSession(dir, "Bot", "abc");
    expect(metadata.endpoint).toBeUndefined();
    expect(metadata.sessionId).toBe("abc"); // other fields intact
  });
});
