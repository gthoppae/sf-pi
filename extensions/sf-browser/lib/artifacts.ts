/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Browser Evidence artifact storage.
 *
 * Full-resolution screenshots live on disk and only bounded image content is
 * returned to the model when requested. The index is intentionally small so
 * hundreds of captures can be referenced by ID without replaying image bytes
 * through the conversation.
 */
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import { createStateStore } from "../../../lib/common/state-store.ts";
import { sanitizeLabel } from "./redaction.ts";

export type EvidenceImageMode = "artifact" | "thumbnail" | "full";

export interface BrowserEvidenceCapture {
  id: number;
  label: string;
  path: string;
  thumbnailPath?: string;
  createdAt: string;
  imageMode: EvidenceImageMode;
  includedImage: boolean;
  url?: string;
}

interface BrowserEvidenceIndexState {
  nextId: number;
  captures: BrowserEvidenceCapture[];
}

export interface PlannedEvidenceCapture {
  id: number;
  label: string;
  path: string;
  thumbnailPath: string;
  dir: string;
}

const EVIDENCE_SCHEMA_VERSION = 1;
const MAX_INDEX_CAPTURES = 500;
const MAX_EMBED_BYTES = 1_500_000;

const evidenceStore = createStateStore<BrowserEvidenceIndexState>({
  namespace: "browser-artifacts/latest",
  filename: "index.json",
  schemaVersion: EVIDENCE_SCHEMA_VERSION,
  defaults: { nextId: 1, captures: [] },
});

export function getEvidenceDir(): string {
  return path.dirname(evidenceStore.path);
}

export function getEvidenceIndexPath(): string {
  return evidenceStore.path;
}

export function planEvidenceCapture(label: string | undefined): PlannedEvidenceCapture {
  const state = evidenceStore.read();
  const id = Math.max(1, state.nextId || 1);
  const safeLabel = sanitizeLabel(label, "evidence");
  const prefix = `${String(id).padStart(6, "0")}-${safeLabel}`;
  const dir = getEvidenceDir();
  mkdirSync(dir, { recursive: true });
  return {
    id,
    label: safeLabel,
    path: path.join(dir, `${prefix}.png`),
    thumbnailPath: path.join(dir, `${prefix}.thumb.jpg`),
    dir,
  };
}

export function commitEvidenceCapture(capture: BrowserEvidenceCapture): BrowserEvidenceCapture {
  evidenceStore.update((current) => {
    const withoutDuplicate = current.captures.filter((item) => item.id !== capture.id);
    const captures = [...withoutDuplicate, capture].slice(-MAX_INDEX_CAPTURES);
    return { nextId: Math.max(current.nextId || 1, capture.id + 1), captures };
  });
  return capture;
}

export function latestEvidenceCaptures(limit = 5): BrowserEvidenceCapture[] {
  return evidenceStore.read().captures.slice(-limit).reverse();
}

export function imageContentFromFile(filePath: string, mimeType: string): ImageContent | null {
  if (!existsSync(filePath)) return null;
  try {
    const size = statSync(filePath).size;
    if (size > MAX_EMBED_BYTES) return null;
    return {
      type: "image",
      data: readFileSync(filePath).toString("base64"),
      mimeType,
    };
  } catch {
    return null;
  }
}

export function evidenceModeFromUnknown(value: unknown): EvidenceImageMode {
  return value === "artifact" || value === "full" || value === "thumbnail" ? value : "thumbnail";
}
