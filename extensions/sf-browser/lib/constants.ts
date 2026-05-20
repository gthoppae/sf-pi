/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Constants for SF Browser's deliberately small agent-browser integration.
 */

export const EXTENSION_ID = "sf-browser";
export const COMMAND_NAME = "sf-browser";
export const SF_BROWSER_SESSION = "sf-pi";
export const DEFAULT_AGENT_BROWSER_TIMEOUT_MS = 60_000;
export const DEFAULT_SF_OPEN_TIMEOUT_MS = 120_000;

export const INSTALL_GUIDANCE = [
  "agent-browser is required for SF Browser runtime actions.",
  "Install once:",
  "  npm i -g agent-browser",
  "  agent-browser install",
].join("\n");
