/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Named-user JWT bootstrap for Einstein AI Agent SFAP endpoints.
 *
 * The normal sf CLI org token is sufficient for instance REST, SOQL, Connect,
 * and the Evaluation API, but `/einstein/ai-agent/*` routes require a JWT
 * minted by the org-local Agentforce bootstrap endpoint:
 *
 *   GET {instanceUrl}/agentforce/bootstrap/nameduser
 *   Cookie: sid={orgAccessToken}
 *
 * This mirrors the hidden auth step used by Salesforce's `sf agent preview`
 * implementation without importing `@salesforce/agents` at runtime.
 */

import { AuthInfo, Connection, type Connection as ConnectionType } from "@salesforce/core";
import { connFromAlias } from "./connection.ts";

export interface AgentApiAuthResult {
  conn: ConnectionType;
  username: string;
  instanceUrl: string;
  tokenKind: "named-user-jwt";
}

interface BootstrapResponse {
  access_token?: string;
}

function isJwt(token: string): boolean {
  return token.split(".").length === 3;
}

/**
 * Upgrade a connection to the named-user JWT expected by `/einstein/ai-agent/*`.
 * Mutates only the supplied connection. Callers that need to keep a normal org
 * token should pass an isolated connection (see `connForAgentApi`).
 */
export async function upgradeConnectionToNamedUserJwt(
  conn: ConnectionType,
): Promise<ConnectionType> {
  const authFields = conn.getAuthInfoFields?.() as { refreshToken?: string } | undefined;
  if (authFields?.refreshToken) {
    try {
      await conn.refreshAuth();
    } catch (err) {
      throw new Error(
        `Agent API auth bootstrap failed while refreshing org auth: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }

  const opts = conn.getConnectionOptions() as { accessToken?: string; instanceUrl?: string };
  const accessToken = opts.accessToken;
  const instanceUrl = opts.instanceUrl;
  if (!instanceUrl) throw new Error("Agent API auth bootstrap failed: missing instanceUrl.");
  if (!accessToken) throw new Error("Agent API auth bootstrap failed: missing org access token.");

  // The bootstrap endpoint authenticates with the org sid cookie, not the
  // Authorization bearer header. Remove the bearer token before this one call
  // so jsforce doesn't send two competing auth mechanisms.
  delete (conn as unknown as { accessToken?: string }).accessToken;

  let response: BootstrapResponse;
  try {
    response = await conn.request<BootstrapResponse>(
      {
        method: "GET",
        url: `${instanceUrl}/agentforce/bootstrap/nameduser`,
        headers: {
          "Content-Type": "application/json",
          Cookie: `sid=${accessToken}`,
        },
      } as Parameters<typeof conn.request>[0],
      { retry: { maxRetries: 3 } } as Parameters<typeof conn.request>[1],
    );
  } catch (err) {
    throw new Error(
      `Agent API auth bootstrap failed at /agentforce/bootstrap/nameduser: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  const jwt = response.access_token;
  if (!jwt || typeof jwt !== "string" || !isJwt(jwt)) {
    throw new Error(
      "Agent API auth bootstrap failed: nameduser endpoint did not return a valid JWT access_token. " +
        "If using a custom connected app, ensure it grants chatbot_api, sfap_api, and web scopes.",
    );
  }
  (conn as unknown as { accessToken: string }).accessToken = jwt;
  return conn;
}

/**
 * Resolve a fresh isolated connection for `/einstein/ai-agent/*` calls.
 *
 * We intentionally do not mutate the cached normal org connection because the
 * same command may still need normal org REST/SOQL afterward.
 */
export async function connForAgentApi(targetOrg?: string): Promise<AgentApiAuthResult> {
  const baseConn = await connFromAlias(targetOrg);
  const username = baseConn.getUsername?.();
  if (!username) {
    throw new Error("Agent API auth bootstrap failed: could not resolve org username.");
  }

  const authInfo = await AuthInfo.create({ username });
  const conn = await Connection.create({ authInfo });
  try {
    conn.setApiVersion(baseConn.getApiVersion());
  } catch {
    /* best-effort: Connection defaults to the org/api default */
  }
  await upgradeConnectionToNamedUserJwt(conn);
  return {
    conn,
    username,
    instanceUrl: conn.instanceUrl,
    tokenKind: "named-user-jwt",
  };
}
