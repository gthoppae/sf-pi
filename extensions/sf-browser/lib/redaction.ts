/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Redaction helpers for session-bearing Salesforce and browser URLs.
 *
 * These helpers are intentionally conservative: SF Browser may pass raw
 * frontdoor URLs to agent-browser, but its tool results should not echo them
 * back into chat, logs, or model context.
 */

const SECRET_QUERY_KEYS = new Set([
  "sid",
  "sessionid",
  "session",
  "token",
  "access_token",
  "refresh_token",
  "code",
]);

export function redactUrl(input: string | undefined): string | undefined {
  if (!input) return input;
  try {
    const url = new URL(input);
    const lowerPath = url.pathname.toLowerCase();
    if (lowerPath.includes("/secur/frontdoor.jsp")) {
      return `${url.origin}${url.pathname}?<redacted>`;
    }
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_QUERY_KEYS.has(key.toLowerCase())) {
        url.searchParams.set(key, "<redacted>");
      }
    }
    return url.toString();
  } catch {
    return input.replace(
      /(sid|sessionid|access_token|refresh_token|token|code)=([^&\s]+)/gi,
      "$1=<redacted>",
    );
  }
}

export function redactText(input: string): string {
  return input
    .replace(
      /https?:\/\/[^\s]+\/secur\/frontdoor\.jsp[^\s]*/gi,
      (match) => redactUrl(match) ?? match,
    )
    .replace(/(sid|sessionid|access_token|refresh_token|token|code)=([^&\s]+)/gi, "$1=<redacted>");
}

export function sanitizeLabel(label: string | undefined, fallback: string): string {
  const raw = (label || fallback).trim().toLowerCase();
  const normalized = raw.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.slice(0, 64) || fallback;
}
