/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Unit tests for the small public surface of command-panel.ts.
 *
 * The TUI rendering itself is covered by manual smoke testing inside pi
 * (we can't easily mount Pi's KeybindingsManager + Theme in a vitest
 * env). What we *can* unit-test is the close-keyword contract — that's
 * the piece extensions rely on, so it's the piece we lock down.
 */
import { describe, expect, it } from "vitest";
import { matchesCloseKeyword } from "../command-panel.ts";

describe("matchesCloseKeyword", () => {
  it("matches the exact `exit` keyword", () => {
    expect(matchesCloseKeyword("exit")).toBe(true);
  });

  it("matches the exact `quit` keyword", () => {
    expect(matchesCloseKeyword("quit")).toBe(true);
  });

  it("does not match partial keywords", () => {
    expect(matchesCloseKeyword("exi")).toBe(false);
    expect(matchesCloseKeyword("qui")).toBe(false);
  });

  it("is case-sensitive (callers normalize beforehand)", () => {
    // GroupedActionList lower-cases keystrokes before passing them in so the
    // match function itself stays simple. Document that contract here so a
    // refactor that drops the caller-side normalization breaks loudly.
    expect(matchesCloseKeyword("EXIT")).toBe(false);
    expect(matchesCloseKeyword("Quit")).toBe(false);
  });

  it("does not match unrelated text", () => {
    expect(matchesCloseKeyword("")).toBe(false);
    expect(matchesCloseKeyword("save")).toBe(false);
    expect(matchesCloseKeyword("exitnow")).toBe(false);
  });
});
