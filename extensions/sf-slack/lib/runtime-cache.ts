/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Best-effort cross-session cache for Slack startup identity + granted scopes.
 *
 * Purpose: keep `session_start` cache-first. A previous successful `auth.test`
 * gives us stable identity anchors and the X-OAuth-Scopes header. Reusing that
 * for first paint / first turn lets sf-slack register and gate tools without
 * awaiting Slack on every boot. A background live probe corrects stale cache
 * shortly after startup.
 *
 * Safety:
 * - The raw token is never stored. We bind cache rows to a SHA-256 token hash.
 * - The cache stores only identity and scope names — not message data.
 * - Max age is short enough to recover from workspace/app changes without
 *   surprising users for long.
 */
import { createHash } from "node:crypto";
import { createStateStore } from "../../../lib/common/state-store.ts";
import type { SlackIdentity } from "./types.ts";
import type { SlackTokenType } from "./api.ts";

const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_HASH_LEN = 16;

export interface SlackRuntimeCache {
  tokenHash: string;
  tokenType: SlackTokenType;
  identity: SlackIdentity;
  grantedScopes: string[];
  savedAt: number;
}

const store = createStateStore<Partial<SlackRuntimeCache>>({
  namespace: "sf-slack",
  filename: "runtime-cache.json",
  schemaVersion: 1,
  defaults: {},
  migrate(raw, fromVersion) {
    if (fromVersion !== 0) return null;
    return raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Partial<SlackRuntimeCache>)
      : null;
  },
});

export function hashSlackToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, TOKEN_HASH_LEN);
}

function isIdentity(value: unknown): value is SlackIdentity {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<SlackIdentity>;
  return (
    typeof record.userId === "string" &&
    typeof record.userName === "string" &&
    typeof record.teamId === "string"
  );
}

function isTokenType(value: unknown): value is SlackTokenType {
  return value === "user" || value === "bot" || value === "app" || value === "unknown";
}

export function readSlackRuntimeCache(
  token: string,
  maxAgeMs: number = CACHE_MAX_AGE_MS,
): SlackRuntimeCache | null {
  try {
    const raw = store.read();
    const expectedHash = hashSlackToken(token);
    if (raw.tokenHash !== expectedHash) return null;
    if (!isTokenType(raw.tokenType)) return null;
    if (!isIdentity(raw.identity)) return null;
    if (!Array.isArray(raw.grantedScopes)) return null;
    if (typeof raw.savedAt !== "number") return null;
    if (Date.now() - raw.savedAt > maxAgeMs) return null;
    return {
      tokenHash: raw.tokenHash,
      tokenType: raw.tokenType,
      identity: raw.identity,
      grantedScopes: raw.grantedScopes.filter(
        (scope): scope is string => typeof scope === "string",
      ),
      savedAt: raw.savedAt,
    };
  } catch {
    return null;
  }
}

export function writeSlackRuntimeCache(input: {
  token: string;
  tokenType: SlackTokenType;
  identity: SlackIdentity;
  grantedScopes: Iterable<string> | null;
}): void {
  try {
    store.write({
      tokenHash: hashSlackToken(input.token),
      tokenType: input.tokenType,
      identity: input.identity,
      grantedScopes: [...(input.grantedScopes ?? [])].sort(),
      savedAt: Date.now(),
    });
  } catch {
    // Cache is best-effort; never let Slack startup depend on disk writes.
  }
}
