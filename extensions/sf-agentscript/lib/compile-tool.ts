/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tool: agentscript_compile
 *
 * Local-first parser + compiler over a `.agent` file using the vendored
 * `@agentscript/agentforce` SDK. Returns severity-1 errors, actionable
 * severity-2 warnings, and AST-safe `apply_via` recovery hints on each
 * quick fix so the LLM can route directly to `agentscript_mutate`.
 *
 * No network, no auth required for the default path. The optional
 * `fallback: 'server'` flag is reserved for the future server-compile
 * fallback (deferred).
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { checkAgentScriptFile } from "./diagnostics.ts";
import { isAgentScriptFile, resolveToolPath } from "./file-classify.ts";
import { toolError, toolOk } from "./tool-types.ts";
import type { AgentScriptQuickFix } from "./types.ts";

export const COMPILE_TOOL_NAME = "agentscript_compile";

const Params = Type.Object({
  path: Type.String({
    description: "Absolute or workspace-relative path to a `.agent` file.",
  }),
  fallback: Type.Optional(
    Type.Union([Type.Literal("none"), Type.Literal("server")], {
      description:
        "Default 'none' (local only). 'server' is reserved for the future server-compile fallback (currently no-op; local always runs).",
    }),
  ),
});

interface Input {
  path: string;
  fallback?: "none" | "server";
}

interface QuickFixView extends AgentScriptQuickFix {
  /**
   * AST-safe recovery hint: how to apply this fix via agentscript_mutate.
   * The LLM's preferred path — survives whitespace drift and auto-recompiles.
   */
  apply_via: {
    tool: "agentscript_mutate";
    params: {
      op: "apply_quick_fix";
      path: string;
      diagnostic_code: string;
      line: number;
      fix_index: number;
    };
  };
}

export function registerCompileTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: COMPILE_TOOL_NAME,
    label: "Agent Script — compile",
    description:
      "Local-first compile of a `.agent` file via the vendored Agentforce SDK. Returns severity-1 errors, actionable severity-2 warnings, and quick fixes with apply_via tool calls so you can route diagnostic-driven fixes directly to agentscript_mutate (AST-safe + auto-recompile).",
    promptSnippet:
      "Parse and compile a .agent file locally and return diagnostics + agentscript_mutate-ready quick fixes.",
    promptGuidelines: [
      "Local-first: no network, no auth. Runs in ~10ms via the vendored SDK.",
      "Each quick_fix carries `apply_via: {tool: 'agentscript_mutate', params: {op: 'apply_quick_fix', ...}}` — prefer that path over the generic `edit` tool. It's AST-safe and auto-recompiles in the same turn.",
      "Severity 1 errors always surface; severity 2 only when the SDK ships a deterministic fix (deprecated-field, unused-variable, invalid-version, unknown-dialect, invalid-modifier, unknown-type).",
      "When the SDK is unavailable, returns `ok:false` with `recover_via` pointing at /sf-agentscript doctor.",
    ],
    parameters: Params,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const input = params as Input;
      const filePath = resolveToolPath(input.path, ctx.cwd);
      if (!isAgentScriptFile(filePath)) {
        return toolError(
          `Not an Agent Script file: ${filePath}`,
          "Pass a path ending in `.agent`.",
        );
      }
      const result = await checkAgentScriptFile(filePath);
      if (!result.ok) {
        return toolError(
          `Agent Script SDK unavailable: ${result.unavailableReason ?? "unknown reason"}.`,
          "Run /sf-agentscript doctor to diagnose the vendored bundle.",
          { tool: "sf-agentscript", params: { action: "doctor" } },
        );
      }

      // Index quick fixes by (line, code) so we can compute fix_index per
      // diagnostic — matches what agentscript_mutate apply_quick_fix expects.
      const fixesByKey = new Map<string, AgentScriptQuickFix[]>();
      for (const f of result.quickFixes) {
        const key = `${f.diagnosticLine}::${f.diagnosticCode ?? ""}`;
        const arr = fixesByKey.get(key);
        if (arr) arr.push(f);
        else fixesByKey.set(key, [f]);
      }
      const quickFixesView: QuickFixView[] = result.quickFixes.map((f) => {
        const key = `${f.diagnosticLine}::${f.diagnosticCode ?? ""}`;
        const arr = fixesByKey.get(key) ?? [f];
        const fixIndex = arr.indexOf(f);
        return {
          ...f,
          apply_via: {
            tool: "agentscript_mutate" as const,
            params: {
              op: "apply_quick_fix" as const,
              path: filePath,
              diagnostic_code: f.diagnosticCode ?? "",
              line: f.diagnosticLine + 1, // tool API is 1-based
              fix_index: fixIndex,
            },
          },
        };
      });

      const summary = {
        ok: true as const,
        path: filePath,
        clean: result.diagnostics.length === 0,
        diagnostic_count: result.diagnostics.length,
        quick_fix_count: quickFixesView.length,
        dialect: result.dialect ?? null,
        compiled_via: "local" as const,
      };
      const summaryText =
        result.diagnostics.length === 0
          ? `✓ ${filePath} compiles clean (${result.dialect?.name ?? "unknown dialect"})`
          : `❌ ${filePath} — ${result.diagnostics.length} issue(s), ${quickFixesView.length} fix(es) ready`;

      return toolOk(
        {
          ...summary,
          diagnostics: result.diagnostics,
          quick_fixes: quickFixesView,
        },
        summaryText,
      );
    },
  });
}
