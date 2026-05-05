/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Gateway endpoint URL helpers.
 *
 * The public OpenAI-compatible API is rooted at `/v1`, while gateway admin
 * routes such as `/user/info` live at the gateway root. Users may configure
 * either form, so normalize at the call site instead of requiring one exact
 * input shape.
 *
 * Some gateway URLs are copied from model-specific examples with deployment
 * suffixes such as `<gateway>/bedrock`, `<gateway>/v1`, or
 * `<gateway>/bedrock/v1`. Those forms are easy to paste into setup, but this
 * extension needs the gateway root so every route can derive its own endpoint.
 * Canonicalizing known suffixes here makes existing saved configs self-heal
 * without asking users to edit JSON by hand.
 */

const V1_SUFFIX_PATTERN = /\/v1$/i;
const OPENAI_DEPLOYMENT_SUFFIX_PATTERN = /\/bedrock$/i;

function trimTrailingSlashes(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function stripKnownGatewaySuffixes(baseUrl: string): string {
  return trimTrailingSlashes(baseUrl)
    .replace(V1_SUFFIX_PATTERN, "")
    .replace(OPENAI_DEPLOYMENT_SUFFIX_PATTERN, "");
}

export function toGatewayOpenAiBaseUrl(baseUrl: string): string {
  const root = toGatewayRootBaseUrl(baseUrl);
  return root ? `${root}/v1` : "";
}

export function toGatewayRootBaseUrl(baseUrl: string): string {
  return stripKnownGatewaySuffixes(baseUrl);
}
