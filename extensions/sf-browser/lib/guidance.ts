/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Just-in-time Salesforce browser guidance.
 *
 * Keep this concise: detailed browser command syntax belongs to agent-browser's
 * own skill, while SF Browser contracts focus on Salesforce UI behavior.
 */

export const SALESFORCE_BROWSER_GUIDANCE = [
  "SF Browser is experimental developer-assistive automation for Salesforce UI last-mile work; it is not a stable Salesforce UI automation contract.",
  "Use Salesforce APIs first for setup and verification. Use the browser for UI-only gaps.",
  "Run sf_browser_snapshot before acting. Re-snapshot after clicks, saves, modal opens, navigation, tab switches, or Lightning rerenders; refs are short-lived.",
  "Prefer refs from the latest snapshot. If ref-based tools are insufficient, use direct agent-browser commands for the long tail.",
  "For Salesforce lookup/combobox controls: fill the visible input, wait for options, snapshot, then click the desired option.",
  "For Setup pages, prefer curated Setup Destinations over search-and-click navigation when the target path is known.",
  "For Setup and Lightning pages, wait for expected text or URL patterns instead of relying on DOMContentLoaded alone.",
  "Capture Browser Evidence with artifact mode for batches and thumbnail mode when the model should inspect the current screen. Keep dismissOverlays enabled unless the overlay is the subject of the evidence.",
].join("\n");

export const OPEN_NEXT_STEPS = [
  "Next:",
  "1. Run sf_browser_snapshot.",
  "2. Use refs from the latest snapshot for click/fill.",
  "3. After page-changing actions, wait and snapshot again.",
  "4. Use Salesforce APIs for verification when possible.",
  "5. Capture Browser Evidence when visual confirmation matters.",
].join("\n");

export const STALE_REF_HINT =
  "Salesforce hint: refs are short-lived. After clicks, saves, modal opens, navigation, or Lightning rerenders, run sf_browser_snapshot before reusing refs.";

export const RAW_AGENT_BROWSER_ESCAPE_HATCH =
  "For advanced browser work outside SF Browser's hot path, use direct agent-browser commands.";
