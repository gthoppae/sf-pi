/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Source-level contract tests for the before_agent_start handler.
 *
 * We assert on the source text rather than executing the handler because
 * sharing the pi-coding-agent ExtensionAPI surface with real Pi internals
 * would require a far larger test scaffold. These checks keep the "inject
 * once per session" guarantee from silently regressing.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const brainSource = readFileSync(
  path.resolve(fileURLToPath(import.meta.url), "../../index.ts"),
  "utf-8",
);

describe("sf-brain before_agent_start handler", () => {
  it("registers a before_agent_start handler", () => {
    expect(brainSource).toMatch(/pi\.on\("before_agent_start",\s*async\s*\(/);
  });

  it("delegates the inject/skip decision to the shouldInjectKernel predicate", () => {
    // The handler hands the live entry list to a pure predicate so the
    // post-compaction logic stays unit-testable. Asserting the wiring keeps
    // the dedup contract from silently regressing back to the broken
    // `entries.some(type === "custom")` check that re-injected the kernel
    // on every turn.
    expect(brainSource).toContain("shouldInjectKernel");
    expect(brainSource).toContain("ctx.sessionManager");
    expect(brainSource).toContain(".getEntries()");
    expect(brainSource).toMatch(/if \(!shouldInjectKernel\([\s\S]*?\)\) return;/);
  });

  it("returns a persistent hidden custom message on first injection", () => {
    expect(brainSource).toContain("customType: KERNEL_ENTRY_TYPE");
    expect(brainSource).toContain("display: false");
  });

  it("reuses the shared sf-environment cache before running detection", () => {
    expect(brainSource).toContain("getCachedSfEnvironment");
    expect(brainSource).toContain("getSharedSfEnvironment");
  });
});
