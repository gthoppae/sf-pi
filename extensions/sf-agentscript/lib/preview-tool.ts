/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tool: agentscript_preview — multi-action live-org preview surface.
 *
 * Wraps the lib/preview/* client. Streams progress on send. Sessions live
 * under .sfdx/agents/<agentName>/sessions/<sessionId>/ (Salesforce-standard;
 * sf-guardrail allows .sfdx/agents/** specifically).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { connFromAlias } from "./connection.ts";
import {
  cleanupSessions,
  endPreview,
  loadSession,
  sendMessage,
  startPreview,
} from "./preview/client.ts";
import { fetchTrace } from "./eval/trace-client.ts";
import { isAgentScriptFile, resolveToolPath } from "./file-classify.ts";
import { toolError, toolOk, type ToolError } from "./tool-types.ts";

export const PREVIEW_TOOL_NAME = "agentscript_preview";

const Params = Type.Union([
  // start
  Type.Object({
    action: Type.Literal("start"),
    target_org: Type.Optional(Type.String()),
    agent_file: Type.String({
      description: "Path to a `.agent` file. Local-compiled before the server call.",
    }),
    agent_name: Type.Optional(
      Type.String({
        description:
          "Display name used as the on-disk session-store agent folder. Defaults to the basename of agent_file.",
      }),
    ),
    mock_mode: Type.Optional(Type.Union([Type.Literal("Mock"), Type.Literal("Live Test")])),
  }),
  // send
  Type.Object({
    action: Type.Literal("send"),
    target_org: Type.Optional(Type.String()),
    agent_name: Type.String(),
    session_id: Type.String(),
    message: Type.String(),
  }),
  // end
  Type.Object({
    action: Type.Literal("end"),
    agent_name: Type.String(),
    session_id: Type.String(),
  }),
  // trace
  Type.Object({
    action: Type.Literal("trace"),
    target_org: Type.Optional(Type.String()),
    session_id: Type.String(),
    plan_id: Type.String(),
  }),
  // cleanup
  Type.Object({
    action: Type.Literal("cleanup"),
    older_than_days: Type.Optional(Type.Number({ minimum: 0 })),
    dry_run: Type.Optional(Type.Boolean()),
  }),
]);

type ParamsAny =
  | {
      action: "start";
      target_org?: string;
      agent_file: string;
      agent_name?: string;
      mock_mode?: "Mock" | "Live Test";
    }
  | { action: "send"; target_org?: string; agent_name: string; session_id: string; message: string }
  | { action: "end"; agent_name: string; session_id: string }
  | { action: "trace"; target_org?: string; session_id: string; plan_id: string }
  | { action: "cleanup"; older_than_days?: number; dry_run?: boolean };

type StreamPartial = { content: { type: "text"; text: string }[]; details: never };
type OnUpdateFn = (partial: StreamPartial) => void;

export function registerPreviewTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: PREVIEW_TOOL_NAME,
    label: "Agent Script preview",
    description:
      "Multi-action live-org preview: start a session for a `.agent` file, send messages, end, or fetch a trace. Sessions stored under .sfdx/agents/<id>/sessions/<sid>/. cleanup removes stale sessions.",
    promptSnippet:
      "Run a single .agent conversation against the live org with full trace capture per turn.",
    promptGuidelines: [
      "action='start' — local-compiles the .agent file first; only hits /authoring/scripts on success. Returns session_id and the initial agent message.",
      "action='send' — POSTs one user utterance, fetches the planner trace per turn, returns topic + invoked_actions when available, and writes everything to the session store.",
      "action='end' — finalizes metadata (sets endTime).",
      "action='trace' — ad-hoc trace fetch by (session_id, plan_id) when you need to revisit a specific turn.",
      "action='cleanup' — removes session dirs older than older_than_days (default 30). Use dry_run=true to see what would be deleted.",
    ],
    parameters: Params,
    async execute(_id, params, _signal, onUpdate, ctx) {
      const p = params as ParamsAny;
      switch (p.action) {
        case "start":
          return await actionStart(ctx, p);
        case "send":
          return await actionSend(ctx, p, onUpdate);
        case "end":
          return await actionEnd(ctx, p);
        case "trace":
          return await actionTrace(p);
        case "cleanup":
          return await actionCleanup(ctx, p);
      }
    },
  });
}

// -------------------------------------------------------------------------------------------------
// action = start
// -------------------------------------------------------------------------------------------------

async function actionStart(
  ctx: ExtensionContext,
  input: Extract<ParamsAny, { action: "start" }>,
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
  const agentName = input.agent_name ?? path.basename(filePath, ".agent");

  try {
    const conn = await connFromAlias(input.target_org);
    const result = await startPreview({
      conn,
      cwd: ctx.cwd,
      agentName,
      agentSource: source,
      mockMode: input.mock_mode ?? "Mock",
    });
    return toolOk(
      {
        ok: true as const,
        session_id: result.sessionId,
        agent_response: result.agentResponse,
        started_at: result.startedAt,
        session_dir: result.sessionDir,
        agent_name: agentName,
      },
      `🎬 Preview started · session ${result.sessionId.slice(0, 8)}…\n${result.agentResponse}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Local compile rejected")) {
      return toolError(msg, undefined, {
        tool: "agentscript_compile",
        params: { path: filePath },
      });
    }
    return toolError(msg);
  }
}

// -------------------------------------------------------------------------------------------------
// action = send
// -------------------------------------------------------------------------------------------------

async function actionSend(
  ctx: ExtensionContext,
  input: Extract<ParamsAny, { action: "send" }>,
  onUpdate?: OnUpdateFn,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
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
  stream("Sending message…");

  try {
    const conn = await connFromAlias(input.target_org);
    const result = await sendMessage({
      conn,
      cwd: ctx.cwd,
      agentName: input.agent_name,
      sessionId: input.session_id,
      message: input.message,
    });
    stream("Trace captured");
    return toolOk(
      {
        ok: true as const,
        agent_response: result.agentResponse,
        topic: result.topic,
        invoked_actions: result.invokedActions,
        latency_ms: result.latencyMs,
        plan_id: result.planId,
        trace_file: result.traceFile,
      },
      [
        `🤖 ${result.agentResponse}`,
        result.topic ? `topic: ${result.topic}` : null,
        result.invokedActions?.length ? `actions: ${result.invokedActions.join(", ")}` : null,
        `latency=${result.latencyMs}ms · plan=${result.planId.slice(0, 8)}…`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
}

// -------------------------------------------------------------------------------------------------
// action = end
// -------------------------------------------------------------------------------------------------

async function actionEnd(
  ctx: ExtensionContext,
  input: Extract<ParamsAny, { action: "end" }>,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  try {
    const result = await endPreview({
      cwd: ctx.cwd,
      agentName: input.agent_name,
      sessionId: input.session_id,
    });
    return toolOk(
      {
        ok: true as const,
        ended_at: result.endedAt,
        summary: result.summary,
        metadata: result.metadata,
      },
      `🏁 session ${input.session_id.slice(0, 8)}… ended (${result.summary.turns} turns, ${result.summary.plans} plans)`,
    );
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
}

// -------------------------------------------------------------------------------------------------
// action = trace
// -------------------------------------------------------------------------------------------------

async function actionTrace(input: Extract<ParamsAny, { action: "trace" }>): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  try {
    const conn = await connFromAlias(input.target_org);
    const trace = await fetchTrace(conn, input.session_id, input.plan_id);
    if (trace == null) {
      return toolError(
        `Trace not found for session=${input.session_id} plan=${input.plan_id}.`,
        "Confirm both ids and that the session is still resident on the planner.",
      );
    }
    return toolOk({
      ok: true as const,
      session_id: input.session_id,
      plan_id: input.plan_id,
      trace_hint:
        "PlannerResponse with steps[]: UserInputStep, UpdateTopicStep, " +
        "LLMExecutionStep (promptContent, promptResponse, executionLatency), " +
        "FunctionCallStep, ValidationPromptStep, EventStep.",
      trace,
    });
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
}

// -------------------------------------------------------------------------------------------------
// action = cleanup
// -------------------------------------------------------------------------------------------------

async function actionCleanup(
  ctx: ExtensionContext,
  input: Extract<ParamsAny, { action: "cleanup" }>,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const days = input.older_than_days ?? 30;
  const dryRun = input.dry_run ?? false;
  try {
    const result = await cleanupSessions(ctx.cwd, days, dryRun);
    return toolOk(
      {
        ok: true as const,
        older_than_days: days,
        dry_run: dryRun,
        removed: result.removed,
        kept_count: result.kept_count,
      },
      `🧹 cleanup: ${dryRun ? "would remove" : "removed"} ${result.removed.length} session(s) older than ${days} day(s); kept ${result.kept_count}.`,
    );
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
}

// Allow the unused-import linter to keep loadSession for downstream readers.
void loadSession;
