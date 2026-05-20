/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for SF Browser public-output redaction helpers. */
import { describe, expect, it } from "vitest";
import { redactText, redactUrl, sanitizeLabel } from "../lib/redaction.ts";

describe("sf-browser redaction", () => {
  it("redacts Salesforce frontdoor URLs", () => {
    const url = new URL("https://example.my.salesforce.com/secur/frontdoor.jsp");
    url.searchParams.set("sid", "fake-session-value");
    url.searchParams.set("retURL", "/lightning/setup");

    expect(redactUrl(url.toString())).toBe(
      "https://example.my.salesforce.com/secur/frontdoor.jsp?<redacted>",
    );
  });

  it("redacts token-like query parameters in text", () => {
    expect(redactText("open https://example.test/path?access_token=secret&state=ok")).toContain(
      "access_token=<redacted>",
    );
  });

  it("normalizes artifact labels", () => {
    expect(sanitizeLabel("Setup Home!", "evidence")).toBe("setup-home");
  });
});
