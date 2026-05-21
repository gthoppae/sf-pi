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

    expect(summary).toContain("📍 Page:");
    expect(summary).toContain("Full snapshot: /tmp/snapshot.txt");
    expect(summary).toContain('heading "Agentforce Agents"');
    expect(summary).toContain('switch "label" [checked=true, ref=e189]');
    expect(summary).toContain('button "New Agent" [ref=e175]');
    expect(summary).toContain("Rows: Demo Greeter");
  });

  it("classifies URLs and Salesforce surfaces", () => {
    const setup = summarizeSnapshot({
      snapshot: '- heading "Agentforce Agents" [level=1, ref=e151]',
      fullSnapshotPath: "/tmp/snapshot.txt",
      url: "https://example.my.salesforce-setup.com/lightning/setup/EinsteinCopilot/home",
    });
    const record = summarizeSnapshot({
      snapshot: '- heading "Acme" [level=1, ref=e1]',
      fullSnapshotPath: "/tmp/snapshot.txt",
      url: "https://example.my.salesforce.com/lightning/r/Account/001000000000001AAA/view",
    });
    const objectNew = summarizeSnapshot({
      snapshot: '- heading "New Account" [level=2, ref=e1]',
      fullSnapshotPath: "/tmp/snapshot.txt",
      url: "https://example.my.salesforce.com/lightning/o/Account/new?count=1",
    });

    expect(setup).toContain(
      "URL: https://example.my.salesforce-setup.com/lightning/setup/EinsteinCopilot/home",
    );
    expect(setup).toContain("Lightning Setup page");
    expect(setup).toContain("Surface: setup-page");
    expect(setup).toContain("Setup destination: agentforce-agents");
    expect(record).toContain("Record page");
    expect(record).toContain("Lightning state");
    expect(record).toContain("Surface: record-page");
    expect(record).toContain("Object: Account");
    expect(record).toContain("Record Id: 001000000000001AAA");
    expect(record).toContain("Mode: view");
    expect(objectNew).toContain("Object new page");
    expect(objectNew).toContain("Surface: object-new");
    expect(objectNew).not.toContain("List view");
  });

  it("does not classify setup pages as builders from promotional text alone", () => {
    const summary = summarizeSnapshot({
      snapshot: [
        '- heading "Agentforce Agents" [level=1, ref=e1]',
        '- StaticText "Try the new Agentforce Builder!"',
      ].join("\n"),
      fullSnapshotPath: "/tmp/snapshot.txt",
      url: "https://example.my.salesforce-setup.com/lightning/setup/EinsteinCopilot/home",
    });

    expect(summary).toContain("Lightning Setup page");
    expect(summary).not.toContain("Builder surface");
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

  it("does not treat navigation/table text containing error words as validation", () => {
    const snapshot = [
      '- treeitem "Delegated Authentication Error History" [level=2, ref=e1]',
      '- option "Revenue Transaction Error Logs" [ref=e2]',
      '- cell "This object cannot be a Master-Detail relationship." [ref=e3]',
    ].join("\n");

    const summary = summarizeSnapshot({ snapshot, fullSnapshotPath: "/tmp/snapshot.txt" });

    expect(summary).not.toContain("Alerts / validation");
    expect(summary).toContain("Validation: none");
  });

  it("redacts emails and non-page URLs from table and focus summaries", () => {
    const snapshot = [
      '- heading "Welcome, Jane," [level=1, ref=e0]',
      '- rowheader "person@example.com" [ref=e1]',
      '- cell "https://example.my.site.com/path" [ref=e2]',
    ].join("\n");

    const summary = summarizeSnapshot({
      snapshot,
      fullSnapshotPath: "/tmp/snapshot.txt",
      focus: ["example"],
    });

    expect(summary).toContain("Welcome, <user>");
    expect(summary).toContain("<email>");
    expect(summary).toContain("<url>");
    expect(summary).not.toContain("Welcome, Jane");
    expect(summary).not.toContain("person@example.com");
    expect(summary).not.toContain("https://example.my.site.com/path");
  });

  it("ignores short focus terms to avoid noisy matches", () => {
    const snapshot = [
      '- link "Skip to Navigation" [ref=e1]',
      '- button "Global Actions" [ref=e2]',
      '- heading "Agentforce Agents" [level=1, ref=e3]',
    ].join("\n");

    const summary = summarizeSnapshot({
      snapshot,
      fullSnapshotPath: "/tmp/snapshot.txt",
      focus: ["On", "Agentforce"],
    });

    const focusSection = summary.split("Key controls:")[0] ?? summary;

    expect(summary).toContain("Ignored short focus terms: On");
    expect(focusSection).not.toContain('link "Skip to Navigation"');
    expect(summary).toContain('heading "Agentforce Agents"');
  });

  it("defaults unknown output mode to summary", () => {
    expect(snapshotOutputModeFromUnknown("bad")).toBe("summary");
  });
});
