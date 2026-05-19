/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Standard Data 360 result-card contract.
 *
 * This file is intentionally pure: no pi runtime imports, no TUI imports, and
 * no filesystem writes. Data 360 tools can map any domain result (STDM,
 * Platform Tracing, segments, activations, ingestion, etc.) into this compact
 * card shape, then use the render helpers for model-facing content and future
 * TUI renderers.
 */

export type D360CardStatus = "success" | "warning" | "error";
export type D360ArtifactKind = "json" | "sql" | "markdown" | "csv";
export type D360WorkflowStageKey = "readiness" | "discover" | "resolve" | "execute" | "summarize";

export interface D360ResultFact {
  label: string;
  value: string;
}

export interface D360ResultSection {
  title: string;
  icon?: string;
  lines: string[];
}

export interface D360ResultArtifact {
  label: string;
  path: string;
  kind: D360ArtifactKind;
}

export interface D360CardStage {
  key: D360WorkflowStageKey;
  label: string;
  index: number;
  total: number;
  /** Defaults to the standard Data 360 workflow. */
  workflow?: string[];
  /** One or two lines explaining why this stage matters. */
  description?: string;
}

export interface D360CardRequest {
  method?: string;
  path?: string;
  targetOrg?: string;
  apiVersion?: string;
  orgType?: string;
  safety?: string;
  capability?: string;
  operation?: string;
  /** JSON payload/body. Use null for an explicit empty body. */
  payload?: unknown;
}

export interface D360CardResponse {
  title?: string;
  lines: string[];
}

export interface D360CardLineage {
  title?: string;
  lines: string[];
}

export interface D360ResultCard {
  status: D360CardStatus;
  icon: string;
  title: string;
  subtitle?: string;
  /** One-sentence outcome. */
  summary: string;
  stage?: D360CardStage;
  request?: D360CardRequest;
  response?: D360CardResponse;
  lineage?: D360CardLineage;
  facts?: D360ResultFact[];
  sections?: D360ResultSection[];
  artifacts?: D360ResultArtifact[];
  nextSteps?: string[];
}

export interface D360CardRenderOptions {
  /** Default is adaptive, usually 48. Includes header/body/artifacts/next-step lines. */
  collapsedMaxLines?: number;
  /** Default 120. Applies only to expanded rendering. */
  expandedMaxLines?: number;
  /** Default 140. Long values wrap instead of clipping. */
  lineMaxChars?: number;
  /** Add two-space indentation for body lines. Default false for LLM content. */
  indentBody?: boolean;
}

const STATUS_ICON: Record<D360CardStatus, string> = {
  success: "✅",
  warning: "⚠️",
  error: "❌",
};

const STATUS_LABEL: Record<D360CardStatus, string> = {
  success: "Success",
  warning: "Warning",
  error: "Error",
};

export function renderCardForLlm(card: D360ResultCard, opts: D360CardRenderOptions = {}): string {
  const lines = renderExpandedLines(card, {
    ...opts,
    expandedMaxLines: opts.expandedMaxLines ?? 80,
  });
  return lines.join("\n");
}

export function renderCardCollapsed(
  card: D360ResultCard,
  opts: D360CardRenderOptions = {},
): string {
  const maxLines = opts.collapsedMaxLines ?? adaptiveCollapsedLineBudget(card);
  const lines = buildCardLines(card, opts, "collapsed");
  return clampLines(lines, maxLines, opts).join("\n");
}

export function renderCardExpanded(card: D360ResultCard, opts: D360CardRenderOptions = {}): string {
  return renderExpandedLines(card, opts).join("\n");
}

function renderExpandedLines(card: D360ResultCard, opts: D360CardRenderOptions): string[] {
  const maxLines = opts.expandedMaxLines ?? 120;
  const lines = buildCardLines(card, opts, "expanded");
  return clampLines(lines, maxLines, opts);
}

