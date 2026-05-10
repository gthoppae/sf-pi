/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Regression: published agents must show up in Agent Script Studio.
 *
 * The Agent Script Studio UI gates on the existence of an `AiAuthoringBundle`
 * metadata record bound to the right BotVersion via its `<target>` element.
 * Our publish pipeline previously stopped after the SFAP /authoring/agents
 * call, which created the BotDefinition + BotVersion + GenAiPlannerDefinition
 * but NOT the bundle record — so the UI silently fell back to the legacy
 * builder.
 *
 * publishAgent() now follows the SFAP call with `metadata.upsert` of an
 * AiAuthoringBundle record:
 *
 *   fullName: `${agentApiName}_${versionNumber}`         (e.g. "My_Agent_1")
 *   target:   `${agentApiName}.${versionDeveloperName}`  (e.g. "My_Agent.v1")
 *
 * This test verifies the upsert is invoked with the correct shape and that
 * its result is reported back on PublishResult.authoring_bundle.
 */

import { describe, expect, test, vi } from "vitest";
import { publishAgent } from "../lib/lifecycle.ts";

// Minimal source the vendored SDK accepts cleanly. Scaffold form so the
// publishAgent local pre-flight (which runs compileSource through the SDK)
// passes — we want these tests to focus on the AiAuthoringBundle deploy,
// not on parser semantics.
const CLEAN_SOURCE = `config:
    agent_name: "My_Agent"
    description: "Test agent"
    agent_type: "AgentforceEmployeeAgent"

system:
    instructions: |
        Be concise.

topic main_topic:
    description: "Primary topic."

start_agent main:
    description: "Entry point."
    transition to @topic.main_topic
`;

interface UpsertCall {
  type: string;
  payload: Array<Record<string, unknown>>;
}

function fakeConnection(opts: {
  existingBotId?: string;
  publishResp: { status: number; body: unknown };
  versionRow?: { DeveloperName?: string; VersionNumber?: number };
  upsertResult: Array<{ created?: boolean; success?: boolean; errors?: unknown[] }>;
  upsertSink: UpsertCall[];
  sfapSink?: Array<{ url: string; body: unknown }>;
}) {
  const queryHandler = (soql: string): Promise<{ records: unknown[] }> => {
    if (/FROM BotDefinition WHERE DeveloperName/i.test(soql)) {
      return Promise.resolve({
        records: opts.existingBotId ? [{ Id: opts.existingBotId }] : [],
      });
    }
    if (/FROM BotVersion WHERE Id/i.test(soql)) {
      return Promise.resolve({
        records: opts.versionRow ? [opts.versionRow] : [],
      });
    }
    return Promise.resolve({ records: [] });
  };

  const conn = {
    instanceUrl: "https://example.my.salesforce.com",
    query: vi.fn(queryHandler),
    request: vi.fn(async (req: { url: string; body?: string }) => {
      if (opts.sfapSink) {
        opts.sfapSink.push({ url: req.url, body: req.body ? JSON.parse(req.body) : null });
      }
      // The serverCompile + publish requests both go through this. Return
      // shaped responses based on URL.
      if (req.url.endsWith("/authoring/scripts")) {
        return {
          status: "success",
          compiledArtifact: {
            globalConfiguration: { developerName: "My_Agent" },
            agentVersion: { developerName: "v1" },
          },
        };
      }
      if (req.url.includes("/authoring/agents")) {
        if (opts.publishResp.status >= 200 && opts.publishResp.status < 300) {
          return opts.publishResp.body;
        }
        const err = new Error("publish failed") as Error & { statusCode: number; data: unknown };
        err.statusCode = opts.publishResp.status;
        err.data = opts.publishResp.body;
        throw err;
      }
      throw new Error(`unexpected request ${req.url}`);
    }),
    metadata: {
      upsert: vi.fn(async (type: string, payload: Array<Record<string, unknown>>) => {
        opts.upsertSink.push({ type, payload });
        return opts.upsertResult;
      }),
    },
  };
  return conn;
}

describe("publishAgent deploys AiAuthoringBundle", () => {
  test("calls metadata.upsert with the expected fullName + target after a successful publish", async () => {
    const upsertSink: UpsertCall[] = [];
    const conn = fakeConnection({
      publishResp: {
        status: 200,
        body: { botId: "0Xx_BOT", botVersionId: "0X9_VER" },
      },
      versionRow: { DeveloperName: "v3", VersionNumber: 3 },
      upsertResult: [{ created: true, success: true, errors: [] }],
      upsertSink,
    });

    const result = await publishAgent({
      conn: conn as never,
      agentApiName: "My_Agent",
      agentSource: CLEAN_SOURCE,
    });

    expect(upsertSink).toHaveLength(1);
    expect(upsertSink[0].type).toBe("AiAuthoringBundle");
    expect(upsertSink[0].payload).toEqual([
      { fullName: "My_Agent_3", bundleType: "AGENT", target: "My_Agent.v3" },
    ]);
    expect(result.authoring_bundle).toEqual({
      full_name: "My_Agent_3",
      target: "My_Agent.v3",
      created: true,
    });
    expect(result.bot_id).toBe("0Xx_BOT");
    expect(result.bot_version_id).toBe("0X9_VER");
  });

  test("when metadata.upsert throws, the publish still returns ok=true and reports the error on authoring_bundle", async () => {
    const upsertSink: UpsertCall[] = [];
    const conn = fakeConnection({
      publishResp: { status: 200, body: { botId: "0Xx", botVersionId: "0X9" } },
      versionRow: { DeveloperName: "v1", VersionNumber: 1 },
      upsertResult: [],
      upsertSink,
    });
    // override metadata.upsert to throw
    conn.metadata.upsert = vi.fn(async () => {
      throw new Error("INSUFFICIENT_ACCESS");
    });

    const result = await publishAgent({
      conn: conn as never,
      agentApiName: "My_Agent",
      agentSource: CLEAN_SOURCE,
    });

    expect(result.ok).toBe(true);
    expect(result.authoring_bundle?.created).toBe(false);
    expect(result.authoring_bundle?.error).toContain("INSUFFICIENT_ACCESS");
  });

  test("when version metadata can't be resolved, the bundle deploy is skipped (no spurious upsert)", async () => {
    const upsertSink: UpsertCall[] = [];
    const conn = fakeConnection({
      publishResp: { status: 200, body: { botId: "0Xx", botVersionId: "0X9" } },
      versionRow: undefined,
      upsertResult: [],
      upsertSink,
    });

    const result = await publishAgent({
      conn: conn as never,
      agentApiName: "My_Agent",
      agentSource: CLEAN_SOURCE,
    });

    expect(upsertSink).toHaveLength(0);
    expect(result.authoring_bundle).toBeUndefined();
  });
});
