/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tool: agentscript_lifecycle — multi-action publish/activate lifecycle.
 *
 * Closes the dev loop. After compile + inspect + mutate + preview + eval,
 * this is the verb that actually ships the agent to the org.
 *
 * Actions:
 *   publish        Server-compile + create new agent OR new version of an
 *                  existing agent (auto-detected). Optionally activate the
 *                  new version in the same call.
 *   activate       Activate a specific version (or the latest).
 *   deactivate     Deactivate a specific version (or the latest).
 *   list_versions  Enumerate every BotVersion for an agent in the org.
 *
 * Auth: @salesforce/core Connection.
 * Local-first: publish pre-flights via the local SDK before the server call.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { connFromAlias } from "./connection.ts";
import { isAgentScriptFile, resolveToolPath } from "./file-classify.ts";
import { activateVersion, deactivateVersion, listVersions, publishAgent } from "./lifecycle.ts";
import { toolError, toolOk, type ToolError } from "./tool-types.ts";

export const LIFECYCLE_TOOL_NAME = "agentscript_lifecycle";

const Params = Type.Union([
  Type.Object({
    action: Type.Literal("publish"),
    agent_file: Type.String({
      description: "Path to the `.agent` file to publish.",
    }),
    agent_api_name: Type.Optional(
      Type.String({
        description:
          "Agent DeveloperName. Defaults to the basename of agent_file (without .agent).",
      }),
    ),
    target_org: Type.Optional(Type.String()),
    activate: Type.Optional(
      Type.Boolean({
        description: "Immediately activate the new version. Default false.",
      }),
    ),
  }),
  Type.Object({
    action: Type.Literal("activate"),
    agent_api_name: Type.String(),
    version: Type.Optional(Type.Number({ minimum: 1 })),
    target_org: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("deactivate"),
    agent_api_name: Type.String(),
    version: Type.Optional(Type.Number({ minimum: 1 })),
    target_org: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("list_versions"),
    agent_api_name: Type.String(),
    target_org: Type.Optional(Type.String()),
  }),
]);

type ParamsAny =
  | {
      action: "publish";
      agent_file: string;
      agent_api_name?: string;
      target_org?: string;
      activate?: boolean;
    }
  | { action: "activate"; agent_api_name: string; version?: number; target_org?: string }
  | { action: "deactivate"; agent_api_name: string; version?: number; target_org?: string }
  | { action: "list_versions"; agent_api_name: string; target_org?: string };

export function registerLifecycleTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: LIFECYCLE_TOOL_NAME,
    label: "Agent Script lifecycle",
    description:
      "Multi-action publish lifecycle: publish a `.agent` (creates new agent or new version), activate / deactivate a specific version, or list every version on an agent in the org. Local pre-flight before server publish; SOQL-backed list_versions; idempotent activate.",
    promptSnippet: "Ship a .agent file to the org and toggle version activation.",
    promptGuidelines: [
      "action='publish' — pass agent_file (the .agent path). Auto-detects new-agent vs new-version. Set activate=true to chain publish+activate in one call.",
      "action='activate' / 'deactivate' — pass agent_api_name; omit version for the latest. Idempotent: a no-op when already in the requested state.",
      "action='list_versions' — returns every BotVersion (id, number, status, dates). Use to discover which version is Active before previewing or running eval.",
      "Errors carry recover_via where applicable (e.g. agent not found → list_versions hint).",
    ],
    parameters: Params,
    async execute(_id, params, _signal, onUpdate, ctx) {
      const p = params as ParamsAny;
      const stream = (msg: string): void => {
        try {
          onUpdate?.({
            content: [{ type: "text", text: msg }],
            details: { progress: msg } as never,
          });
        } catch {
          /* best-effort */
        }
      };
      switch (p.action) {
        case "publish":
          return await actionPublish(ctx, p, stream);
        case "activate":
          return await actionActivate(p);
        case "deactivate":
          return await actionDeactivate(p);
        case "list_versions":
          return await actionListVersions(p);
      }
    },
  });
}

// -------------------------------------------------------------------------------------------------
// action = publish
// -------------------------------------------------------------------------------------------------

