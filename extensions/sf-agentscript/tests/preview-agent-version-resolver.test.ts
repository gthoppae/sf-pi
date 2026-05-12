/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the `agentDefinition.agentVersion.developerName` resolver used by
 * v1.1 preview/sessions starts. Locks in the priority order:
 *   override > bundle-meta `<target>vN</target>` > latest BotVersion SOQL > "v0".
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  findLatestBotVersionDeveloperName,
  parseTargetFromBundleMeta,
  resolveAgentVersionDeveloperName,
} from "../lib/preview/resolve-agent-version.ts";

describe("parseTargetFromBundleMeta", () => {
  test("extracts vN from <target>X.vN</target>", () => {
    expect(parseTargetFromBundleMeta("<target>Hello_Bot.v3</target>")).toBe("v3");
    expect(parseTargetFromBundleMeta("<target>  My_Agent.v12  </target>")).toBe("v12");
  });

  test("accepts a bare <target>vN</target> as fallback", () => {
    expect(parseTargetFromBundleMeta("<target>v7</target>")).toBe("v7");
  });

  test("returns undefined when no recognizable target is present", () => {
    expect(parseTargetFromBundleMeta("<bundleType>AGENT</bundleType>")).toBeUndefined();
    expect(parseTargetFromBundleMeta("<target>not-a-version</target>")).toBeUndefined();
    expect(parseTargetFromBundleMeta("")).toBeUndefined();
  });

  test("rejects malformed version-like strings", () => {
    expect(parseTargetFromBundleMeta("<target>X.v</target>")).toBeUndefined();
    expect(parseTargetFromBundleMeta("<target>X.va</target>")).toBeUndefined();
    // Server convention is lowercase `vN`. Uppercase `VN` is rejected.
    expect(parseTargetFromBundleMeta("<target>X.V3</target>")).toBeUndefined();
  });
});

describe("findLatestBotVersionDeveloperName", () => {
  test("returns DeveloperName from the latest BotVersion", async () => {
    const query = vi.fn<(soql: string) => Promise<unknown>>(async () => ({
      records: [{ BotVersions: { records: [{ DeveloperName: "v4" }] } }],
    }));
    const conn = { query };
    const v = await findLatestBotVersionDeveloperName(conn as never, "Hello_Bot");
    expect(v).toBe("v4");
    expect(query).toHaveBeenCalledTimes(1);
    const soql = query.mock.calls[0][0];
    expect(soql).toContain("BotVersions");
    expect(soql).toContain("DeveloperName='Hello_Bot'");
  });

  test("escapes single quotes in the agent name", async () => {
    const query = vi.fn<(soql: string) => Promise<unknown>>(async () => ({ records: [] }));
    const conn = { query };
    await findLatestBotVersionDeveloperName(conn as never, "weird'name");
    const soql = query.mock.calls[0][0];
    expect(soql).toContain("DeveloperName='weird''name'");
  });

  test("returns undefined when the agent has no BotVersions yet", async () => {
    const conn = {
      query: vi.fn(async () => ({ records: [{ BotVersions: null }] })),
    };
    expect(await findLatestBotVersionDeveloperName(conn as never, "X")).toBeUndefined();
  });

  test("never throws when SOQL fails (org may not expose BotDefinition)", async () => {
    const conn = {
      query: vi.fn(async () => {
        throw new Error("INVALID_TYPE");
      }),
    };
    expect(await findLatestBotVersionDeveloperName(conn as never, "X")).toBeUndefined();
  });

  test("rejects non-vN DeveloperName values", async () => {
    const conn = {
      query: vi.fn(async () => ({
        records: [{ BotVersions: { records: [{ DeveloperName: "draft-7" }] } }],
      })),
    };
    expect(await findLatestBotVersionDeveloperName(conn as never, "X")).toBeUndefined();
  });
});

describe("resolveAgentVersionDeveloperName", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-resolver-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("override beats every other source", async () => {
    const conn = {
      query: vi.fn(async () => ({
        records: [{ BotVersions: { records: [{ DeveloperName: "v9" }] } }],
      })),
    };
    await writeFile(path.join(dir, "X.bundle-meta.xml"), "<target>X.v3</target>");
    await writeFile(path.join(dir, "X.agent"), "");
    const r = await resolveAgentVersionDeveloperName({
      override: "v42",
      agentFilePath: path.join(dir, "X.agent"),
      conn: conn as never,
      agentName: "X",
    });
    expect(r).toEqual({ developerName: "v42", source: "override" });
    expect(conn.query).not.toHaveBeenCalled();
  });

  test("ignores malformed override and falls through", async () => {
    await writeFile(path.join(dir, "X.bundle-meta.xml"), "<target>X.v3</target>");
    await writeFile(path.join(dir, "X.agent"), "");
    const r = await resolveAgentVersionDeveloperName({
      override: "draft",
      agentFilePath: path.join(dir, "X.agent"),
    });
    expect(r).toEqual({ developerName: "v3", source: "bundle-meta" });
  });

  test("bundle-meta beats SOQL", async () => {
    const conn = {
      query: vi.fn(async () => ({
        records: [{ BotVersions: { records: [{ DeveloperName: "v9" }] } }],
      })),
    };
    await writeFile(path.join(dir, "X.bundle-meta.xml"), "<target>X.v3</target>");
    await writeFile(path.join(dir, "X.agent"), "");
    const r = await resolveAgentVersionDeveloperName({
      agentFilePath: path.join(dir, "X.agent"),
      conn: conn as never,
      agentName: "X",
    });
    expect(r).toEqual({ developerName: "v3", source: "bundle-meta" });
    expect(conn.query).not.toHaveBeenCalled();
  });

  test("SOQL takes over when bundle-meta is missing or has no <target>", async () => {
    const conn = {
      query: vi.fn(async () => ({
        records: [{ BotVersions: { records: [{ DeveloperName: "v5" }] } }],
      })),
    };
    await writeFile(path.join(dir, "X.bundle-meta.xml"), "<bundleType>AGENT</bundleType>");
    await writeFile(path.join(dir, "X.agent"), "");
    const r = await resolveAgentVersionDeveloperName({
      agentFilePath: path.join(dir, "X.agent"),
      conn: conn as never,
      agentName: "X",
    });
    expect(r).toEqual({ developerName: "v5", source: "soql" });
  });

  test("defaults to v0 when nothing else resolves", async () => {
    const r = await resolveAgentVersionDeveloperName({});
    expect(r).toEqual({ developerName: "v0", source: "default" });
  });

  test("defaults to v0 when bundle-meta is unreadable AND SOQL returns nothing", async () => {
    const conn = { query: vi.fn(async () => ({ records: [] })) };
    const r = await resolveAgentVersionDeveloperName({
      agentFilePath: path.join(dir, "missing.agent"),
      conn: conn as never,
      agentName: "Nope",
    });
    expect(r).toEqual({ developerName: "v0", source: "default" });
  });
});
