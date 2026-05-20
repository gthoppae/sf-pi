/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for pi-native snapshot summarization. */
import { describe, expect, it } from "vitest";
import { snapshotOutputModeFromUnknown, summarizeSnapshot } from "../lib/snapshot-summary.ts";

describe("snapshot summary", () => {
  it("keeps high-value Salesforce controls and focus matches", () => {
    const snapshot = [
      '- heading "Agentforce Agents" [level=1, ref=e151]',
      '- switch "label" [checked=true, ref=e189]',
      '- button "New Agent" [ref=e175]',
      '- rowheader "Expand Demo Greeter Demo Greeter" [ref=e190]',
      '- gridcell "Service Agent" [ref=e191]',
    ].join("\n");

    const summary = summarizeSnapshot({
      snapshot,
      fullSnapshotPath: "/tmp/snapshot.txt",
      focus: ["Agentforce"],
    });

    expect(summary).toContain("Full snapshot: /tmp/snapshot.txt");
    expect(summary).toContain('heading "Agentforce Agents"');
    expect(summary).toContain('switch "label" [checked=true, ref=e189]');
    expect(summary).toContain('button "New Agent" [ref=e175]');
  });

  it("preserves validation alert text in compact summaries", () => {
    const snapshot = [
      "- alert",
      '- heading "Please fix the following:" [level=4, ref=e171]',
      '- StaticText "• "',
      '- StaticText "Can\'t assign permission set Agent STDM to user STDM Demo Agent User."',
      '- StaticText "The user license doesn\'t allow the permission: Gives users permission to view Agentforce Optimization."',
    ].join("\n");

    const summary = summarizeSnapshot({ snapshot, fullSnapshotPath: "/tmp/snapshot.txt" });

    expect(summary).toContain("Alerts / validation");
    expect(summary).toContain("Please fix the following");
    expect(summary).toContain("Can't assign permission set Agent STDM");
    expect(summary).toContain("user license doesn't allow");
  });

  it("defaults unknown output mode to summary", () => {
    expect(snapshotOutputModeFromUnknown("bad")).toBe("summary");
  });
});
