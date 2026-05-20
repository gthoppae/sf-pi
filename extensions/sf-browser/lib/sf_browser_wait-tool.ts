/* SPDX-License-Identifier: Apache-2.0 */
/** Wait tool for Salesforce async UI rendering. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { DEFAULT_AGENT_BROWSER_TIMEOUT_MS } from "./constants.ts";
import { runAgentBrowser } from "./agent-browser.ts";
import { STALE_REF_HINT } from "./guidance.ts";
import { startTimer } from "./timing.ts";
import { okText } from "./tool-support.ts";

export const SF_BROWSER_WAIT_TOOL_NAME = "sf_browser_wait";

const LoadState = StringEnum(["domcontentloaded", "networkidle"] as const, {
  description: "Load state to wait for.",
});

export interface WaitClassification {
  ambiguous: boolean;
  label: string;
  note?: string;
}

export function classifyWait(durationMs: number, params: { ms?: number }): WaitClassification {
  if (typeof params.ms === "number") {
    return { ambiguous: false, label: "Wait finished" };
  }
  if (durationMs >= DEFAULT_AGENT_BROWSER_TIMEOUT_MS * 0.9) {
    return {
      ambiguous: true,
      label: "Wait may have timed out",
      note: "No hard error was returned, but the wait reached the timeout window. Snapshot or verify through API before continuing.",
    };
  }
  return { ambiguous: false, label: "Wait finished" };
}

export function registerSfBrowserWaitTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: SF_BROWSER_WAIT_TOOL_NAME,
    label: "SF Browser Wait",
    description:
      "Wait for Salesforce UI progress using expected text, URL pattern, load state, or a last-resort millisecond delay. Prefer text or URL over fixed sleeps; long waits are reported as ambiguous when they reach the timeout window.",
    promptSnippet: "Wait for Salesforce UI text, URL, load state, or last-resort delay",
    promptGuidelines: [
      "Use sf_browser_wait with expected text or URL after Salesforce actions; use ms only as a last resort for Lightning async rendering.",
      "If sf_browser_wait says the wait may have timed out, snapshot or verify through API before continuing.",
    ],
    parameters: Type.Object({
      text: Type.Optional(
        Type.String({ description: "Visible text to wait for, such as Saved or Success." }),
      ),
      url: Type.Optional(
        Type.String({ description: "URL glob to wait for, such as **/lightning/setup/**." }),
      ),
      load: Type.Optional(LoadState),
      ms: Type.Optional(Type.Number({ description: "Milliseconds to wait. Last resort only." })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const modeCount = [params.text, params.url, params.load, params.ms].filter(
        (value) => value !== undefined && value !== "",
      ).length;
      if (modeCount !== 1) {
        throw new Error("sf_browser_wait expects exactly one of text, url, load, or ms.");
      }

      const stopTimer = startTimer();
      const args = buildWaitArgs(params);
      await runAgentBrowser(pi, args, { cwd: ctx.cwd, signal });
      const duration = stopTimer();
      const classification = classifyWait(duration.durationMs, params);
      return {
        content: [
          {
            type: "text" as const,
            text: okText([
              `${classification.label}: ${describeWait(params)}.`,
              `Duration: ${duration.durationText}`,
              classification.note,
              "Prefer expected text or URL waits over fixed sleeps for Salesforce Lightning pages.",
              STALE_REF_HINT,
            ]),
          },
        ],
        details: { ok: true, ambiguous: classification.ambiguous, wait: params, ...duration },
      };
    },
  });
}

function buildWaitArgs(params: {
  text?: string;
  url?: string;
  load?: string;
  ms?: number;
}): string[] {
  if (params.text) return ["wait", "--text", params.text];
  if (params.url) return ["wait", "--url", params.url];
  if (params.load) return ["wait", "--load", params.load];
  return ["wait", String(Math.max(0, Math.floor(params.ms ?? 0)))];
}

function describeWait(params: { text?: string; url?: string; load?: string; ms?: number }): string {
  if (params.text) return `text ${JSON.stringify(params.text)}`;
  if (params.url) return `url ${JSON.stringify(params.url)}`;
  if (params.load) return `load ${params.load}`;
  return `${Math.max(0, Math.floor(params.ms ?? 0))}ms`;
}