function buildCardLines(
  card: D360ResultCard,
  opts: D360CardRenderOptions,
  mode: "collapsed" | "expanded",
): string[] {
  const maxChars = opts.lineMaxChars ?? 140;
  const bodyPrefix = opts.indentBody ? "  " : "";
  const title = stageTitle(card);
  const lines = wrapLine(`╭─ ${title}`, maxChars);

  for (const line of buildHeaderLines(card)) lines.push(...wrapLine(`│  ${line}`, maxChars));

  if (card.stage?.key === "resolve") {
    pushStageContext(lines, card, maxChars, bodyPrefix, mode);
    pushRequest(lines, card, maxChars, bodyPrefix, mode);
    pushResult(lines, card, maxChars, bodyPrefix, mode);
  } else {
    pushResult(lines, card, maxChars, bodyPrefix, mode);
    pushStageContext(lines, card, maxChars, bodyPrefix, mode);
    pushRequest(lines, card, maxChars, bodyPrefix, mode);
  }

  const showCollapsedFacts = mode === "collapsed" && !card.sections?.length && !card.response;
  if (card.facts?.length && (mode === "expanded" || showCollapsedFacts)) {
    pushSection(
      lines,
      "Facts",
      (mode === "collapsed" ? card.facts.slice(0, 4) : card.facts).map(
        (fact) => `• ${fact.label}: ${fact.value}`,
      ),
      maxChars,
      bodyPrefix,
      mode,
    );
  }

  for (const section of card.sections ?? []) {
    const sectionLimit = sectionLineLimit(section.lines.length, mode);
    const sectionLines = section.lines.slice(0, sectionLimit);
    const omitted = section.lines.length - sectionLimit;
    pushSection(
      lines,
      `${section.icon ?? "•"} ${section.title}`,
      omitted > 0
        ? [...sectionLines, `… ${omitted} more in full output or artifact`]
        : sectionLines,
      maxChars,
      bodyPrefix,
      mode,
    );
  }

  if (card.lineage?.lines.length) {
    pushSection(
      lines,
      card.lineage.title ?? "Lineage",
      card.lineage.lines,
      maxChars,
      bodyPrefix,
      mode,
    );
  }

  if (card.artifacts?.length) {
    pushSection(
      lines,
      "Artifacts",
      card.artifacts.map(
        (artifact) => `${artifactIcon(artifact.kind)} ${artifact.label}: ${artifact.path}`,
      ),
      maxChars,
      bodyPrefix,
      mode,
    );
  }

  if (card.nextSteps?.length) {
    const next = mode === "collapsed" ? card.nextSteps.slice(0, 2) : card.nextSteps;
    pushSection(
      lines,
      "Next",
      next.map((step) => `→ ${step}`),
      maxChars,
      bodyPrefix,
      mode,
      true,
    );
  } else {
    lines.push("╰─");
  }

  return lines;
}

function pushStageContext(
  lines: string[],
  card: D360ResultCard,
  maxChars: number,
  bodyPrefix: string,
  mode: "collapsed" | "expanded",
): void {
  if (card.stage?.description) {
    pushSection(lines, "Why this stage", [card.stage.description], maxChars, bodyPrefix, mode);
  }
}

function pushRequest(
  lines: string[],
  card: D360ResultCard,
  maxChars: number,
  bodyPrefix: string,
  mode: "collapsed" | "expanded",
): void {
  if (card.request) {
    pushSection(lines, "API request", requestLines(card.request, mode), maxChars, bodyPrefix, mode);
  }
}

function pushResult(
  lines: string[],
  card: D360ResultCard,
  maxChars: number,
  bodyPrefix: string,
  mode: "collapsed" | "expanded",
): void {
  if (card.summary) {
    pushSection(lines, "Result summary", responseLines(card), maxChars, bodyPrefix, mode);
  }
}

function stageTitle(card: D360ResultCard): string {
  const base =
    `${card.icon} ${card.title} ${STATUS_ICON[card.status]} ${STATUS_LABEL[card.status]}`.trim();
  if (!card.stage) return base;
  return `${base}  Stage ${card.stage.index}/${card.stage.total}: ${card.stage.label}`;
}

function buildHeaderLines(card: D360ResultCard): string[] {
  const lines: string[] = [];
  if (card.stage)
    lines.push(`Progress: ${card.stage.index}/${card.stage.total} ${card.stage.label}`);
  if (card.subtitle) lines.push(card.subtitle);
  const request = card.request;
  const details = [
    request?.targetOrg ? `Target: ${request.targetOrg}` : undefined,
    request?.apiVersion ? `API v${request.apiVersion}` : undefined,
    request?.orgType,
    request?.capability
      ? `Capability: ${request.capability}`
      : request?.operation
        ? `Operation: ${request.operation}`
        : undefined,
    request?.safety ? `Safety: ${request.safety}` : undefined,
  ].filter((value): value is string => Boolean(value));
  if (details.length) lines.push(details.join(" · "));
  return lines;
}

