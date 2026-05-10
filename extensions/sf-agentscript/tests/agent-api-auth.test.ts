/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for the named-user JWT bootstrap required by /einstein/ai-agent/* routes. */

import { describe, expect, test, vi } from "vitest";
import { upgradeConnectionToNamedUserJwt } from "../lib/agent-api-auth.ts";

const JWT = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1aWQ6MDA1In0.signature";

function fakeConn(opts?: { token?: string; instanceUrl?: string; response?: unknown }) {
  const conn = {
    accessToken: opts?.token ?? "00Dxx!opaque-org-token",
    refreshed: false,
    calls: [] as Array<{ url: string; headers?: Record<string, string> }>,
    getAuthInfoFields: () => ({ refreshToken: "refresh" }),
    refreshAuth: vi.fn(async () => {
      conn.refreshed = true;
    }),
    getConnectionOptions: () => ({
      accessToken: conn.accessToken,
      instanceUrl: opts?.instanceUrl ?? "https://example.my.salesforce.com",
    }),
    request: vi.fn(async (req: { url: string; headers?: Record<string, string> }) => {
      conn.calls.push(req);
      return opts?.response ?? { access_token: JWT };
    }),
  };
  return conn;
}

describe("upgradeConnectionToNamedUserJwt", () => {
  test("calls /agentforce/bootstrap/nameduser with sid cookie and installs returned JWT", async () => {
    const conn = fakeConn();
    await upgradeConnectionToNamedUserJwt(conn as never);

    expect(conn.refreshAuth).toHaveBeenCalledTimes(1);
    expect(conn.calls).toHaveLength(1);
    expect(conn.calls[0].url).toBe(
      "https://example.my.salesforce.com/agentforce/bootstrap/nameduser",
    );
    expect(conn.calls[0].headers?.Cookie).toBe("sid=00Dxx!opaque-org-token");
    expect(conn.accessToken).toBe(JWT);
  });

  test("rejects non-JWT bootstrap responses with a scopes hint", async () => {
    const conn = fakeConn({ response: { access_token: "not-a-jwt" } });
    await expect(upgradeConnectionToNamedUserJwt(conn as never)).rejects.toThrow(/sfap_api/);
  });

  test("fails fast when the org connection has no access token", async () => {
    const conn = fakeConn({ token: "" });
    await expect(upgradeConnectionToNamedUserJwt(conn as never)).rejects.toThrow(
      /missing org access token/,
    );
  });
});
