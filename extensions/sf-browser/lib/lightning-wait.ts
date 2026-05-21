/* SPDX-License-Identifier: Apache-2.0 */
/** Browser-side Lightning wait helpers for SF Browser. */

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

export interface LightningOutcomeDetails {
  outcome: LightningWaitOutcome;
  matched?: { selector?: string; text?: string; url?: string };
}

export function buildLightningWaitExpression(mode: LightningWaitModeValue): string {
  return `(() => { ${LIGHTNING_WAIT_HELPERS} return window.__sfPiLightningWait(${JSON.stringify(mode)}); })()`;
}

export function buildLightningOutcomeExpression(mode: LightningWaitModeValue): string {
  return `(() => { ${LIGHTNING_WAIT_HELPERS} return JSON.stringify(window.__sfPiLightningOutcome(${JSON.stringify(mode)})); })()`;
}

export const LIGHTNING_WAIT_HELPERS = String.raw`
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
  return firstVisible([
    '[role="dialog"]',
    '.slds-modal__container',
    '.slds-modal',
    '.uiModal',
    '.modal-container',
    'lightning-modal'
  ]);
}
function toastVisible() {
  return firstVisible([
    '.slds-notify_toast',
    '.slds-notify.slds-notify_toast',
    '.forceToastMessage',
    '[data-aura-class*="forceToastMessage"]',
    '.toastMessage',
    '[role="status"].slds-notify',
    '[role="alert"].slds-notify',
    'lightning-toast'
  ]);
}
function spinnerVisible() {
  return firstVisible([
    '.slds-spinner_container',
    '.slds-spinner',
    '.slds-is-loading',
    '.lafPageHostLoading',
    'lightning-spinner',
    '[role="progressbar"]',
    '[aria-busy="true"]'
  ]);
}
function validationVisible() {
  return firstVisible([
    '[aria-invalid="true"]',
    '.slds-has-error',
    '.slds-form-element__help',
    '.fieldLevelErrors',
    '[data-error-message]',
    '[part="error-message"]',
    'lightning-input-field.slds-has-error',
    '[data-aura-class*="error"]'
  ]);
}
function classicErrorVisible() {
  return firstVisible(['#error', '.errorMsg', '.message.errorM3', '.pbError', '.error']);
}
function bodyHasErrorText() {
  const text = textOf(document.body);
  if (/please fix the following|review the errors|complete this field|required field|invalid value|unable to save|problem saving/i.test(text)) {
    return { selector: 'body', text };
  }
  return null;
}
function appReady() {
  if (document.readyState === 'loading' || !document.body) return null;
  if (spinnerVisible()) return null;
  if (!textOf(document.body)) return null;
  return { selector: 'body' };
}
function classifySaveResult() {
  const toast = toastVisible();
  if (toast) {
    const text = textOf(toast.el);
    if (/error|failed|can't|cannot|invalid|unable|problem/i.test(text)) return { outcome: 'error-toast', matched: { selector: toast.selector, text } };
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
  if (mode === 'modal-open') return modalVisible() ? { outcome: 'modal-open', matched: { selector: modalVisible().selector, text: textOf(modalVisible().el) } } : { outcome: 'ambiguous' };
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
