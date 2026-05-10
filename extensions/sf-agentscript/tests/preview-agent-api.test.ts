/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for Agent API preview decisions that do not require live org access. */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { computePublishedBypassUser, startPreviewByApiName } from "../lib/preview/client.ts";

describe("computePublishedBypassUser", () => {
  test("Employee Agents use the named user context, not bot-user bypass", () => {
    expect(
      computePublishedBypassUser({ AgentType: "AgentforceEmployeeAgent", BotUserId: null }),
    ).toBe(false);
    expect(
      computePublishedBypassUser({ AgentType: "AgentforceEmployeeAgent", BotUserId: "005xx" }),
    ).toBe(false);
  });

  test("Service-style agents bypass only when a bot user is present", () => {
    expect(
      computePublishedBypassUser({ AgentType: "AgentforceServiceAgent", BotUserId: "005xx" }),
    ).toBe(true);
    expect(
      computePublishedBypassUser({ AgentType: "AgentforceServiceAgent", BotUserId: null }),
    ).toBe(false);
  });

  test("unknown agent metadata is conservative", () => {
    expect(computePublishedBypassUser(undefined)).toBe(false);
    expect(computePublishedBypassUser({})).toBe(false);
  });
});

describe("startPreviewByApiName", () => {
  test("retries once with bypassUser=false when bypassUser=true fails with invalid user id", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "sf-agentscript-preview-"));
    const bodies: Array<{ bypassUser?: boolean }> = [];
    const conn = {
      instanceUrl: "https://example.my.salesforce.com",
      query: vi.fn(async () => ({
        records: [
          { Id: "0Xx000000000001", AgentType: "AgentforceServiceAgent", BotUserId: "005xx" },
        ],
      })),
      request: vi.fn(async (req: { url: string; body?: string }) => {
        if (req.url.includes("/agents/0Xx000000000001/sessions")) {
          bodies.push(JSON.parse(req.body ?? "{}") as { bypassUser?: boolean });
          if (bodies.length === 1) {
            throw {
              statusCode: 400,
              message: "Bad Request: Invalid user ID provided on start session:",
              data: { message: "Bad Request: Invalid user ID provided on start session:" },
            };
          }
          return { sessionId: "sid-1", messages: [{ message: "hello" }] };
        }
        throw new Error(`unexpected request ${req.url}`);
      }),
    };

    try {
      const result = await startPreviewByApiName({
        conn: conn as never,
        cwd,
        agentApiName: "My_Agent",
      });
      expect(result.sessionId).toBe("sid-1");
      expect(bodies.map((b) => b.bypassUser)).toEqual([true, false]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
