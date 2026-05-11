/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Cached `@salesforce/core` Org / Connection lookup.
 *
 * Replaces the `sf api request rest` subprocess path. Authentication context
 * comes from the same auth files the `sf` CLI writes — no second login,
 * automatic token refresh, ~30× lower per-call latency than shelling.
 *
 * Cache lifecycle:
 *  - One Org promise per alias (or one for the default org with key "<default>").
 *  - `clearConnectionCache()` should be called from each consumer's
 *    `session_start` / `session_shutdown` so resumed sessions re-auth cleanly.
 *  - On Org.create() failure the entry is removed so the next call can retry.
 *
 * History: the original lived in `extensions/sf-agentscript/lib/connection.ts`.
 * Lifted into `lib/common/sf-conn/` once a second extension (sf-data360) needed
 * the same cached Connection — matches the lib/common Q2 rule.
 */

// Lazy-import `@salesforce/core` so just *referencing* this module from an
// extension's `index.ts` (e.g. `import { clearConnectionCache } from ...`)
// doesn't drag the entire `@salesforce/core` tree (and its transitive
// `keytar`, `jsforce`, crypto-bindings, etc.) into the boot path. The value
// import only fires when a function below is actually invoked — by then we're
// past `session_start` and the user is interacting. The type-only `Connection`
// import is erased at TS compile time and costs nothing at runtime.
import type { Org as OrgType, Connection } from "@salesforce/core";

let orgCtor: typeof OrgType | undefined;
async function getOrgCtor(): Promise<typeof OrgType> {
  if (orgCtor) return orgCtor;
  // Single dynamic import — Node's ES module cache memoizes the SDK across
  // every call here and across every other lazy importer in this repo.
  const mod = await import("@salesforce/core");
  orgCtor = mod.Org;
  return orgCtor;
}

// -------------------------------------------------------------------------------------------------
// Cache
// -------------------------------------------------------------------------------------------------

const orgCache = new Map<string, Promise<OrgType>>();
const DEFAULT_KEY = "<default>";

/**
 * Resolve a target-org alias (or the project/global default) to a cached Org.
 *
 * Pass `undefined` to use the default org chain (project default → global
 * default), matching `sf` CLI behavior.
 */
export async function orgFromAlias(targetOrg?: string): Promise<OrgType> {
  const key = targetOrg ?? DEFAULT_KEY;
  let pending = orgCache.get(key);
  if (!pending) {
    pending = (async () => {
      const Org = await getOrgCtor();
      return Org.create({ aliasOrUsername: targetOrg });
    })().catch((err: unknown) => {
      orgCache.delete(key);
      throw err;
    });
    orgCache.set(key, pending);
  }
  return pending;
}

/** Convenience: `orgFromAlias().getConnection()`. */
export async function connFromAlias(targetOrg?: string): Promise<Connection> {
  return (await orgFromAlias(targetOrg)).getConnection();
}

/**
 * Drop all cached Orgs. Call from `session_start` / `session_shutdown` so
 * resumed sessions re-auth and pick up any token refresh that happened
 * outside this process.
 */
export function clearConnectionCache(): void {
  orgCache.clear();
}

/** Test/debug helper. */
export function cacheSize(): number {
  return orgCache.size;
}

// -------------------------------------------------------------------------------------------------
// Org identity (org_id, instance_url, user_id) for SFAP headers
// -------------------------------------------------------------------------------------------------

export interface OrgIdentity {
  org_id: string;
  instance_url: string;
  user_id: string;
}

/**
 * Resolve org_id + user_id once per run for SFAP headers.
 *
 * Uses `conn.identity()` which hits `/services/oauth2/userinfo` under the
 * hood. Connection handles caching/refresh.
 */
export async function resolveOrgIdentity(conn: Connection): Promise<OrgIdentity> {
  const userInfo = (await conn.identity()) as {
    user_id?: string;
    organization_id?: string;
  };
  if (!userInfo.user_id || !userInfo.organization_id) {
    throw new Error(
      "conn.identity() returned no user_id/organization_id. " +
        "Suggested fix: re-auth with `sf org login web -a <alias>`.",
    );
  }
  return {
    org_id: userInfo.organization_id,
    instance_url: conn.instanceUrl,
    user_id: userInfo.user_id,
  };
}
