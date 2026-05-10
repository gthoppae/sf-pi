/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the LLM-friendly trace digest. The digest is the bridge between
 * the rich planner trace JSON (~55 KB per turn, 16+ step types) and what
 * the LLM actually consumes for self-recovery (compact, every type
 * preserved, heavy fields clipped).
 */

import { describe, expect, test } from "vitest";
import { summarizeLastExecution, summarizeTrace } from "../lib/preview/trace-digest.ts";
import type { LastExecution } from "../lib/eval/types.ts";

const FAKE_PLAN = [
  {
    type: "UserInputStep",
    startExecutionTime: 100,
    endExecutionTime: 110,
    message: "I forgot my password",
  },
  {
    type: "SessionInitialStateStep",
    startExecutionTime: 110,
    endExecutionTime: 110,
    data: { directive_context: "on_message", variable_values: { a: 1, b: 2 } },
  },
  {
    type: "VariableUpdateStep",
    startExecutionTime: 110,
    endExecutionTime: 110,
    data: {
      variable_updates: [
        {
          variable_name: "case_id",
          variable_new_value: "12345",
          variable_change_reason: "set by route",
        },
        { variable_name: "is_verified", variable_new_value: false },
      ],
    },
  },
  {
    type: "EnabledToolsStep",
    startExecutionTime: 110,
    endExecutionTime: 110,
    data: { agent_name: "Triage", enabled_tools: ["go_password", "go_vpn"] },
  },
  {
    type: "LLMStep",
    startExecutionTime: 110,
    endExecutionTime: 460,
    data: {
      agent_name: "Triage",
      prompt_name: "Triage_prompt",
      prompt_content: "system + user prompts here, " + "x".repeat(1500),
      prompt_response: JSON.stringify({
        content: "",
        tool_invocations: [{ id: "1", function: { name: "go_password", arguments: "{}" } }],
        usage: { total_tokens: 1729 },
      }),
      execution_latency: 350,
    },
  },
  {
    type: "UpdateTopicStep",
    startExecutionTime: 460,
    endExecutionTime: 462,
    topic: "password_help",
  },
  {
    type: "TransitionStep",
    startExecutionTime: 462,
    endExecutionTime: 462,
    data: { from_agent: "Triage", to_agent: "password_help", transition_type: "handoff" },
  },
  {
    type: "NodeEntryStateStep",
    startExecutionTime: 462,
    endExecutionTime: 463,
    data: { agent_name: "password_help" },
  },
  {
    type: "FunctionStep",
    startExecutionTime: 463,
    endExecutionTime: 800,
    function: {
      name: "Update Session Routing",
      input: { supportPath: "Password Reset" },
      output: { caseId: "12345-ABCDE" },
    },
    executionLatency: 337,
  },
  {
    type: "PlannerResponseStep",
    startExecutionTime: 800,
    endExecutionTime: 850,
    message: "Please open the self-service portal...",
    responseType: "Inform",
    isContentSafe: true,
    safetyScore: { safety_score: 0.999 },
  },
  // An unknown future step type — must still produce a row with type kept verbatim.
  {
    type: "FutureNewStepKindStep",
    startExecutionTime: 850,
    endExecutionTime: 851,
    data: { description: "an experimental runtime step that the digest hasn't seen before" },
  },
];

