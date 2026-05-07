/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Data 360 REST path helpers.
 *
 * d360_api accepts paths relative to `/services/data/vXX.X` so the agent can
 * think in Salesforce REST resources (`/ssot/...`, `/connect/...`). If a user
 * or model includes a full `/services/data/vNN.N/...` prefix, normalize it back
 * to the configured session API version instead of trusting the supplied one.
 */

export type QueryValue = string | number | boolean | null | undefined | QueryValue[];
export type QueryParams = Record<string, QueryValue>;

const SERVICES_DATA_RE = /^\/services\/data\/v\d+(?:\.\d+)?(?=\/|$)/i;

export function normalizeD360Path(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) throw new Error("path is required");

  const withoutVersion = trimmed.replace(SERVICES_DATA_RE, "") || "/";
  if (!withoutVersion.startsWith("/")) {
    return `/${withoutVersion}`;
  }
  return withoutVersion;
}

export function buildApiPath(path: string, apiVersion: string, query?: QueryParams): string {
  const normalized = normalizeD360Path(path);
  const base = `/services/data/v${apiVersion}${normalized}`;
  const queryString = buildQueryString(query);
  return queryString ? `${base}?${queryString}` : base;
}

export function buildQueryString(query?: QueryParams): string {
  if (!query) return "";

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    appendQueryValue(params, key, value);
  }
  return params.toString();
}

function appendQueryValue(params: URLSearchParams, key: string, value: QueryValue): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) appendQueryValue(params, key, item);
    return;
  }
  params.append(key, String(value));
}
