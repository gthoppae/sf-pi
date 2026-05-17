/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Small local Data 360 operation registry for the `d360` facade tool.
 *
 * Inspired by the upstream Data 360 MCP server's search/examples/execute
 * facade, but intentionally tiny and curated. Raw coverage still belongs to
 * `d360_api`; this registry only contains operations/runbooks that are useful
 * as deterministic LLM affordances.
 */

export type D360OperationSafety = "read" | "safe_post" | "confirmed" | "destructive";

export interface D360Operation {
  name: string;
  family: string;
  description: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  safety: D360OperationSafety;
  requiredParams?: string[];
  optionalParams?: string[];
  tips?: string;
}

export interface D360RunbookInfo {
  name: string;
  family: string;
  description: string;
  requiredParams?: string[];
  optionalParams?: string[];
  tips?: string;
}

export interface D360Family {
  name: string;
  summary: string;
  keywords: string[];
}

export const D360_FAMILIES: D360Family[] = [
  {
    name: "Query",
    summary: "Run bounded Data 360 SQL and inspect data shape.",
    keywords: ["sql", "query", "count", "sample", "rows", "schema"],
  },
  {
    name: "Metadata",
    summary: "Discover data spaces, DMO schemas, DLO schemas, and compact catalogs.",
    keywords: ["metadata", "dmo", "dlo", "data space", "schema", "catalog"],
  },
  {
    name: "Agent Observability",
    summary: "Analyze Agentforce STDM sessions and Agent Platform Tracing spans.",
    keywords: ["agent", "stdm", "session", "trace", "span", "observability", "error"],
  },
  {
    name: "Segment",
    summary: "Create, inspect, and publish Data Cloud audience segments.",
    keywords: ["segment", "audience", "marketing", "publish", "membership"],
  },
  {
    name: "Activation",
    summary: "Send audiences downstream through activation targets.",
    keywords: ["activation", "target", "marketing cloud", "delivery", "campaign"],
  },
  {
    name: "Calculated Insights",
    summary: "Validate, run, and inspect calculated metrics and insights.",
    keywords: ["calculated insight", "ci", "metric", "score", "aggregate"],
  },
];

export const D360_OPERATIONS: D360Operation[] = [
  {
    name: "d360_query_sql",
    family: "Query",
    description: "Execute a Data 360 SQL query through /ssot/query-sql.",
    method: "POST",
    path: "/ssot/query-sql",
    safety: "safe_post",
    requiredParams: ["sql"],
    optionalParams: ["dataspaceName"],
    tips: "Always bound broad queries with LIMIT or a trace/session/id predicate.",
  },
  {
    name: "d360_data_spaces_list",
    family: "Metadata",
    description: "List Data 360 data spaces.",
    method: "GET",
    path: "/ssot/data-spaces",
    safety: "read",
  },
  {
    name: "d360_dmo_describe",
    family: "Metadata",
    description: "Describe one Data Model Object by API name.",
    method: "GET",
    path: "/ssot/data-model-objects/{dmoName}",
    safety: "read",
    requiredParams: ["dmoName"],
  },
  {
    name: "d360_dlo_describe",
    family: "Metadata",
    description: "Describe one Data Lake Object by API name.",
    method: "GET",
    path: "/ssot/data-lake-objects/{dloName}",
    safety: "read",
    requiredParams: ["dloName"],
  },
  {
    name: "d360_segments_list",
    family: "Segment",
    description: "List segments with optional pagination.",
    method: "GET",
    path: "/ssot/segments",
    safety: "read",
    optionalParams: ["limit", "offset"],
  },
  {
    name: "d360_activations_list",
    family: "Activation",
    description: "List activations with optional pagination.",
    method: "GET",
    path: "/ssot/activations",
    safety: "read",
    optionalParams: ["limit", "offset"],
  },
  {
    name: "d360_calculated_insights_list",
    family: "Calculated Insights",
    description: "List calculated insights.",
    method: "GET",
    path: "/ssot/calculated-insights",
    safety: "read",
    optionalParams: ["limit", "offset"],
  },
];

export const D360_RUNBOOKS: D360RunbookInfo[] = [
  {
    name: "agent_observability.platform_error_traces",
    family: "Agent Observability",
    description: "Find recent Agent Platform Tracing ERROR spans.",
    optionalParams: ["since", "limit"],
  },
  {
    name: "agent_observability.platform_trace_tree",
    family: "Agent Observability",
    description: "Fetch and reconstruct a Platform Tracing span tree by trace id.",
    requiredParams: ["trace_id"],
  },
  {
    name: "agent_observability.join_interaction_trace",
    family: "Agent Observability",
    description: "Join one STDM interaction to messages, steps, and Platform Tracing spans.",
    requiredParams: ["interaction_id"],
  },
  {
    name: "agent_observability.stdm_session_timeline",
    family: "Agent Observability",
    description: "Fetch an STDM conversation timeline for a session id.",
    requiredParams: ["session_id"],
  },
  {
    name: "agent_observability.operation_latency_summary",
    family: "Agent Observability",
    description: "Aggregate Platform Tracing duration by operation name.",
    optionalParams: ["since", "limit"],
  },
];

export const D360_EXAMPLES: Record<string, unknown> = {
  d360_query_sql: {
    operation: "d360_query_sql",
    params: {
      dataspaceName: "default",
      sql: 'SELECT COUNT(*) AS n FROM "ssot__TelemetryTraceSpan__dlm"',
    },
  },
  d360_dlo_describe: {
    operation: "d360_dlo_describe",
    params: { dloName: "ObservabilitySpans__dll" },
  },
  "agent_observability.platform_trace_tree": {
    runbook: "agent_observability.platform_trace_tree",
    params: { trace_id: "d18ba385fe932069deeb078f48d158d1" },
  },
  "agent_observability.join_interaction_trace": {
    runbook: "agent_observability.join_interaction_trace",
    params: { interaction_id: "64a3c2001eb45a35aebc575b743506c1" },
  },
};

export function findOperation(name: string): D360Operation | undefined {
  return D360_OPERATIONS.find((op) => op.name === name);
}

export function findRunbook(name: string): D360RunbookInfo | undefined {
  return D360_RUNBOOKS.find((runbook) => runbook.name === name);
}

export function searchRegistry(query: string): Array<{
  family: string;
  score: number;
  summary: string;
  operations: string[];
  runbooks: string[];
}> {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(Boolean);
  const scored = D360_FAMILIES.map((family) => {
    const haystack = [family.name, family.summary, ...family.keywords].join(" ").toLowerCase();
    const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
    return {
      family: family.name,
      score,
      summary: family.summary,
      operations: D360_OPERATIONS.filter((op) => op.family === family.name).map((op) => op.name),
      runbooks: D360_RUNBOOKS.filter((runbook) => runbook.family === family.name).map(
        (runbook) => runbook.name,
      ),
    };
  });
  return scored
    .filter((entry) => entry.score > 0 || terms.length === 0)
    .sort((a, b) => b.score - a.score || a.family.localeCompare(b.family))
    .slice(0, 6);
}
