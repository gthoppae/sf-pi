/* SPDX-License-Identifier: Apache-2.0 */
/** Wait tool for Salesforce async UI rendering. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { DEFAULT_AGENT_BROWSER_TIMEOUT_MS } from "./constants.ts";
import { runAgentBrowser } from "./agent-browser.ts";
import { STALE_REF_HINT } from "./guidance.ts";
import { startTimer } from "./timing.ts";
import { okText } from "./tool-support.ts";

export const SF_BROWSER_WAIT_TOOL_NAME = "sf_browser_wait";

const LoadState = StringEnum(["domcontentloaded", "networkidle"] as const, {
  description: "Load state to wait for.",
});

const LightningWaitMode = StringEnum(
  [
    "app-ready",
    "record-view",
    "modal-open",
    "modal-closed",
    "toast",
    "spinner-gone",
    "save-result",
  ] as const,
  {
    description:
      "Salesforce Lightning semantic state to wait for. save-result classifies the first visible post-save outcome; it is not a success assertion.",
  },
);

export type LightningWaitModeValue =
  | "app-ready"
  | "record-view"
  | "modal-open"
  | "modal-closed"
  | "toast"
  | "spinner-gone"
  | "save-result";

export type LightningWaitOutcome =
  | "app-ready"
  | "record-view"
  | "modal-open"
  | "modal-closed"
  | "toast"
  | "spinner-gone"
  | "success-toast"
  | "error-toast"
  | "validation-error"
  | "classic-error"
  | "ambiguous";

export interface WaitClassification {
  ambiguous: boolean;
  label: string;
  note?: string;
}

interface LightningOutcomeDetails {
  outcome: LightningWaitOutcome;
  matched?: { selector?: string; text?: string; url?: string };
}

export function classifyWait(durationMs: number, params: { ms?: number }): WaitClassification {
  if (typeof params.ms === "number") {
    return { ambiguous: false, label: "Wait finished" };
  }
  if (durationMs >= DEFAULT_AGENT_BROWSER_TIMEOUT_MS * 0.9) {
    return {
      ambiguous: true,
      label: "Wait may have timed out",
      note: "No hard error was returned, but the wait reached the timeout window. Snapshot or verify through API before continuing.",
    };
  }
  return { ambiguous: false, label: "Wait finished" };
}

export function registerSfBrowserWaitTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: SF_BROWSER_WAIT_TOOL_NAME,
    label: "SF Browser Wait",
    description:
      "Wait for Salesforce UI progress using expected text, URL pattern, load state, Lightning semantic state, or a last-resort millisecond delay. Prefer text, URL, or Lightning waits over fixed sleeps; long waits are reported as ambiguous when they reach the timeout window.",
    promptSnippet: "Wait for Salesforce UI text, URL, load state, Lightning state, or delay",
    promptGuidelines: [
      "Use sf_browser_wait with expected text, URL, or lightning state after Salesforce actions; use ms only as a last resort for Lightning async rendering.",
      "Use lightning='save-result' after Save to classify success, validation, error, or ambiguous post-save outcomes; it is not a success assertion.",
      "If sf_browser_wait says the wait may have timed out, snapshot or verify through API before continuing.",
    ],
    parameters: Type.Object({
      text: Type.Optional(
        Type.String({ description: "Visible text to wait for, such as Saved or Success." }),
      ),
      url: Type.Optional(
        Type.String({ description: "URL glob to wait for, such as **/lightning/setup/**." }),
      ),
      load: Type.Optional(LoadState),
      lightning: Type.Optional(LightningWaitMode),
      ms: Type.Optional(Type.Number({ description: "Milliseconds to wait. Last resort only." })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const modeCount = [params.text, params.url, params.load, params.lightning, params.ms].filter(
        (value) => value !== undefined && value !== "",
      ).length;
      if (modeCount !== 1) {
        throw new Error(
          "sf_browser_wait expects exactly one of text, url, load, lightning, or ms.",
        );
      }

      const stopTimer = startTimer();
      const args = buildWaitArgs(params);
      await runAgentBrowser(pi, args, { cwd: ctx.cwd, signal });
      const duration = stopTimer();
      const lightningDetails = params.lightning
        ? await getLightningOutcome(pi, ctx.cwd, params.lightning, signal)
        : undefined;
      const classification = classifyWait(duration.durationMs, params);
      const outcome = lightningDetails?.outcome;
      const ambiguous = classification.ambiguous || outcome === "ambiguous";
      return {
        content: [
          {
            type: "text" as const,
            text: okText([
              `${classification.label}: ${describeWait(params)}.`,
              outcome ? `Outcome: ${outcome}.` : undefined,
              lightningDetails?.matched?.text
                ? `Matched text: ${lightningDetails.matched.text}`
                : undefined,
              lightningDetails?.matched?.url
                ? `Matched URL: ${lightningDetails.matched.url}`
                : undefined,
              `Duration: ${duration.durationText}`,
              classification.note,
              "Prefer expected text, URL, or Lightning waits over fixed sleeps for Salesforce Lightning pages.",
              STALE_REF_HINT,
            ]),
          },
        ],
        details: {
          ok: true,
          ambiguous,
          wait: params,
          ...(lightningDetails
            ? { outcome: lightningDetails.outcome, matched: lightningDetails.matched }
            : {}),
          ...duration,
        },
      };
    },
  });
}

export function buildWaitArgs(params: {
  text?: string;
  url?: string;
  load?: string;
  lightning?: LightningWaitModeValue;
  ms?: number;
}): string[] {
  if (params.text) return ["wait", "--text", params.text];
  if (params.url) return ["wait", "--url", params.url];
  if (params.load) return ["wait", "--load", params.load];
  if (params.lightning) return ["wait", "--fn", buildLightningWaitExpression(params.lightning)];
  return ["wait", String(Math.max(0, Math.floor(params.ms ?? 0)))];
}

function describeWait(params: {
  text?: string;
  url?: string;
  load?: string;
  lightning?: LightningWaitModeValue;
  ms?: number;
}): string {
  if (params.text) return `text ${JSON.stringify(params.text)}`;
  if (params.url) return `url ${JSON.stringify(params.url)}`;
  if (params.load) return `load ${params.load}`;
  if (params.lightning) return `lightning ${params.lightning}`;
  return `${Math.max(0, Math.floor(params.ms ?? 0))}ms`;
}

export function buildLightningWaitExpression(mode: LightningWaitModeValue): string {
  return `(() => { ${LIGHTNING_HELPERS} return window.__sfPiLightningWait(${JSON.stringify(mode)}); })()`;
}

async function getLightningOutcome(
  pi: ExtensionAPI,
  cwd: string,
  mode: LightningWaitModeValue,
  signal: AbortSignal | undefined,
): Promise<LightningOutcomeDetails> {
  try {
    const result = await runAgentBrowser(
      pi,
      [
        "eval",
        `(() => { ${LIGHTNING_HELPERS} return JSON.stringify(window.__sfPiLightningOutcome(${JSON.stringify(mode)})); })()`,
      ],
      { cwd, signal, timeoutMs: 15_000 },
    );
    return JSON.parse(result.stdout.trim()) as LightningOutcomeDetails;
  } catch {
    return { outcome: "ambiguous" };
  }
}

const LIGHTNING_HELPERS = String.raw`
function visible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
}
function firstVisible(selectors) {
  for (const selector of selectors) {
    const found = Array.from(document.querySelectorAll(selector)).find(visible);
    if (found) return { el: found, selector };
  }
  return null;
}
function textOf(el) {
  return (el && (el.innerText || el.textContent) || '').trim().replace(/\s+/g, ' ').slice(0, 500);
}
function recordViewMatch() {
  const match = location.pathname.match(/\/lightning\/r\/([^/]+)\/([a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?)\/view/);
  if (!match) return null;
  return { selector: 'location.pathname', url: location.pathname };
}
function modalVisible() {
  return firstVisible(['.slds-modal__container', '.slds-modal', 'lightning-modal']);
}
function toastVisible() {
  return firstVisible(['.slds-notify_toast', '.forceToastMessage', '.toastMessage', 'lightning-toast']);
}
function spinnerVisible() {
  return firstVisible(['.slds-spinner_container', '.slds-spinner', 'lightning-spinner', '[role="progressbar"]']);
}
function validationVisible() {
  return firstVisible(['[aria-invalid="true"]', '.slds-has-error', '.slds-form-element__help', '.fieldLevelErrors', '[data-aura-class*="error"]']);
}
function classicErrorVisible() {
  return firstVisible(['#error', '.errorMsg', '.message.errorM3', '.pbError', '.error']);
}
function bodyHasErrorText() {
  const text = textOf(document.body);
  if (/please fix the following|review the errors|complete this field|required field|invalid value|can't |cannot /i.test(text)) {
    return { selector: 'body', text };
  }
  return null;
}
function appReady() {
  if (document.readyState === 'loading' || !document.body) return null;
  if (!textOf(document.body)) return null;
  return { selector: 'body' };
}
function classifySaveResult() {
  const toast = toastVisible();
  if (toast) {
    const text = textOf(toast.el);
    if (/error|failed|can't|cannot|invalid/i.test(text)) return { outcome: 'error-toast', matched: { selector: toast.selector, text } };
    return { outcome: 'success-toast', matched: { selector: toast.selector, text } };
  }
  const validation = validationVisible();
  if (validation) return { outcome: 'validation-error', matched: { selector: validation.selector, text: textOf(validation.el) } };
  const bodyError = bodyHasErrorText();
  if (bodyError) return { outcome: 'validation-error', matched: bodyError };
  const classic = classicErrorVisible();
  if (classic) return { outcome: 'classic-error', matched: { selector: classic.selector, text: textOf(classic.el) } };
  const record = recordViewMatch();
  if (record) return { outcome: 'record-view', matched: record };
  return { outcome: 'ambiguous' };
}
window.__sfPiLightningOutcome = function(mode) {
  if (mode === 'save-result') return classifySaveResult();
  if (mode === 'app-ready') return appReady() ? { outcome: 'app-ready', matched: appReady() } : { outcome: 'ambiguous' };
  if (mode === 'record-view') return recordViewMatch() ? { outcome: 'record-view', matched: recordViewMatch() } : { outcome: 'ambiguous' };
  if (mode === 'modal-open') return modalVisible() ? { outcome: 'modal-open', matched: { selector: modalVisible().selector } } : { outcome: 'ambiguous' };
  if (mode === 'modal-closed') return !modalVisible() ? { outcome: 'modal-closed' } : { outcome: 'ambiguous' };
  if (mode === 'toast') return toastVisible() ? { outcome: 'toast', matched: { selector: toastVisible().selector, text: textOf(toastVisible().el) } } : { outcome: 'ambiguous' };
  if (mode === 'spinner-gone') return !spinnerVisible() ? { outcome: 'spinner-gone' } : { outcome: 'ambiguous' };
  return { outcome: 'ambiguous' };
};
window.__sfPiLightningWait = function(mode) {
  const outcome = window.__sfPiLightningOutcome(mode).outcome;
  return outcome !== 'ambiguous';
};
`;
