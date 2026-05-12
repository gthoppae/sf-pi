/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for the Slack startup runtime cache. */
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_AGENT_DIR = process.env.PI_CODING_AGENT_DIR;

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("Slack runtime cache", () => {
  afterEach(() => {
    restoreEnv("PI_CODING_AGENT_DIR", ORIGINAL_AGENT_DIR);
    vi.resetModules();
  });

  it("round-trips identity and scopes without storing the raw token", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "sf-pi-slack-runtime-cache-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const { readSlackRuntimeCache, writeSlackRuntimeCache, hashSlackToken } =
      await import("../lib/runtime-cache.ts");

    writeSlackRuntimeCache({
      token: "xoxp-secret-token",
      tokenType: "user",
      identity: { userId: "U123", userName: "jane", teamId: "T123" },
      grantedScopes: new Set(["users:read", "search:read.public"]),
    });

    const cached = readSlackRuntimeCache("xoxp-secret-token");
    expect(cached).toMatchObject({
      tokenHash: hashSlackToken("xoxp-secret-token"),
      tokenType: "user",
      identity: { userId: "U123", userName: "jane", teamId: "T123" },
      grantedScopes: ["search:read.public", "users:read"],
    });
    expect(JSON.stringify(cached)).not.toContain("xoxp-secret-token");
  });

  it("does not return cache entries for a different token", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "sf-pi-slack-runtime-cache-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const { readSlackRuntimeCache, writeSlackRuntimeCache } =
      await import("../lib/runtime-cache.ts");

    writeSlackRuntimeCache({
      token: "xoxp-old-token",
      tokenType: "user",
      identity: { userId: "U123", userName: "jane", teamId: "T123" },
      grantedScopes: ["users:read"],
    });

    expect(readSlackRuntimeCache("xoxp-new-token")).toBeNull();
  });
});