async function actionPublish(
  ctx: ExtensionContext,
  input: Extract<ParamsAny, { action: "publish" }>,
  stream: (msg: string) => void,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const filePath = resolveToolPath(input.agent_file, ctx.cwd);
  if (!isAgentScriptFile(filePath)) {
    return toolError(`Not an Agent Script file: ${filePath}`, "Pass a path ending in `.agent`.");
  }

  let source: string;
  try {
    source = await readFile(filePath, "utf8");
  } catch (err) {
    return toolError(
      `Cannot read ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const agentApiName = input.agent_api_name ?? path.basename(filePath, ".agent");

  try {
    const conn = await connFromAlias(input.target_org);
    const result = await publishAgent({
      conn,
      agentSource: source,
      agentApiName,
      activate: input.activate ?? false,
      log: stream,
    });
    return toolOk(
      {
        ok: true as const,
        agent_api_name: result.developer_name,
        bot_id: result.bot_id,
        bot_version_id: result.bot_version_id,
        version_developer_name: result.version_developer_name,
        was_new_agent: result.was_new_agent,
        activated: result.activated,
      },
      [
        `📦 Published ${result.developer_name}`,
        result.was_new_agent ? "  • created new agent" : "  • new version of existing agent",
        `  • bot_version_id: ${result.bot_version_id}`,
        result.activated ? "  • activated ✓" : "  • not activated (set activate=true to chain)",
      ].join("\n"),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Local compile rejected/i.test(msg)) {
      return toolError(msg, undefined, {
        tool: "agentscript_compile",
        params: { path: filePath },
      });
    }
    return toolError(msg);
  }
}

// -------------------------------------------------------------------------------------------------
// action = activate / deactivate
// -------------------------------------------------------------------------------------------------

async function actionActivate(input: Extract<ParamsAny, { action: "activate" }>): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  try {
    const conn = await connFromAlias(input.target_org);
    const row = await activateVersion({
      conn,
      agentApiName: input.agent_api_name,
      version: input.version,
    });
    return toolOk(
      {
        ok: true as const,
        agent_api_name: input.agent_api_name,
        bot_version_id: row.Id,
        version_number: row.VersionNumber,
        status: row.Status,
      },
      `🟢 ${input.agent_api_name} v${row.VersionNumber} activated`,
    );
  } catch (err) {
    return classifyLifecycleError(err, input.agent_api_name);
  }
}

async function actionDeactivate(input: Extract<ParamsAny, { action: "deactivate" }>): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  try {
    const conn = await connFromAlias(input.target_org);
    const row = await deactivateVersion({
      conn,
      agentApiName: input.agent_api_name,
      version: input.version,
    });
    return toolOk(
      {
        ok: true as const,
        agent_api_name: input.agent_api_name,
        bot_version_id: row.Id,
        version_number: row.VersionNumber,
        status: row.Status,
      },
      `⚫ ${input.agent_api_name} v${row.VersionNumber} deactivated`,
    );
  } catch (err) {
    return classifyLifecycleError(err, input.agent_api_name);
  }
}

// -------------------------------------------------------------------------------------------------
// action = list_versions
// -------------------------------------------------------------------------------------------------

async function actionListVersions(input: Extract<ParamsAny, { action: "list_versions" }>): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  try {
    const conn = await connFromAlias(input.target_org);
    const result = await listVersions(conn, input.agent_api_name);
    const lines = [
      `📋 Versions of ${result.agent_api_name} (bot_id ${result.bot_id})`,
      ...result.versions.map((v) => {
        const flag = v.status === "Active" ? "🟢" : "⚪";
        return `  ${flag} v${v.version_number} · ${v.status} · ${v.bot_version_id} · ${v.developer_name ?? ""}`;
      }),
    ];
    return toolOk({ ok: true as const, ...result }, lines.join("\n"));
  } catch (err) {
    return classifyLifecycleError(err, input.agent_api_name);
  }
}

// -------------------------------------------------------------------------------------------------
// Error classification
// -------------------------------------------------------------------------------------------------

function classifyLifecycleError(
  err: unknown,
  agentApiName: string,
): { content: { type: "text"; text: string }[]; details: ToolError } {
  const msg = err instanceof Error ? err.message : String(err);
  if (/not found/i.test(msg)) {
    return toolError(msg, "Use list_versions to see what's in the org.", {
      tool: LIFECYCLE_TOOL_NAME,
      params: { action: "list_versions", agent_api_name: agentApiName },
    });
  }
  return toolError(msg);
}
