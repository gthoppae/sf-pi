/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Force HTTP/1.1 for every Slack request.
 *
 * Newer Node versions (>=26) negotiate HTTP/2 with slack.com via TLS ALPN
 * and undici's H2 client occasionally hangs when the server-side stream
 * does not close in the way the H2 reader expects. The visible symptom on
 * the agent splash is `Slack: ⏳ Checking` followed 30 s later by
 * `request_timeout` (the AbortSignal.timeout in `fetchWithRetry`).
 *
 * curl with `--http1.1` and curl with `--http2` both succeed against
 * `slack.com/api/auth.test` in <100 ms on the same machine, so the failure
 * is specifically undici's HTTP/2 dispatcher. Pinning to `allowH2: false`
 * for slack.com only is the minimal fix that restores reliability without
 * disabling H2 globally for other modules in the same Node process.
 *
 * This module is loaded by both `./api.ts` (Slack tool calls) and
 * `./auth.ts` (OAuth exchange), so the same dispatcher is reused across
 * the whole sf-slack code path.
 */
import { Agent, type Dispatcher } from "undici";

let cached: Dispatcher | null = null;

/**
 * Return the singleton HTTP/1.1-only undici Agent used for all Slack
 * fetches. The Agent is constructed lazily so importing this module from
 * a code path that never makes HTTP calls (e.g. type-only imports during
 * tests) does not eagerly open a pool.
 */
export function getSlackHttpDispatcher(): Dispatcher {
  if (!cached) {
    cached = new Agent({ allowH2: false });
  }
  return cached;
}
