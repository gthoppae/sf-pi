/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Execution-level tests for the kernel injection predicate.
 *
 * Two pi-side contracts the predicate has to honor and that the previous
 * implementation got wrong:
 *
 * 1. **Entry-type mismatch.** Pi exposes two custom entry shapes that look
 *    the same in casual reading but are very different in behavior:
 *
 *    - `CustomEntry` (`type: "custom"`) — extension state/marker. NOT in LLM
 *      context. Created via `pi.appendEntry()`.
 *    - `CustomMessageEntry` (`type: "custom_message"`) — extension content
 *      that the LLM actually sees. Created when an extension returns
 *      `BeforeAgentStartEventResult.message` (pi internally calls
 *      `appendCustomMessageEntry`).
 *
 *    sf-brain returns `BeforeAgentStartEventResult.message`, so the kernel
 *    is stored as `custom_message`. A predicate that checks `type === "custom"`
 *    never matches and re-injects the kernel on every turn (the bug we just
 *    fixed). These tests pin the correct match shape so it cannot regress.
 *
 * 2. **Compaction summarization.** Pi's `buildSessionContext` emits only
 *    entries from `firstKeptEntryId` onward post-compaction; everything
 *    earlier is folded into the compaction summary. The kernel
 *    `custom_message` at index 0 is still in `getEntries()` (entries are
 *    immutable for replay/debug) but the LLM only sees the *summary* of it.
 *    The predicate has to treat the kernel as "live" only when a kernel
 *    entry exists at or after the latest `firstKeptEntryId`, otherwise the
 *    rules quietly degrade to a paraphrase mid-session.
 */
