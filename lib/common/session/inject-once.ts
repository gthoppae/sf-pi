/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared "inject this custom_message exactly once per live session" helper.
 *
 * Three sf-pi extensions (sf-brain, sf-guardrail, sf-slack) inject hidden
 * `custom_message` entries from `before_agent_start`. The pattern is
 * identical:
 *
 *   1. Each call writes one entry the LLM sees on every replay (cache-friendly).
 *   2. The entry must be injected exactly once per *live* session — not on
 *      every turn — or the prompt bloats by N copies after N turns.
 *   3. Pi's compaction can sweep early entries into the summary; after that,
 *      the model no longer sees the entry verbatim and the extension must
 *      re-inject so the rules / identity / context stay live.
 *
 * Two pi-side traps the helper exists to neutralize:
 *
 * - **Entry-type mismatch.** Pi has two unrelated custom shapes:
 *     - `CustomEntry` (`type: "custom"`) — state-only marker, NOT in LLM
 *       context. Created via `pi.appendEntry()`.
 *     - `CustomMessageEntry` (`type: "custom_message"`) — content the LLM
 *       sees. Created when an extension returns
 *       `BeforeAgentStartEventResult.message`.
 *   Predicates that check `type === "custom"` never match a real injection.
 *   This helper only matches `custom_message`, so the bug class disappears.
 *
 * - **Compaction window.** `getEntries()` returns every historical entry,
 *   even those folded into a compaction summary. The helper anchors the
 *   "live" window at the latest compaction's `firstKeptEntryId` so a
 *   summarized-away entry no longer counts as "still injected."
 */
import {
  getLatestCompactionEntry,
  type CustomMessageEntry,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";

/**
 * Type guard for a `custom_message` entry with the given customType.
 * Use this instead of hand-rolling `entry.type === "custom"` checks — the
 * `"custom"` shape is a different (state-only) entry kind that never
 * matches what extensions actually inject.
 */
export function isLiveCustomMessageEntry(
  entry: unknown,
  customType: string,
): entry is CustomMessageEntry {
  if (!entry || typeof entry !== "object") return false;
  const candidate = entry as { type?: string; customType?: string };
  return candidate.type === "custom_message" && candidate.customType === customType;
}

/**
 * Decide whether a `custom_message` of the given customType should be
 * injected on this `before_agent_start`.
 *
 * Returns `true` (inject) when no live entry of the given customType exists
 * at or after the latest compaction's `firstKeptEntryId`.
 *
 * The optional `predicate` is run against any matching entries inside the
 * live window. Return `true` from the predicate when an entry counts as a
 * still-valid injection, `false` to ignore it (e.g. the content has gone
 * stale and a fresh injection is needed). Default: every match counts.
 */
export function shouldInjectOnce(
  entries: readonly SessionEntry[],
  customType: string,
  predicate: (entry: CustomMessageEntry) => boolean = () => true,
): boolean {
  const latestCompaction = getLatestCompactionEntry(entries as SessionEntry[]);
  let liveStart = 0;
  if (latestCompaction) {
    const firstKeptIdx = entries.findIndex((e) => e.id === latestCompaction.firstKeptEntryId);
    liveStart = firstKeptIdx >= 0 ? firstKeptIdx : 0;
  }
  for (let i = liveStart; i < entries.length; i++) {
    const entry = entries[i];
    if (isLiveCustomMessageEntry(entry, customType) && predicate(entry)) {
      return false;
    }
  }
  return true;
}
