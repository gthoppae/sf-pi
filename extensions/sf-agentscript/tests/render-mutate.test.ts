/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { mutateResultMarkdown } from "../lib/render/mutate.ts";

describe("mutateResultMarkdown", () => {
  it("renders set_field diff with recompile clean", () => {
    const md = mutateResultMarkdown({
      ok: true,
      op: "set_field",
      component: "topic.Triage",
      field: "description",
      before: "Initial routing topic",
      after: "Triage incoming requests and route to a sub-agent",
      written: true,
      diagnostics_after: [],
      diagnostics_after_clean: true,
      duration_ms: 18,
    });
    expect(md).toMatch(/set_field/);
    expect(md).toMatch(/topic\.Triage\.description/);
    expect(md).toMatch(/Initial routing topic/);
    expect(md).toMatch(/Triage incoming requests/);
    expect(md).toMatch(/recompile clean/);
    expect(md).toMatch(/18ms/);
  });

  it("renders apply_quick_fix with diagnostic code", () => {
    const md = mutateResultMarkdown({
      ok: true,
      op: "apply_quick_fix",
      diagnostic_code: "missing-required-field",
      line: 17,
      diagnostics_after: [],
    });
    expect(md).toMatch(/apply_quick_fix/);
    expect(md).toMatch(/missing-required-field/);
    expect(md).toMatch(/recompile clean/);
  });

  it("flags emit_regression rollback", () => {
    const md = mutateResultMarkdown({
      ok: true,
      op: "set_field",
      component: "topic.X",
      field: "description",
      reason: "emit_regression",
      reason_detail: "SDK emit produced 1 new severity-1 error",
    });
    expect(md).toMatch(/Refused to write/);
    expect(md).toMatch(/file on disk was NOT modified/);
    expect(md).toMatch(/SDK emit/);
  });

  it("renders dry-run warning ribbon and no write", () => {
    const md = mutateResultMarkdown({
      ok: true,
      op: "set_field",
      component: "topic.X",
      field: "description",
      before: "old",
      after: "new",
      dry_run: true,
      diagnostics_after: [],
    });
    expect(md).toMatch(/dry-run/);
    expect(md).toMatch(/Re-run without dry_run=true to apply/);
  });

  it("warns when recompile-after introduces issues", () => {
    const md = mutateResultMarkdown({
      ok: true,
      op: "set_field",
      component: "topic.X",
      field: "description",
      before: "a",
      after: "b",
      diagnostics_after: [
        { severity: 1, code: "broken", message: "broke", range: { start: { line: 5 } } },
        { severity: 2, code: "warned", message: "warn", range: { start: { line: 9 } } },
      ],
    });
    expect(md).toMatch(/recompile after mutate/);
    expect(md).toMatch(/1 error/);
    expect(md).toMatch(/1 warning/);
    expect(md).toMatch(/broken/);
  });

  it("skips diff card when before/after are non-scalar", () => {
    const md = mutateResultMarkdown({
      ok: true,
      op: "set_field",
      component: "topic.X",
      field: "obj",
      before: { a: 1 },
      after: { a: 2 },
      diagnostics_after: [],
    });
    // No leading "- " or "+ " diff lines for non-scalar values.
    expect(md).not.toMatch(/^\s*-\s/m);
    expect(md).not.toMatch(/^\s*\+\s/m);
  });
});
