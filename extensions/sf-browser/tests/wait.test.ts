/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for SF Browser wait result classification. */
import { describe, expect, it } from "vitest";
import { classifyWait } from "../lib/sf_browser_wait-tool.ts";

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
});
