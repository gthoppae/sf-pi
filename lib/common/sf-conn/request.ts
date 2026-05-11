/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Thin wrapper around `Connection.request` that returns `{ status, body }`
 * instead of throwing on HTTP errors. Mirrors the contract of the SFAP
 * client in `extensions/sf-agentscript/lib/eval/sfap.ts` for non-SFAP
 * (instance-URL) routes.
 *
 * The auto-refreshing token, retry on 5xx, and JSON parse all live inside
 * `Connection`; callers just see a typed body and a status. 4xx responses
 * surface as `{ status, body }` too — this helper never raises for HTTP.
 *
 * Example:
 *   const conn = await connFromAlias(targetOrg);
 *   const resp = await connRequest<DmoListResponse>(conn, {
 *     method: "GET",
 *     url: "/services/data/v66.0/ssot/data-model-objects?limit=1",
 *   });
 *   if (resp.status >= 400) … else use resp.body …
 */

import type { Connection } from "@salesforce/core";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface ConnRequest {
  method: HttpMethod;
  /** Path relative to instance URL (e.g. `/services/data/v66.0/...`) or absolute URL. */
  url: string;
  /** Request body. JSON-serialized internally; pass undefined to omit. */
  body?: unknown;
  /** Custom headers. Defaults to `Content-Type: application/json` + `Accept: application/json`. */
  headers?: Record<string, string>;
  /** Per-call timeout in ms. Default 120_000. */
  timeoutMs?: number;
}

export interface ConnResponse<T> {
  /** HTTP status. 200 on success path; 4xx/5xx for errors. */
  status: number;
  /** Parsed JSON body on success; `{ errorCode, message, name }` shape on error. */
  body: T;
}

/**
 * Single HTTP call via `Connection.request`. Never throws on HTTP errors.
 *
 * jsforce auto-refreshes auth, parses JSON responses, and follows the
 * Connection's instance URL. We layer "HTTP errors are data, not exceptions"
 * on top so call sites can write linear code.
 */
export async function connRequest<T = unknown>(
  conn: Connection,
  req: ConnRequest,
): Promise<ConnResponse<T>> {
  const headers = req.headers ?? {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const timeout = req.timeoutMs ?? 120_000;

  try {
    const body = await conn.request<T>({
      method: req.method,
      url: req.url,
      headers,
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      timeout,
    } as Parameters<typeof conn.request>[0]);
    return { status: 200, body };
  } catch (err) {
    return { status: inferStatus(err), body: errorAsBody(err) as T };
  }
}

/**
 * Pull an HTTP status code out of whatever jsforce/Connection threw.
 *
 * Status sometimes lives on `statusCode`, sometimes embedded in the message
 * (`"Error 404: …"`), sometimes nowhere. Mirrors the equivalent in
 * `extensions/sf-agentscript/lib/eval/sfap.ts` so the two wrappers behave
 * the same way.
 */
function inferStatus(err: unknown): number {
  const e = err as Record<string, unknown> | null;
  if (!e || typeof e !== "object") return 500;

  const direct = e.statusCode;
  if (typeof direct === "number" && direct >= 100 && direct < 600) return direct;

  const message = typeof e.message === "string" ? e.message : "";
  const errorCode = typeof e.errorCode === "string" ? e.errorCode : "";
  const name = typeof e.name === "string" ? e.name : "";
  const blob = `${message} ${errorCode} ${name}`;

  const match = /\b(\d{3})\b/.exec(blob);
  if (match) {
    const n = parseInt(match[1], 10);
    if (n >= 100 && n < 600) return n;
  }

  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EAI_AGAIN/i.test(blob)) return 503;
  if (/auth|token|expired|refresh|unauthorized/i.test(blob)) return 401;

  return 500;
}

function errorAsBody(err: unknown): unknown {
  const e = err as Record<string, unknown> | null;
  if (!e) return {};
  return {
    errorCode: e.errorCode,
    message: e.message,
    name: e.name,
  };
}