import { describe, expect, it } from "vitest";
import type {
  CompactionEntry,
  CustomEntry,
  CustomMessageEntry,
  SessionEntry,
  SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";

import { isLiveKernelEntry, KERNEL_ENTRY_TYPE, shouldInjectKernel } from "../lib/kernel.ts";

let nextId = 0;
function newId(): string {
  return `id-${++nextId}`;
}

function kernelMessageEntry(parentId: string | null = null): CustomMessageEntry {
  return {
    id: newId(),
    parentId,
    timestamp: new Date().toISOString(),
    type: "custom_message",
    customType: KERNEL_ENTRY_TYPE,
    content: "<sf_operator_kernel>\n…body…\n</sf_operator_kernel>\n",
    display: false,
  };
}

function userMessageEntry(parentId: string | null, text: string): SessionMessageEntry {
  return {
    id: newId(),
    parentId,
    timestamp: new Date().toISOString(),
    type: "message",
    message: {
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    },
  };
}

function compactionEntry(parentId: string, firstKeptEntryId: string): CompactionEntry {
  return {
    id: newId(),
    parentId,
    timestamp: new Date().toISOString(),
    type: "compaction",
    summary: "[summary of earlier turns including the kernel rules]",
    firstKeptEntryId,
    tokensBefore: 50_000,
  };
}

/**
 * Custom entry (state-only marker). Not LLM-visible. Used here as a control:
 * the predicate must NOT treat it as a kernel injection.
 */
function customStateEntry(parentId: string | null, customType: string): CustomEntry {
  return {
    id: newId(),
    parentId,
    timestamp: new Date().toISOString(),
    type: "custom",
    customType,
    data: {},
  };
}

describe("isLiveKernelEntry", () => {
  it("matches a custom_message entry with the kernel customType", () => {
    expect(isLiveKernelEntry(kernelMessageEntry())).toBe(true);
  });

  it("does NOT match a custom (state-only) entry, even with the kernel customType", () => {
    // The historical bug shape: KERNEL_ENTRY_TYPE on a `type: "custom"`
    // marker. Pi never stores the kernel like that; treating it as a match
    // is what caused the re-inject-every-turn regression.
    expect(isLiveKernelEntry(customStateEntry(null, KERNEL_ENTRY_TYPE))).toBe(false);
  });

  it("does NOT match other extensions' custom_message entries", () => {
    const otherExtension: CustomMessageEntry = {
      id: newId(),
      parentId: null,
      timestamp: new Date().toISOString(),
      type: "custom_message",
      customType: "sf-devbar-environment",
      content: "<sf_environment>\n…\n</sf_environment>",
      display: false,
    };
    expect(isLiveKernelEntry(otherExtension)).toBe(false);
  });

  it("rejects null, primitives, and entries missing the type field", () => {
    expect(isLiveKernelEntry(null)).toBe(false);
    expect(isLiveKernelEntry(undefined)).toBe(false);
    expect(isLiveKernelEntry("custom_message")).toBe(false);
    expect(isLiveKernelEntry({ customType: KERNEL_ENTRY_TYPE })).toBe(false);
  });
});

describe("shouldInjectKernel — no compaction", () => {
  it("injects on an empty session", () => {
    expect(shouldInjectKernel([])).toBe(true);
  });

  it("injects when only non-kernel entries are present", () => {
    const u = userMessageEntry(null, "hi");
    expect(shouldInjectKernel([u])).toBe(true);
  });

  it("skips when a kernel custom_message exists (the inject-once contract)", () => {
    const k = kernelMessageEntry();
    const u = userMessageEntry(k.id, "hi");
    expect(shouldInjectKernel([k, u])).toBe(false);
  });

  it("skips even when other custom_message entries from sibling extensions exist", () => {
    const k = kernelMessageEntry();
    const sibling: CustomMessageEntry = {
      id: newId(),
      parentId: k.id,
      timestamp: new Date().toISOString(),
      type: "custom_message",
      customType: "sf-slack-context",
      content: "<slack_workspace>\n…\n</slack_workspace>",
      display: false,
    };
    expect(shouldInjectKernel([k, sibling])).toBe(false);
  });

  it("INJECTS when the only kernel-shaped entry is a state marker (type=custom)", () => {
    // Regression net for the original bug: the broken predicate matched on
    // `type === "custom"` and skipped injection here, leaving the model
    // without a kernel at all. The fixed predicate treats this as "no live
    // kernel" and injects.
    const stateMarker = customStateEntry(null, KERNEL_ENTRY_TYPE);
    const u = userMessageEntry(stateMarker.id, "hi");
    expect(shouldInjectKernel([stateMarker, u])).toBe(true);
  });
});

describe("shouldInjectKernel — post-compaction", () => {
  it("re-injects when the kernel was folded into the compaction summary", () => {
    // Pre-compaction shape: kernel at the head of the session, followed by
    // user/assistant turns large enough to trigger a compaction.
    const k = kernelMessageEntry();
    const u1 = userMessageEntry(k.id, "first turn");
    const u2 = userMessageEntry(u1.id, "second turn");
    // Pi compacts and pins firstKeptEntryId past the kernel — model now sees
    // a summary in place of the verbatim kernel rules.
    const c = compactionEntry(u2.id, u2.id);
    const entries: SessionEntry[] = [k, u1, u2, c];

    expect(shouldInjectKernel(entries)).toBe(true);
  });

  it("skips when a fresh kernel was injected after compaction", () => {
    const k1 = kernelMessageEntry();
    const u1 = userMessageEntry(k1.id, "early turn");
    const c = compactionEntry(u1.id, u1.id);
    // After compaction, sf-brain re-injected the kernel for the post-compaction
    // turn. Subsequent before_agent_start calls should see the live kernel
    // and skip.
    const k2 = kernelMessageEntry(c.id);
    const u2 = userMessageEntry(k2.id, "post-compaction turn");
    const entries: SessionEntry[] = [k1, u1, c, k2, u2];

    expect(shouldInjectKernel(entries)).toBe(false);
  });

  it("re-injects when a later compaction folds a previously re-injected kernel", () => {
    // Multi-compaction case. The kernel got re-injected after the first
    // compaction, but the session kept growing and triggered a second one
    // that swept the re-injected kernel into the summary too.
    const k1 = kernelMessageEntry();
    const c1 = compactionEntry(k1.id, k1.id);
    const k2 = kernelMessageEntry(c1.id); // re-injected post c1
    const u1 = userMessageEntry(k2.id, "after c1");
    const c2 = compactionEntry(u1.id, u1.id); // sweeps k2 into summary
    const entries: SessionEntry[] = [k1, c1, k2, u1, c2];

    expect(shouldInjectKernel(entries)).toBe(true);
  });

  it("uses the LATEST compaction's firstKeptEntryId, not the first one", () => {
    // If the predicate accidentally walked from the first compaction's
    // firstKeptEntryId, it would still see k2 as "live" after c2 swept
    // it away. This pins the latest-wins semantics.
    const k1 = kernelMessageEntry();
    const c1 = compactionEntry(k1.id, k1.id);
    const k2 = kernelMessageEntry(c1.id);
    const u1 = userMessageEntry(k2.id, "between compactions");
    const u2 = userMessageEntry(u1.id, "later");
    const c2 = compactionEntry(u2.id, u2.id);
    const entries: SessionEntry[] = [k1, c1, k2, u1, u2, c2];

    expect(shouldInjectKernel(entries)).toBe(true);
  });
});
