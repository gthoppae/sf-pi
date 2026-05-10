/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tool: agentscript_eval_resolve
 *
 * Resolve $active_bot_id / $active_bot_version_id / $active_planner_id from
 * the live org's Active BotVersion via Connection.query (no subprocess).
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { connFromAlias } from "../connection.ts";
import { resolveActiveIds } from "../eval/active-ids.ts";

export const EVAL_RESOLVE_TOOL_NAME = "agentscript_eval_resolve";

const Params = Type.Object({
  agent_api_name: Type.String({
    description: "Bot DeveloperName (e.g. 'My_Agent_v1').",
  }),
  target_org: Type.Optional(Type.String({ description: "sf CLI alias. Defaults to active org." })),
});

interface Input {
  agent_api_name: string;
  target_org?: string;
}

export function registerEvalResolveTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: EVAL_RESOLVE_TOOL_NAME,
    label: "Agent Script eval — resolve active ids",
    description:
      "Look up the Active BotVersion id, BotDefinition id, and matching planner id for an Agent in the target org. Use this to bake $active_* values into a spec, or to verify which version a regression run is hitting.",
    promptSnippet:
      "Resolve Active BotVersion id + planner id for an agent (used to materialize $active_* placeholders).",
    promptGuidelines: [
      "Always returns the *Active* version (not the latest draft). If no Active version exists, errors with a setup hint.",
      "Pass target_org when the agent lives in a different org than the active sf-pi default.",
    ],
    parameters: Params,
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const input = params as Input;
      try {
        const conn = await connFromAlias(input.target_org);
        const ids = await resolveActiveIds(conn, input.agent_api_name);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  agent_api_name: input.agent_api_name,
                  target_org: input.target_org ?? conn.getUsername() ?? "<default>",
                  bot_id: ids.bot_id,
                  bot_version_id: ids.bot_version_id,
                  version_number: ids.version_number,
                  planner_id: ids.planner_id,
                  $active_bot_id: ids.bot_id,
                  $active_bot_version_id: ids.bot_version_id,
                  $active_planner_id: ids.planner_id,
                },
                null,
                2,
              ),
            },
          ],
          details: { ok: true, ...ids },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(msg);
      }
    },
  });
}

function errorResult(message: string): {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
} {
  return {
    content: [{ type: "text", text: `❌ ${message}` }],
    details: { ok: false, error: message },
  };
}