function pushSection(
  lines: string[],
  title: string,
  values: string[],
  maxChars: number,
  bodyPrefix: string,
  mode: "collapsed" | "expanded",
  isFinal = false,
): void {
  if (!values.length) return;
  lines.push("");
  lines.push(`${isFinal ? "╰─ " : ""}${title}`);
  const bodyIndent = isFinal ? "   " : "  ";
  for (const value of values) {
    const wrapped = wrapLine(`${bodyIndent}${value}`, maxChars);
    lines.push(...wrapped);
  }
}

function requestLines(request: D360CardRequest, mode: "collapsed" | "expanded"): string[] {
  const lines = [
    `${request.method ?? "?"} ${request.path ?? "?"}`,
    ...payloadLines(request.payload, mode),
  ];
  return lines;
}

function payloadLines(payload: unknown, mode: "collapsed" | "expanded"): string[] {
  if (payload === undefined || payload === null) return ["Payload: none"];

  const text = safeJson(payload);
  const jsonLines = text.split("\n");
  const maxPayloadLines = mode === "collapsed" ? 14 : 32;
  if (jsonLines.length <= maxPayloadLines)
    return ["Payload", ...jsonLines.map((line) => `  ${line}`)];
  return [
    "Payload",
    ...jsonLines.slice(0, maxPayloadLines).map((line) => `  ${line}`),
    `  … payload has ${jsonLines.length - maxPayloadLines} more line(s); see full artifact if available`,
  ];
}

function responseLines(card: D360ResultCard): string[] {
  return [card.summary, ...(card.response?.lines ?? [])].filter(Boolean);
}

function sectionLineLimit(lineCount: number, mode: "collapsed" | "expanded"): number {
  if (mode === "expanded") return lineCount;
  if (lineCount <= 10) return lineCount;
  return 10;
}

function adaptiveCollapsedLineBudget(card: D360ResultCard): number {
  if (card.request && card.lineage) return 56;
  if (card.sections?.some((section) => section.lines.length > 10)) return 52;
  if (card.stage || card.lineage) return 44;
  return 36;
}

function clampLines(lines: string[], maxLines: number, opts: D360CardRenderOptions): string[] {
  if (maxLines <= 0 || lines.length <= maxLines) return lines;
  const maxChars = opts.lineMaxChars ?? 140;
  const artifactStart = lines.findIndex((line) => line.trim() === "Artifacts");
  const nextStart = lines.findIndex((line) => line.startsWith("╰─ Next"));
  const preservedStart = [artifactStart, nextStart]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  const preserved = preservedStart === undefined ? [] : lines.slice(preservedStart);
  const bodyBudget = Math.max(1, maxLines - preserved.length - 1);
  const body = lines.slice(0, bodyBudget);
  const omitted = lines.length - body.length - preserved.length;
  const omittedLine =
    omitted > 0 ? wrapLine(`│  … ${omitted} more line(s) in expanded output`, maxChars) : [];
  return [...body, ...omittedLine, ...preserved].slice(0, maxLines);
}

function artifactIcon(kind: D360ArtifactKind): string {
  switch (kind) {
    case "sql":
      return "🧾";
    case "markdown":
      return "📝";
    case "csv":
      return "📊";
    case "json":
    default:
      return "📄";
  }
}

function wrapLine(value: string, maxChars: number): string[] {
  const normalized = value.replace(/\s+$/u, "");
  if (normalized.length <= maxChars) return [normalized];

  const leading = linePrefix(normalized);
  const continuation = `${leading}  `;
  const words = normalized.trimStart().split(/\s+/u);
  const lines: string[] = [];
  let current = leading;

  for (const word of words) {
    const separator = current.trim() ? " " : "";
    if (`${current}${separator}${word}`.length <= maxChars) {
      current = `${current}${separator}${word}`;
      continue;
    }
    if (current.trim()) lines.push(current);
    if (`${continuation}${word}`.length > maxChars) {
      lines.push(...breakLongWord(word, continuation, maxChars));
      current = continuation;
    } else {
      current = `${continuation}${word}`;
    }
  }

  if (current.trim()) lines.push(current);
  return lines.length ? lines : [normalized];
}

function linePrefix(value: string): string {
  return value.match(/^(?:[│╭├╰]─?\s*|\s*)/u)?.[0] ?? "";
}

function breakLongWord(word: string, prefix: string, maxChars: number): string[] {
  const chunkSize = Math.max(8, maxChars - prefix.length);
  const lines: string[] = [];
  for (let i = 0; i < word.length; i += chunkSize) {
    lines.push(`${prefix}${word.slice(i, i + chunkSize)}`);
  }
  return lines;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
