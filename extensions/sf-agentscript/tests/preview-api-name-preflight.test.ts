/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Preflight diagnostics for `startPreviewByApiName`. The preflight runs one
 * SOQL on BotDefinition + child BotVersions and rewrites the common
 * misconfigurations into actionable error messages, instead of letting the
 * SFAP server return a confusing 412/404/500.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { startPreviewByApiName } from "../lib/preview/client.ts";

function fakeConn(records: unknown[]) {
  return {
    instanceUrl: "https://example.my.salesforce.com",
    query: vi.fn(async () => ({ records, totalSize: records.length })),
    request: vi.fn(async () => ({ sessionId: "should-not-be-called", messages: [] })),
  };
}

describe("startPreviewByApiName preflight", () => {
  test("missing agent → publish hint", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "preflight-"));
    try {
      const conn = fakeConn([]);
      await expect(
        startPreviewByApiName({
          conn: conn as never,
          cwd,
          agentApiName: "Nope",
        }),
      ).rejects.toThrow(/not found in the org/);
      // Did NOT call /sessions when SOQL preflight rejected
      expect(conn.request).not.toHaveBeenCalled();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("agent exists but no BotVersions → publish hint", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "preflight-"));
    try {
      const conn = fakeConn([
        {
          Id: "0Xx000000000001",
          AgentType: "AgentforceEmployeeAgent",
          BotUserId: null,
          BotVersions: { records: [] },
        },
      ]);
      await expect(
        startPreviewByApiName({
          conn: conn as never,
          cwd,
          agentApiName: "Empty",
        }),
      ).rejects.toThrow(/no BotVersions.*Publish first/i);
      expect(conn.request).not.toHaveBeenCalled();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("latest BotVersion Inactive → activate hint with version + agent name", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "preflight-"));
    try {
      const conn = fakeConn([
        {
          Id: "0Xx000000000002",
          AgentType: "AgentforceEmployeeAgent",
          BotUserId: null,
          BotVersions: {
            records: [
              {
                Id: "0X9000000000001",
                DeveloperName: "v3",
                Status: "Inactive",
                VersionNumber: 3,
              },
            ],
          },
        },
      ]);
      await expect(
        startPreviewByApiName({
          conn: conn as never,
          cwd,
          agentApiName: "Stale_Bot",
        }),
      ).rejects.toThrow(/no active BotVersion.*v3.*Inactive.*activate.*Stale_Bot.*version=3/is);
      expect(conn.request).not.toHaveBeenCalled();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("active BotVersion → preflight passes, /sessions is called", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "preflight-"));
    try {
      const conn = {
        instanceUrl: "https://example.my.salesforce.com",
        query: vi.fn(async () => ({
          records: [
            {
              Id: "0Xx000000000003",
              AgentType: "AgentforceEmployeeAgent",
              BotUserId: null,
              BotVersions: {
                records: [
                  {
                    Id: "0X9000000000002",
                    DeveloperName: "v1",
                    Status: "Active",
                    VersionNumber: 1,
                  },
                ],
              },
            },
          ],
          totalSize: 1,
        })),
        request: vi.fn(async (req: { url: string }) => {
          if (req.url.includes("/agents/0Xx000000000003/sessions")) {
            return { sessionId: "sid-1", messages: [{ message: "hi" }] };
          }
          throw new Error(`unexpected ${req.url}`);
        }),
      };
      const result = await startPreviewByApiName({
        conn: conn as never,
        cwd,
        agentApiName: "Active_Bot",
      });
      expect(result.sessionId).toBe("sid-1");
      expect(conn.request).toHaveBeenCalledTimes(1);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
