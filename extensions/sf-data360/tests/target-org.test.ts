/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for `resolveTargetOrgContext` — the shared resolver used by every
 * d360_* tool to pick a target org + the *right* API version + org type.
 *
 * The non-trivial case is "explicit target_org differs from active env":
 * detection must run against the explicit target so we use that org's
 * apiVersion, not the active env's. Reading the active env is the bug
 * that produced /services/data/v<wrong>/... 404s.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const orgCreateMock = vi.fn();

vi.mock("@salesforce/core", () => ({
  ConfigAggregator: { create: () => Promise.resolve({ getInfo: () => ({ value: undefined }) }) },
  Org: { create: (opts: unknown) => orgCreateMock(opts) },
}));

import {
  normalizeTargetOrg,
  resolveApiVersion,
  resolveTargetOrgContext,
  targetMatchesEnvironment,
} from "../lib/target-org.ts";
import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";

beforeEach(async () => {
  orgCreateMock.mockReset();
  const conn = await import("../../../lib/common/sf-conn/connection.ts");
  conn.clearConnectionCache();
});

function fakeOrg(opts: { authFields: Record<string, unknown>; apiVersion?: string }) {
  const conn = {
    getAuthInfoFields: () => opts.authFields,
    instanceUrl: (opts.authFields as { instanceUrl?: string }).instanceUrl ?? "",
    getApiVersion: () => opts.apiVersion ?? "66.0",
  };
  return { getConnection: () => conn };
}

const env: SfEnvironment = {
  cli: { installed: true, version: "2.132.14" },
  project: { detected: true, sourceApiVersion: "65.0" },
  config: { hasTargetOrg: true, targetOrg: "active-default", location: "Global" },
  org: {
    detected: true,
    alias: "active-default",
    username: "active@example.invalid",
    instanceUrl: "https://active.my.salesforce.com",
    orgType: "sandbox",
    apiVersion: "67.0",
  },
  detectedAt: 1,
};

describe("normalizeTargetOrg", () => {
  it("prefers explicit input, then env config, then env org alias/username", () => {
    expect(normalizeTargetOrg("custom", env)).toBe("custom");
    expect(normalizeTargetOrg("  custom  ", env)).toBe("custom");
    expect(normalizeTargetOrg(undefined, env)).toBe("active-default");
    expect(
      normalizeTargetOrg(undefined, { ...env, config: { hasTargetOrg: false } } as SfEnvironment),
    ).toBe("active-default");
    expect(
      normalizeTargetOrg(undefined, {
        ...env,
        config: { hasTargetOrg: false },
        org: { ...env.org, alias: undefined, username: "u@example.invalid" },
      } as SfEnvironment),
    ).toBe("u@example.invalid");
  });
});

describe("targetMatchesEnvironment", () => {
  it("matches by config target, alias, or username", () => {
    expect(targetMatchesEnvironment("active-default", env)).toBe(true);
    expect(targetMatchesEnvironment("active@example.invalid", env)).toBe(true);
    expect(targetMatchesEnvironment("other-org", env)).toBe(false);
  });
});

describe("resolveApiVersion", () => {
  it("prefers the explicit target's detected apiVersion over the env", () => {
    expect(
      resolveApiVersion(env, {
        detected: true,
        orgType: "developer",
        apiVersion: "66.0",
      }),
    ).toBe("66.0");
  });

  it("falls back to env then project sourceApiVersion", () => {
    expect(resolveApiVersion(env)).toBe("67.0");
    const noOrgVersion = { ...env, org: { ...env.org, apiVersion: undefined } } as SfEnvironment;
    expect(resolveApiVersion(noOrgVersion)).toBe("65.0");
  });

  it("throws when nothing resolves — better than a wrong default", () => {
    const empty = {
      ...env,
      project: { detected: false },
      org: { detected: false, orgType: "unknown" },
    } as SfEnvironment;
    expect(() => resolveApiVersion(empty)).toThrow(/No Salesforce API version available/);
  });
});

describe("resolveTargetOrgContext", () => {
  it("uses the active env apiVersion when target matches the env", async () => {
    const ctx = await resolveTargetOrgContext("active-default", env);

    expect(ctx).toMatchObject({
      targetOrg: "active-default",
      apiVersion: "67.0",
      orgType: "sandbox",
    });
    // No detection round-trip when the target is the active org.
    expect(orgCreateMock).not.toHaveBeenCalled();
  });

  it("uses the *target* org's apiVersion when target_org differs", async () => {
    // The bug: env.org is on v67.0 but the explicit target is on v66.0.
    // Reading env.org.apiVersion sent every call to a non-existent vNN URL
    // and produced silent NOT_FOUND noise.
    orgCreateMock.mockResolvedValueOnce(
      fakeOrg({
        authFields: {
          alias: "stdm",
          username: "stdm@example.invalid",
          instanceUrl: "https://stdm-dev-ed.develop.my.salesforce.com",
        },
        apiVersion: "66.0",
      }),
    );

    const ctx = await resolveTargetOrgContext("stdm", env);

    expect(ctx).toMatchObject({
      targetOrg: "stdm",
      apiVersion: "66.0",
      orgType: "developer",
    });
    expect(orgCreateMock).toHaveBeenCalledWith({ aliasOrUsername: "stdm" });
  });

  it("falls back to env apiVersion when explicit target detection fails", async () => {
    // Detection failure shouldn't crash the tool; but org type stays unknown
    // so safety classification stays fail-closed.
    orgCreateMock.mockRejectedValueOnce(new Error("auth failed"));

    const ctx = await resolveTargetOrgContext("missing-org", env);

    expect(ctx).toMatchObject({
      targetOrg: "missing-org",
      apiVersion: "67.0",
      orgType: "unknown",
    });
  });

  it("returns undefined targetOrg when none can be resolved", async () => {
    const empty = {
      ...env,
      config: { hasTargetOrg: false },
      org: { detected: false, orgType: "unknown" },
    } as SfEnvironment;

    const ctx = await resolveTargetOrgContext(undefined, empty);
    expect(ctx.targetOrg).toBeUndefined();
  });
});
