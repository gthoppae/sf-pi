/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for Browser Evidence Setup Audit Trail summaries. */
import { describe, expect, it } from "vitest";
import { summarizeSetupAuditTrail } from "../lib/setup-audit-trail.ts";

describe("setup audit trail evidence summary", () => {
  it("summarizes skipped audit enrichment", () => {
    expect(
      summarizeSetupAuditTrail({ status: "skipped", lookbackMinutes: 5, error: "No org" }),
    ).toEqual(["Setup Audit Trail: skipped (No org)"]);
  });

  it("summarizes bounded recent rows", () => {
    const lines = summarizeSetupAuditTrail({
      status: "queried",
      targetOrg: "dev",
      lookbackMinutes: 5,
      rowCount: 1,
      rows: [
        {
          CreatedDate: "2026-05-20T20:14:03.000+0000",
          Action: "Changed",
          Section: "Security",
          Display: "Updated setting",
          CreatedBy: { Name: "Admin User" },
        },
      ],
    });

    expect(lines[0]).toBe("Setup Audit Trail: 1 row(s) in last 5m.");
    expect(lines[1]).toContain("Changed");
    expect(lines[1]).toContain("Updated setting");
  });
});
