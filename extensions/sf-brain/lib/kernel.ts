/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Kernel body loader + CLI-missing stub.
 *
 * The full Salesforce operator kernel lives in SF_KERNEL.md next to index.ts.
 * Users can override it by dropping their own file at
 * `<globalAgentDir>/sf-brain/SF_KERNEL.md`. When the override is present, it
 * replaces the bundled kernel verbatim. If it cannot be read for any reason,
 * we fall back silently to the bundled version so sessions never start without
 * a kernel.
 *
 * When the sf CLI is not installed, the full kernel is replaced by a short
 * install stub. Rule 11 in the full kernel still covers this for sessions that
 * somehow get the full kernel despite a missing CLI, but the stub keeps the
 * common case tight.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getLatestCompactionEntry, type SessionEntry } from "@earendil-works/pi-coding-agent";

import { globalAgentPath } from "../../../lib/common/pi-paths.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Opening tag of the kernel block. Used by both kernel variants and by
 * tests as the canonical "this is a kernel" anchor.
 *
 * Boundary convention: lowercase snake_case XML tags, matching pi 0.75's
 * own internal context boundaries (`<conversation>`, `<project_context>`,
 * `<project_instructions>`). See ADR 0008 for the rationale.
 */
export const KERNEL_OPEN_TAG = "<sf_operator_kernel>";
export const KERNEL_CLOSE_TAG = "</sf_operator_kernel>";
/** Human label used inside the open tag for the CLI-missing variant. */
export const KERNEL_MISSING_CLI_NOTE = "sf CLI not detected — install before any operator action";

/** customType used when persisting the kernel into the session. */
export const KERNEL_ENTRY_TYPE = "sf-brain-kernel";

const BUNDLED_KERNEL_PATH = path.resolve(__dirname, "..", "SF_KERNEL.md");

const INSTALL_STUB = `${KERNEL_OPEN_TAG}
${KERNEL_MISSING_CLI_NOTE}

Do not fabricate sf command output. Install first:
  macOS:    brew install --cask salesforce-cli
  Linux:    npm install -g @salesforce/cli
  Windows:  https://developer.salesforce.com/tools/salesforcecli
Verify:     sf --version
Login:      sf org login web --set-default --alias MyOrg
${KERNEL_CLOSE_TAG}
`;

/**
 * Resolve the override kernel path, honoring Pi SDK agent-dir overrides.
 * Exposed for tests.
 */
export function overrideKernelPath(): string {
  return globalAgentPath("sf-brain", "SF_KERNEL.md");
}

/**
 * Read the bundled kernel from SF_KERNEL.md. Exposed for tests.
 * Throws if the bundled file is missing, which only happens if the extension
 * is installed incorrectly.
 */
export function readBundledKernel(): string {
  return readFileSync(BUNDLED_KERNEL_PATH, "utf8").trimEnd() + "\n";
}

/**
 * Load the kernel body for a given CLI state.
 * - CLI missing → short install stub, regardless of override.
 * - CLI installed → user override if present and non-empty, else bundled kernel.
 */
export function loadKernel(options: { cliInstalled: boolean }): string {
  if (!options.cliInstalled) {
    return INSTALL_STUB;
  }

  const overridePath = overrideKernelPath();
  try {
    if (existsSync(overridePath)) {
      const text = readFileSync(overridePath, "utf8").trimEnd();
      if (text.length > 0) {
        return text + "\n";
      }
    }
  } catch {
    // Fall through to bundled kernel.
  }

  return readBundledKernel();
}

/**
 * Type guard for our own persisted kernel entries. Matches the entry shape
 * pi creates when an extension returns `BeforeAgentStartEventResult.message`
 * (`type: "custom_message"`), not the unrelated `pi.appendEntry()` state
 * marker shape (`type: "custom"`). The mismatch is the bug we're fixing:
 * the previous predicate matched on `type === "custom"` and never matched
 * a real kernel entry, so the kernel was re-injected on every turn.
 */
export function isLiveKernelEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const candidate = entry as { type?: string; customType?: string };
  return candidate.type === "custom_message" && candidate.customType === KERNEL_ENTRY_TYPE;
}

/**
 * Decide whether the kernel should be injected on this `before_agent_start`.
 *
 * Pure predicate so it can be unit-tested without a pi runtime. Two contracts:
 *
 * 1. Inject exactly once per *live* session. The kernel is stored as a
 *    `custom_message` entry (LLM-visible) — see `isLiveKernelEntry`.
 *
 * 2. Re-inject after compaction. Pi's `buildSessionContext` only emits entries
 *    from `firstKeptEntryId` onward post-compaction; entries before that are
 *    folded into the compaction summary. The historical kernel custom_message
 *    is still visible to `getEntries()` for replay/debug, but the model no
 *    longer sees it verbatim — only as part of a summary. Treat the kernel as
 *    "live" only if a custom_message kernel entry exists at or after the
 *    *latest* compaction's `firstKeptEntryId`.
 */
export function shouldInjectKernel(entries: readonly SessionEntry[]): boolean {
  const latestCompaction = getLatestCompactionEntry(entries as SessionEntry[]);
  let liveStart = 0;
  if (latestCompaction) {
    const firstKeptIdx = entries.findIndex((e) => e.id === latestCompaction.firstKeptEntryId);
    liveStart = firstKeptIdx >= 0 ? firstKeptIdx : 0;
  }
  for (let i = liveStart; i < entries.length; i++) {
    if (isLiveKernelEntry(entries[i])) return false;
  }
  return true;
}
