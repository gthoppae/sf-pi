/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { sanitizeRemoteUrl, sanitizeText } from "../lib/sanitize.ts";

describe("sf-feedback sanitize", () => {
  it("redacts public-issue unsafe identifiers", () => {
    const text = [
      "email jane@example.com",
      "url https://example.my.salesforce.com/lightning/setup",
      "org 00D000000000000AAA",
      "token ghp_abcdefghijklmnopqrstuvwxyz123456",
    ].join("\n");

    const sanitized = sanitizeText(text);

    expect(sanitized).toContain("<email-redacted>");
    expect(sanitized).toContain("<salesforce-instance-url-redacted>");
    expect(sanitized).toContain("<org-id-redacted>");
    expect(sanitized).toContain("<token-redacted>");
    expect(sanitized).not.toContain("jane@example.com");
  });

  it("keeps GitHub remotes but redacts non-GitHub remotes", () => {
    expect(sanitizeRemoteUrl("https://github.com/salesforce/sf-pi.git")).toBe(
      "github.com/salesforce/sf-pi",
    );
    expect(sanitizeRemoteUrl("git@github.com:salesforce/sf-pi.git")).toBe(
      "github.com/salesforce/sf-pi",
    );
    expect(sanitizeRemoteUrl("ssh://git.example.com/private/repo.git")).toBe(
      "<non-github-remote-redacted>",
    );
  });

  it("does not let a non-GitHub remote bypass redaction by embedding github.com", () => {
    // CodeQL js/regex/missing-regexp-anchor regression guard. Before the fix,
    // these URLs slipped through the fallback because /github\.com/i was
    // unanchored and matched anywhere in the string.
    expect(sanitizeRemoteUrl("https://evil.example.com/?ref=github.com")).toBe(
      "<non-github-remote-redacted>",
    );
    expect(sanitizeRemoteUrl("https://github.com.evil.example.com/owner/repo")).toBe(
      "<non-github-remote-redacted>",
    );
    expect(sanitizeRemoteUrl("https://example.com/path/github.com/x")).toBe(
      "<non-github-remote-redacted>",
    );
  });
});
