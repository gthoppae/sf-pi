/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Server-error → actionable diagnostic mapping. Locks in the patterns that
 * most often confuse the LLM, with chain-able recover_via where possible.
 */

import { describe, expect, test } from "vitest";
import { mapPreviewError } from "../lib/preview/error-map.ts";

describe("mapPreviewError", () => {
  test("version-cache-miss → bundle-meta / publish hint", () => {
    const m = mapPreviewError(
      500,
      {
        message: "Attempted to retrieve bot version ID to insert into cache, but record not found",
      },
      { phase: "start", surface: "agent_file", agentName: "Hello_Bot" },
    );
    expect(m.matched).toBe("version-cache-miss");
    expect(m.message).toMatch(/agentVersion\.developerName|<target>/i);
    expect(m.message).toMatch(/v0|v1/);
  });

  test("session-not-found → recover_via start", () => {
    const m = mapPreviewError(
      500,
      { message: "V6Session not found for sessionId: xyz" },
      { phase: "send", surface: "api_name", agentApiName: "Bot" },
    );
    expect(m.matched).toBe("session-not-found");
    expect(m.recover_via).toEqual({
      tool: "agentscript_preview",
      params: { action: "start" },
    });
  });

  test("session-not-found also matches v1.1 wording", () => {
    const m = mapPreviewError(
      500,
      { message: "Session not found for sessionId: abc" },
      { phase: "send", surface: "agent_file" },
    );
    expect(m.matched).toBe("session-not-found");
  });

  test("invalid-user-id → Service vs Employee guidance", () => {
    const svc = mapPreviewError(
      400,
      { message: "Bad Request: Invalid user ID provided on start session: " },
      { phase: "start", surface: "api_name", agentApiName: "Bot" },
    );
    expect(svc.matched).toBe("invalid-user-id");
    expect(svc.message).toMatch(/sf org create agent-user/i);

    const emp = mapPreviewError(
      400,
      { message: "Bad Request: Invalid user ID provided on start session: " },
      { phase: "start", surface: "agent_file" },
    );
    expect(emp.matched).toBe("invalid-user-id");
    expect(emp.message).toMatch(/AgentforceEmployeeAgent/);
  });

  test("inactive-agent → activate recover_via", () => {
    const m = mapPreviewError(
      412,
      {
        message:
          '412 [{"errorCode":"PRECONDITION_FAILED","message":"No access to Einstein Copilot."}]',
      },
      { phase: "start", surface: "api_name", agentApiName: "My_Bot" },
    );
    expect(m.matched).toBe("inactive-agent");
    expect(m.recover_via).toEqual({
      tool: "agentscript_lifecycle",
      params: { action: "activate", agent_api_name: "My_Bot" },
    });
  });

  test("412 status alone (without the canonical message) still maps to inactive-agent", () => {
    const m = mapPreviewError(
      412,
      { message: "Some other 412" },
      { phase: "start", surface: "api_name", agentApiName: "X" },
    );
    expect(m.matched).toBe("inactive-agent");
  });

  test("sfap-404 → org not Agentforce-enabled hint", () => {
    const m = mapPreviewError(
      404,
      { errorCode: "ERROR_HTTP_404", message: "" },
      { phase: "start", surface: "agent_file" },
    );
    expect(m.matched).toBe("sfap-404");
    expect(m.message).toMatch(/Agentforce-enabled/);
  });

  test("bootstrap-failed → JWT scopes hint", () => {
    const m = mapPreviewError(
      401,
      { message: "Agent API auth bootstrap failed at /agentforce/bootstrap/nameduser" },
      { phase: "start", surface: "agent_file" },
    );
    expect(m.matched).toBe("bootstrap-failed");
    expect(m.message).toMatch(/sfap_api/);
  });

  test("unknown errors pass through verbatim with matched=null", () => {
    const m = mapPreviewError(
      500,
      { message: "Some new server error we haven't seen before" },
      { phase: "send", surface: "agent_file" },
    );
    expect(m.matched).toBeNull();
    expect(m.message).toMatch(/HTTP 500/);
    expect(m.message).toMatch(/new server error/);
    expect(m.recover_via).toBeUndefined();
  });

  test("string body is handled (some routes return text/plain)", () => {
    const m = mapPreviewError(500, "V6Session not found for sessionId: abc", {
      phase: "send",
      surface: "api_name",
    });
    expect(m.matched).toBe("session-not-found");
  });

  test("null/empty body still produces a non-empty message", () => {
    const m = mapPreviewError(500, null, { phase: "start", surface: "agent_file" });
    expect(m.matched).toBeNull();
    expect(m.message).toBeTruthy();
  });
});
