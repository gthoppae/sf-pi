/* SPDX-License-Identifier: Apache-2.0 */
/** Unit tests for gateway usage refresh and connection-status classification. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetMonthlyUsageStoreForTests,
  getMonthlyUsageState,
} from "../../../lib/common/monthly-usage/store.ts";
import { API_KEY_ENV, BASE_URL_ENV } from "../lib/config.ts";
import { registerGatewayMonthlyUsageRefresher } from "../lib/monthly-usage.ts";

const originalFetch = globalThis.fetch;
const originalBaseUrl = process.env[BASE_URL_ENV];
const originalApiKey = process.env[API_KEY_ENV];

describe("gateway monthly usage refresh", () => {
  afterEach(() => {
    __resetMonthlyUsageStoreForTests();
    globalThis.fetch = originalFetch;
    restoreEnv(BASE_URL_ENV, originalBaseUrl);
    restoreEnv(API_KEY_ENV, originalApiKey);
    vi.restoreAllMocks();
  });

  it("publishes not-configured when credentials are missing", async () => {
    delete process.env[BASE_URL_ENV];
    delete process.env[API_KEY_ENV];
    const unregister = registerGatewayMonthlyUsageRefresher();
    const cwd = createProjectConfig({ baseUrl: "", apiKey: "" });

    try {
      await getMonthlyUsageStateRefresh(true, cwd);

      expect(getMonthlyUsageState().connectionStatus).toMatchObject({
        kind: "not-configured",
        source: "config",
      });
    } finally {
      unregister();
    }
  });

  it("publishes connected only after an auth-gated usage endpoint succeeds", async () => {
    process.env[BASE_URL_ENV] = "https://gateway.example.test";
    process.env[API_KEY_ENV] = "test-key";
    mockGatewayFetch({ userStatus: 200, keyStatus: 200, healthStatus: 200 });
    const unregister = registerGatewayMonthlyUsageRefresher();
    const cwd = createProjectConfig({
      baseUrl: "https://gateway.example.test",
      apiKey: "test-key",
    });

    try {
      await getMonthlyUsageStateRefresh(true, cwd);

      expect(getMonthlyUsageState().connectionStatus).toMatchObject({
        kind: "connected",
        source: "user-info",
      });
    } finally {
      unregister();
    }
  });

  it("does not treat readiness success alone as connected when auth-gated probes fail", async () => {
    process.env[BASE_URL_ENV] = "https://gateway.example.test";
    process.env[API_KEY_ENV] = "bad-key";
    mockGatewayFetch({ userStatus: 401, keyStatus: 401, healthStatus: 200 });
    const unregister = registerGatewayMonthlyUsageRefresher();
    const cwd = createProjectConfig({ baseUrl: "https://gateway.example.test", apiKey: "bad-key" });

    try {
      await getMonthlyUsageStateRefresh(true, cwd);

      expect(getMonthlyUsageState().connectionStatus).toMatchObject({
        kind: "auth-failed",
      });
    } finally {
      unregister();
    }
  });
});

async function getMonthlyUsageStateRefresh(force: boolean, cwd: string): Promise<void> {
  const { refreshMonthlyUsage } = await import("../../../lib/common/monthly-usage/store.ts");
  await refreshMonthlyUsage(force, cwd);
}

function createProjectConfig(config: { baseUrl: string; apiKey: string }): string {
  const cwd = mkdtempSync(join(tmpdir(), "sf-pi-gateway-test-"));
  const configDir = join(cwd, ".pi");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "sf-llm-gateway-internal.json"),
    `${JSON.stringify({ enabled: true, ...config })}\n`,
  );
  return cwd;
}

function mockGatewayFetch(options: {
  userStatus: number;
  keyStatus: number;
  healthStatus: number;
}): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/user/info")) {
      return jsonResponse(options.userStatus, {
        user_info: {
          max_budget: 3000,
          spend: 42,
          budget_reset_at: "2026-06-01",
          budget_duration: "1mo",
        },
      });
    }
    if (url.endsWith("/key/info")) {
      return jsonResponse(options.keyStatus, {
        info: { spend: 7, key_name: "sk-...test", rpm_limit: 100, tpm_limit: 1000 },
      });
    }
    if (url.endsWith("/health/readiness")) {
      return jsonResponse(options.healthStatus, { status: "connected" });
    }
    return jsonResponse(404, { error: "not found" });
  }) as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
