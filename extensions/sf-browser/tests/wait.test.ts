/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for SF Browser wait result classification. */
import { describe, expect, it } from "vitest";
import {
  buildLightningWaitExpression,
  buildWaitArgs,
  classifyWait,
} from "../lib/sf_browser_wait-tool.ts";

describe("wait classification", () => {
  it("marks near-timeout conditional waits as ambiguous", () => {
    const result = classifyWait(59_000, {});
    expect(result.ambiguous).toBe(true);
    expect(result.label).toBe("Wait may have timed out");
  });

  it("does not mark explicit fixed waits as ambiguous", () => {
    const result = classifyWait(60_000, { ms: 60_000 });
    expect(result.ambiguous).toBe(false);
    expect(result.label).toBe("Wait finished");
  });

  it("builds Lightning-aware wait expressions", () => {
    const args = buildWaitArgs({ lightning: "save-result" });

    expect(args[0]).toBe("wait");
    expect(args[1]).toBe("--fn");
    expect(args[2]).toContain("__sfPiLightningWait");
    expect(args[2]).toContain('"save-result"');
  });

  it("keeps save-result as an outcome classifier expression", () => {
    const expression = buildLightningWaitExpression("save-result");

    expect(expression).toContain("classifySaveResult");
    expect(expression).toContain("success-toast");
    expect(expression).toContain("validation-error");
    expect(expression).toContain("classic-error");
  });
});
