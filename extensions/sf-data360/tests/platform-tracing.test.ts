/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import {
  APT_ROOT_PARENT_SPAN_ID,
  buildFindErrorSpansSql,
  buildOperationPerformanceSql,
  buildSpanTree,
  buildTraceTreeSql,
  normalizePlatformSpanRow,
  summarizeSpanTree,
} from "../lib/agent-observability/platform-tracing.ts";

describe("Agent Platform Tracing helpers", () => {
  it("builds bounded SQL for common trace workflows", () => {
    const errors = buildFindErrorSpansSql({ since: "2026-05-01", limit: 500 });
    expect(errors).toContain('FROM "ssot__TelemetryTraceSpan__dlm"');
    expect(errors).toContain("ssot__StatusCode__c = 'ERROR'");
    expect(errors).toContain("TIMESTAMP '2026-05-01 00:00:00'");
    expect(errors).toContain("LIMIT 200");

    const tree = buildTraceTreeSql("trace'one", { limit: 3 });
    expect(tree).toContain("WHERE ssot__TelemetryTrace__c = 'trace''one'");
    expect(tree).toContain("ORDER BY ssot__StartDateTime__c ASC");
    expect(tree).toContain("LIMIT 3");

    const perf = buildOperationPerformanceSql({ since: "2026-05-01T12:30:00Z" });
    expect(perf).toContain("AVG(ssot__DurationNumber__c)");
    expect(perf).toContain("TIMESTAMP '2026-05-01 12:30:00'");
    expect(perf).toContain("LIMIT 20");
  });

  it("rejects loose timestamp literals instead of embedding them in SQL", () => {
    expect(() => buildFindErrorSpansSql({ since: "2026-05-01'; DELETE" })).toThrow("since must be");
  });

  it("normalizes DMO rows, converts nanos to ms, and parses attributes", () => {
    const span = normalizePlatformSpanRow({
      ssot__Id__c: "child",
      ssot__TelemetryTrace__c: "trace",
      ssot__TelemetryParentSpanId__c: APT_ROOT_PARENT_SPAN_ID,
      ssot__OperationName__c: "run.action.Lookup",
      ssot__StatusCode__c: "ERROR",
      ssot__DurationNumber__c: "2500000",
      ssot__TelemetrySpanAttributeText__c: '{"db.rows_affected":0}',
    });

    expect(span.parentSpanId).toBeUndefined();
    expect(span.durationMs).toBe(2.5);
    expect(span.attributes).toEqual({ "db.rows_affected": 0 });
  });

  it("reconstructs trees, handles root sentinels, and tracks orphan spans", () => {
    const spans = [
      normalizePlatformSpanRow({
        ssot__Id__c: "root",
        ssot__TelemetryTrace__c: "trace",
        ssot__TelemetryParentSpanId__c: APT_ROOT_PARENT_SPAN_ID,
        ssot__OperationName__c: "run.interaction",
        ssot__StatusCode__c: "OK",
        ssot__DurationNumber__c: 3_000_000,
        ssot__StartDateTime__c: "2026-05-01T00:00:00Z",
      }),
      normalizePlatformSpanRow({
        ssot__Id__c: "child",
        ssot__TelemetryTrace__c: "trace",
        ssot__TelemetryParentSpanId__c: "root",
        ssot__OperationName__c: "run.action.Lookup",
        ssot__StatusCode__c: "ERROR",
        ssot__DurationNumber__c: 2_000_000,
        ssot__StartDateTime__c: "2026-05-01T00:00:01Z",
      }),
      normalizePlatformSpanRow({
        ssot__Id__c: "orphan",
        ssot__TelemetryTrace__c: "trace",
        ssot__TelemetryParentSpanId__c: "missing-parent",
        ssot__OperationName__c: "apexentrypoint.invocable_action",
        ssot__StatusCode__c: "OK",
        ssot__DurationNumber__c: 1_000_000,
        ssot__StartDateTime__c: "2026-05-01T00:00:02Z",
      }),
    ];

    const tree = buildSpanTree(spans);
    expect(tree.roots.map((node) => node.id)).toEqual(["root", "orphan"]);
    expect(tree.nodesById.root.children.map((node) => node.id)).toEqual(["child"]);
    expect(tree.nodesById.child.depth).toBe(1);
    expect(tree.nodesById.orphan.orphanParentId).toBe("missing-parent");
    expect(tree.orphanCount).toBe(1);

    const summary = summarizeSpanTree(tree);
    expect(summary).toMatchObject({
      totalSpans: 3,
      rootCount: 2,
      orphanCount: 1,
      errorCount: 1,
      maxDepth: 1,
      totalDurationMs: 6,
      errorOperations: ["run.action.Lookup"],
    });
    expect(summary.slowestSpan).toMatchObject({ id: "root", durationMs: 3 });
  });
});
