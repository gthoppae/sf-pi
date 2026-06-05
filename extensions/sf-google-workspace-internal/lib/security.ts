/* SPDX-License-Identifier: Apache-2.0 */
/**
 * security.ts — security primitives for Salesforce-internal Google Workspace auth.
 *
 * Design rules baked in:
 *  - Tokens are NEVER returned, logged, or surfaced. Only redacted forms.
 *  - Scopes are least-privilege by default; write scopes require explicit opt-in.
 *  - Anything that looks like a secret is scrubbed before it can reach a log.
 *
 * Pure, dependency-free, and unit-testable without real Google credentials.
 */

export const REDACTED = "[REDACTED]";

/**
 * Least-privilege read-only scope allowlist for the MVP.
 * Start narrow; widen only after an explicit security review.
 */
export const READONLY_SCOPE_ALLOWLIST: readonly string[] = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
];

/**
 * Write scopes that are only permitted when the caller explicitly opts in
 * (allowWrite=true). Everything not in either list is rejected outright.
 */
export const WRITE_SCOPE_ALLOWLIST: readonly string[] = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
];

/**
 * Hard denylist — high-blast-radius scopes we refuse even when allowWrite=true.
 * Gmail send/modify and full Drive are out of scope for the MVP.
 */
export const SCOPE_DENYLIST: readonly string[] = [
  "https://mail.google.com/",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/drive", // full, unrestricted Drive
];

export class ScopeViolationError extends Error {
  readonly scope: string;
  constructor(message: string, scope: string) {
    super(message);
    this.name = "ScopeViolationError";
    this.scope = scope;
  }
}

/**
 * Validate a requested scope set against the policy.
 * Throws ScopeViolationError on the first violation.
 *
 * @returns the validated, de-duplicated scope list.
 */
export function assertScopesAllowed(
  scopes: readonly string[],
  opts: { allowWrite?: boolean } = {},
): string[] {
  const allowWrite = opts.allowWrite ?? false;
  const allowed = new Set<string>(READONLY_SCOPE_ALLOWLIST);
  if (allowWrite) for (const s of WRITE_SCOPE_ALLOWLIST) allowed.add(s);
  const deny = new Set<string>(SCOPE_DENYLIST);

  const seen = new Set<string>();
  for (const raw of scopes) {
    const scope = raw.trim();
    if (!scope) continue;
    if (deny.has(scope)) {
      throw new ScopeViolationError(`scope is denylisted: ${scope}`, scope);
    }
    if (!allowed.has(scope)) {
      throw new ScopeViolationError(
        allowWrite
          ? `scope not in allowlist: ${scope}`
          : `write/unknown scope rejected (allowWrite=false): ${scope}`,
        scope,
      );
    }
    seen.add(scope);
  }
  if (seen.size === 0) {
    throw new ScopeViolationError("no valid scopes requested", "");
  }
  return [...seen];
}

const SECRET_KEY_PATTERN =
  /(token|secret|password|passwd|credential|client_secret|refresh|authorization|api[_-]?key|bearer)/i;

/**
 * Redact a token-like string, keeping only a short non-reversible prefix hint
 * so logs are debuggable without leaking the secret.
 */
export function redactToken(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return REDACTED;
  // Never reveal more than 4 leading chars, and only for longer strings.
  if (value.length <= 8) return REDACTED;
  return `${value.slice(0, 4)}…${REDACTED}`;
}

/**
 * Recursively scrub an object/array/string so it is safe to log.
 * Keys whose names look secret are redacted; bearer-token-shaped strings
 * embedded in values are masked too.
 */
export function sanitizeForLog(input: unknown, _depth = 0): unknown {
  if (_depth > 8) return REDACTED;
  if (input == null) return input;
  if (typeof input === "string") return maskBearer(input);
  if (typeof input === "number" || typeof input === "boolean") return input;
  if (Array.isArray(input)) {
    return input.map((v) => sanitizeForLog(v, _depth + 1));
  }
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(k)) {
        out[k] = typeof v === "string" ? redactToken(v) : REDACTED;
      } else {
        out[k] = sanitizeForLog(v, _depth + 1);
      }
    }
    return out;
  }
  return REDACTED;
}

/** Mask `Bearer <token>` and standalone long opaque/JWT-ish tokens in free text. */
function maskBearer(text: string): string {
  return (
    text
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, `Bearer ${REDACTED}`)
      // JWT-shaped (three base64url segments)
      .replace(/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED)
      // Google OAuth refresh/access token prefixes
      .replace(/\b(?:ya29|1\/\/|GOCSPX-)[A-Za-z0-9._-]+/g, REDACTED)
  );
}
