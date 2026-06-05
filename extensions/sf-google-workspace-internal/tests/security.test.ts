/* SPDX-License-Identifier: Apache-2.0 */
import { test, assert } from "vitest";
import {
  REDACTED,
  ScopeViolationError,
  assertScopesAllowed,
  redactToken,
  sanitizeForLog,
} from "../lib/security.ts";

test("readonly scopes accepted by default", () => {
  const out = assertScopesAllowed([
    "openid",
    "email",
    "https://www.googleapis.com/auth/drive.metadata.readonly",
  ]);
  assert.equal(out.length, 3);
});

test("write scopes rejected unless allowWrite=true", () => {
  const writeScope = "https://www.googleapis.com/auth/spreadsheets";
  assert.throws(() => assertScopesAllowed([writeScope]), ScopeViolationError);
  const ok = assertScopesAllowed([writeScope], { allowWrite: true });
  assert.deepEqual(ok, [writeScope]);
});

test("denylisted scopes rejected even with allowWrite", () => {
  assert.throws(
    () => assertScopesAllowed(["https://mail.google.com/"], { allowWrite: true }),
    ScopeViolationError,
  );
  assert.throws(
    () =>
      assertScopesAllowed(["https://www.googleapis.com/auth/drive"], {
        allowWrite: true,
      }),
    /denylist/,
  );
});

test("unknown scope rejected", () => {
  assert.throws(() => assertScopesAllowed(["https://example.com/made-up"]), ScopeViolationError);
});

test("empty scope set rejected", () => {
  assert.throws(() => assertScopesAllowed([]), /no valid scopes/);
  assert.throws(() => assertScopesAllowed(["", "  "]), /no valid scopes/);
});

test("scopes are de-duplicated", () => {
  const out = assertScopesAllowed(["email", "email", "openid"]);
  assert.deepEqual(out.sort(), ["email", "openid"]);
});

test("redactToken never reveals full token", () => {
  const token = "ya29.A0AReAabcdefghijklmnopqrstuvwxyz1234567890";
  const r = redactToken(token);
  assert.ok(!r.includes("klmnop"), "must not contain token body");
  assert.ok(r.includes(REDACTED));
  assert.ok(r.startsWith("ya29"));
});

test("redactToken hides short tokens entirely", () => {
  assert.equal(redactToken("short"), REDACTED);
  assert.equal(redactToken(""), REDACTED);
  assert.equal(redactToken(undefined), REDACTED);
});

test("sanitizeForLog redacts secret-named keys", () => {
  const obj = {
    user: "alice@salesforce.com",
    access_token: "ya29.SECRETSECRETSECRET",
    nested: { refresh_token: "1//refreshSECRET", clientId: "fine" },
    client_secret: "GOCSPX-abc123def456",
  };
  const safe = sanitizeForLog(obj) as Record<string, unknown>;
  assert.equal(safe.user, "alice@salesforce.com");
  assert.ok(!JSON.stringify(safe).includes("SECRETSECRETSECRET"));
  assert.ok(!JSON.stringify(safe).includes("refreshSECRET"));
  assert.ok(!JSON.stringify(safe).includes("GOCSPX-abc123def456"));
});

test("sanitizeForLog masks bearer tokens embedded in strings", () => {
  const line = "GET /api failed: Authorization: Bearer ya29.LEAKYTOKENVALUE123";
  const safe = sanitizeForLog(line) as string;
  assert.ok(!safe.includes("LEAKYTOKENVALUE123"));
  assert.ok(safe.includes(REDACTED));
});

test("sanitizeForLog masks JWT-shaped strings", () => {
  const jwt = "eyAbcdefgh.eyPayload123.SignaturePart99";
  const safe = sanitizeForLog(`token=${jwt}`) as string;
  assert.ok(!safe.includes("SignaturePart99"));
});
