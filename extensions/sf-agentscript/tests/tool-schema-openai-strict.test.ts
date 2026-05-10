/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Regression: every registered tool's parameter schema must be OpenAI
 * strict-tool-call compatible.
 *
 * The strict validator (used by gpt-5.x and other OpenAI-compatible upstreams
 * via LiteLLM) rejects any tool whose root schema isn't `{type:"object",
 * properties:{...non-empty}}`. Specifically it errors with:
 *
 *   Invalid schema for function 'X': schema must be a JSON Schema of
 *   'type: "object"', got 'type: "None"'
 *
 * That happens when `Params = Type.Union([Type.Object({...}), ...])` is used
 * for multi-action tools \u2014 TypeBox emits a root `anyOf`, not a root
 * `type: "object"`. This test pins the contract that each tool's emitted
 * schema satisfies the OpenAI strict shape.
 */
import { describe, expect, test } from "vitest";
import { registerCompileTool } from "../lib/compile-tool.ts";
import { registerCreateTool } from "../lib/create-tool.ts";
import { registerEvalTool } from "../lib/eval-tool.ts";
import { registerInspectTool } from "../lib/inspect-tool.ts";
import { registerLifecycleTool } from "../lib/lifecycle-tool.ts";
import { registerMutateTool } from "../lib/mutate-tool.ts";
import { registerPreviewTool } from "../lib/preview-tool.ts";

interface CapturedTool {
  name: string;
  parameters: unknown;
}

function captureRegistrations(): {
  pi: { registerTool: (def: { name: string; parameters: unknown }) => void };
  tools: CapturedTool[];
} {
  const tools: CapturedTool[] = [];
  const pi = {
    registerTool: (def: { name: string; parameters: unknown }) => {
      tools.push({ name: def.name, parameters: def.parameters });
    },
  };
  return { pi, tools };
}

describe("Every sf-agentscript tool emits an OpenAI-strict-compatible schema", () => {
  const { pi, tools } = captureRegistrations();

  const fakePi = pi as any;
  registerCompileTool(fakePi);
  registerCreateTool(fakePi);
  registerInspectTool(fakePi);
  registerMutateTool(fakePi);
  registerPreviewTool(fakePi);
  registerEvalTool(fakePi);
  registerLifecycleTool(fakePi);

  test("registers exactly the 7 tools we expect", () => {
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "agentscript_compile",
        "agentscript_create",
        "agentscript_eval",
        "agentscript_inspect",
        "agentscript_lifecycle",
        "agentscript_mutate",
        "agentscript_preview",
      ].sort(),
    );
  });

  for (const t of tools) {
    test(`${t.name}: root schema has type:"object" with non-empty properties`, () => {
      const s = t.parameters as Record<string, unknown>;
      expect(s).toBeTruthy();
      expect(s.type).toBe("object");
      // The two failure modes that triggered the live OpenAI 400:
      //   - root anyOf (Type.Union of objects)
      //   - root oneOf (alternative TypeBox path)
      expect(s.anyOf).toBeUndefined();
      expect(s.oneOf).toBeUndefined();
      const properties = s.properties as Record<string, unknown> | undefined;
      expect(properties).toBeTruthy();
      expect(Object.keys(properties ?? {}).length).toBeGreaterThan(0);
    });

    test(`${t.name}: action discriminator (when present) is a string enum`, () => {
      const s = t.parameters as { properties?: Record<string, Record<string, unknown>> };
      const disc = s.properties?.action ?? s.properties?.op;
      // create-tool doesn't have an action discriminator (single-action tool).
      if (!disc) return;
      // Either {type:"string"} (e.g. plain string) or {anyOf:[{const:...}]}
      // (TypeBox Type.Union of literals). Both are OpenAI-compatible.
      const isString = disc.type === "string";
      const isUnion =
        Array.isArray(disc.anyOf) &&
        disc.anyOf.every(
          (m: unknown) =>
            typeof m === "object" &&
            m !== null &&
            (m as Record<string, unknown>).const !== undefined,
        );
      expect(
        isString || isUnion,
        `${t.name}: discriminator is neither string nor const-union`,
      ).toBe(true);
    });
  }
});
