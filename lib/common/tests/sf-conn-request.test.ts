/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for `connRequest` body serialization.
 *
 * The contract under test:
 *   - object bodies   → `JSON.stringify` once (the common path)
 *   - string bodies   → passed through unchanged (caller already serialized)
 *   - undefined body  → omitted
 *
 * The string-passthrough rule is the bug fix: jsforce sends `request.body`
 * to the wire as-is, so re-stringifying a JSON string produced
 * `JSON_PARSER_ERROR: Value does not match expected type` on `/ssot/query-sql`.
 * That bit any caller (notably LLM tool inputs declared as `Type.Any()`)
 * that handed us an already-stringified body.
 */

import { describe, expect, test, vi } from "vitest";

import { connRequest, serializeBody } from "../sf-conn/request.ts";

describe("serializeBody", () => {
  test("returns undefined for undefined", () => {
    expect(serializeBody(undefined)).toBeUndefined();
  });

  test("passes string bodies through unchanged", () => {
    const body = '{"sql":"SELECT 1"}';
    expect(serializeBody(body)).toBe(body);
  });

  test("JSON-stringifies non-string values exactly once", () => {
    expect(serializeBody({ sql: "SELECT 1" })).toBe('{"sql":"SELECT 1"}');
    expect(serializeBody([1, 2, 3])).toBe("[1,2,3]");
    expect(serializeBody(null)).toBe("null");
    expect(serializeBody(0)).toBe("0");
  });
});

describe("connRequest body handling", () => {
  function fakeConn(spy: (req: { body?: unknown }) => unknown) {
    return {
      request: vi.fn(async (req: { body?: unknown }) => spy(req)),
    } as unknown as Parameters<typeof connRequest>[0];
  }

  test("forwards object bodies as a JSON string (not re-stringified)", async () => {
    const captured: Array<unknown> = [];
    const conn = fakeConn((req) => {
      captured.push(req.body);
      return { ok: true };
    });

    await connRequest(conn, {
      method: "POST",
      url: "/services/data/v66.0/ssot/query-sql",
      body: { sql: "SELECT 1" },
    });

    expect(captured).toEqual(['{"sql":"SELECT 1"}']);
  });

  test("forwards string bodies unchanged", async () => {
    const captured: Array<unknown> = [];
    const conn = fakeConn((req) => {
      captured.push(req.body);
      return { ok: true };
    });

    const raw = '{"sql":"SELECT 1"}';
    await connRequest(conn, {
      method: "POST",
      url: "/services/data/v66.0/ssot/query-sql",
      body: raw,
    });

    expect(captured).toEqual([raw]);
  });

  test("omits the body when undefined", async () => {
    const captured: Array<unknown> = [];
    const conn = fakeConn((req) => {
      captured.push(req.body);
      return { ok: true };
    });

    await connRequest(conn, {
      method: "GET",
      url: "/services/data/v66.0/ssot/data-spaces",
    });

    expect(captured).toEqual([undefined]);
  });
});