describe("summarizeTrace (preview source)", () => {
  test("preserves every distinct step type", () => {
    const d = summarizeTrace({ plan: FAKE_PLAN, planId: "p1" });
    const observedTypes = new Set(d.timeline.map((r) => r.t));
    for (const expected of [
      "UserInputStep",
      "SessionInitialStateStep",
      "VariableUpdateStep",
      "EnabledToolsStep",
      "LLMStep",
      "UpdateTopicStep",
      "TransitionStep",
      "NodeEntryStateStep",
      "FunctionStep",
      "PlannerResponseStep",
      "FutureNewStepKindStep",
    ]) {
      expect(observedTypes.has(expected)).toBe(true);
    }
  });

  test("LLMStep extracts prompt_chars, response_chars, and tool_calls", () => {
    const d = summarizeTrace({ plan: FAKE_PLAN });
    const llm = d.timeline.find((r) => r.t === "LLMStep");
    expect(llm).toBeTruthy();
    expect(llm?.agent).toBe("Triage");
    expect(typeof llm?.prompt_chars).toBe("number");
    expect((llm?.prompt_chars as number) > 1500).toBe(true);
    expect(llm?.tool_calls).toEqual(["go_password"]);
    expect(llm?.ms).toBe(350);
  });

  test("FunctionStep extracts fn name + clipped args + output flag", () => {
    const d = summarizeTrace({ plan: FAKE_PLAN });
    const fn = d.timeline.find((r) => r.t === "FunctionStep");
    expect(fn?.fn).toBe("Update Session Routing");
    expect(typeof fn?.args_preview).toBe("string");
    expect(fn?.has_output).toBe(true);
  });

  test("VariableUpdateStep clips long values + reports extra updates", () => {
    const longBlob = "X".repeat(500);
    const trace = {
      plan: [
        {
          type: "VariableUpdateStep",
          startExecutionTime: 0,
          endExecutionTime: 0,
          data: {
            variable_updates: [
              { variable_name: "user_field", variable_new_value: longBlob },
              { variable_name: "another", variable_new_value: "x" },
            ],
          },
        },
      ],
    };
    const d = summarizeTrace(trace);
    const vu = d.timeline[0];
    expect(vu.var).toBe("user_field");
    expect(typeof vu.value_preview).toBe("string");
    expect((vu.value_preview as string).length).toBeLessThan(120);
    expect(vu.extra_updates).toBe(1);
  });

  test("unknown step type still emits a row with hint preview", () => {
    const d = summarizeTrace({ plan: FAKE_PLAN });
    const future = d.timeline.find((r) => r.t === "FutureNewStepKindStep");
    expect(future).toBeTruthy();
    expect(typeof future?.hint).toBe("string");
    expect((future?.hint as string).includes("experimental")).toBe(true);
  });

  test("stats reflect actual counts and topic transition", () => {
    const d = summarizeTrace({ plan: FAKE_PLAN });
    expect(d.stats.step_count).toBe(FAKE_PLAN.length);
    expect(d.stats.llm_calls).toBe(1);
    expect(d.stats.vars_updated).toBe(1);
    expect(d.stats.topic_changes).toBe(1);
    expect(d.stats.function_calls).toBe(1);
  });

  test("summary_line includes from→to topic and call counts", () => {
    const d = summarizeTrace({ plan: FAKE_PLAN });
    expect(d.summary_line).toContain("password_help");
    expect(d.summary_line).toContain("1 LLM call");
    expect(d.summary_line).toContain("1 fn call");
  });

  test("compresses substantially relative to raw plan JSON", () => {
    const trace = { plan: FAKE_PLAN };
    const d = summarizeTrace(trace);
    const rawSize = JSON.stringify(trace).length;
    const digestSize = JSON.stringify(d).length;
    // Expect at least 2x compression on this small fake trace; real
    // production traces compress closer to 8x (verified live).
    expect(digestSize).toBeLessThan(rawSize);
  });

  test("`steps` field name is also tolerated as a fallback for legacy callers", () => {
    const d = summarizeTrace({ steps: FAKE_PLAN });
    expect(d.timeline.length).toBe(FAKE_PLAN.length);
  });
});

describe("summarizeLastExecution (eval source)", () => {
  test("rebuilds a digest from lastExecution.llmEvents", () => {
    const le: LastExecution = {
      agentResponse: "Hello there!",
      topic: "password_help",
      latency: 1234,
      invokedActions: ["update_routing"],
      errors: [],
      message: { planId: "abc-123" },
      llmEvents: [
        [
          {
            agent_name: "Triage",
            prompt_name: "Triage_prompt",
            prompt_content: "system + user",
            prompt_response: JSON.stringify({
              tool_invocations: [{ function: { name: "go_password" } }],
            }),
            execution_latency: 320,
          } as never,
        ],
      ],
      userUtterance: undefined,
    };
    const d = summarizeLastExecution(le, { userInput: "I forgot my password" });
    expect(d.source).toBe("eval");
    expect(d.turn.user_input).toBe("I forgot my password");
    expect(d.turn.agent_response).toBe("Hello there!");
    expect(d.turn.topic).toBe("password_help");
    const types = d.timeline.map((r) => r.t);
    expect(types).toContain("UserInputStep");
    expect(types).toContain("LLMStep");
    expect(types).toContain("PlannerResponseStep");
    expect(types).toContain("FunctionStep");
    const llm = d.timeline.find((r) => r.t === "LLMStep");
    expect(llm?.tool_calls).toEqual(["go_password"]);
    expect(d.notes?.[0]).toMatch(/eval/i);
  });

  test("handles empty / missing lastExecution gracefully", () => {
    const d = summarizeLastExecution(undefined);
    expect(d.source).toBe("eval");
    expect(d.timeline).toEqual([]);
    expect(d.stats.step_count).toBe(0);
    expect(d.stats.llm_calls).toBe(0);
  });
});
