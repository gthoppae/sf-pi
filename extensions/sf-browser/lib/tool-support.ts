/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared helpers for SF Browser tool results.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { getEvidenceDir, updateLatestEvidencePointer } from "./artifacts.ts";
import { redactText, sanitizeLabel } from "./redaction.ts";

export interface FormattedOutput {
  text: string;
  fullOutputPath?: string;
  truncated: boolean;
}

export function formatPossiblyLargeOutput(
  output: string,
  options: {
    label: string;
    extension: string;
    maxBytes?: number;
    maxLines?: number;
    sessionId?: string;
  },
): FormattedOutput {
  const redacted = redactText(output);
  const truncation = truncateHead(redacted, {
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    maxLines: options.maxLines ?? DEFAULT_MAX_LINES,
  });
  if (!truncation.truncated) {
    return { text: truncation.content, truncated: false };
  }

  const dir = getEvidenceDir(options.sessionId);
  updateLatestEvidencePointer(options.sessionId);
  mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    `${Date.now()}-${sanitizeLabel(options.label, "output")}.${options.extension}`,
  );
  try {
    writeFileSync(file, redacted, "utf8");
  } catch {
    return {
      text: `${truncation.content}\n\n[Output truncated; failed to save full output.]`,
      truncated: true,
    };
  }
  return {
    text: `${truncation.content}\n\n[Output truncated. Full output saved to: ${file}]`,
    fullOutputPath: file,
    truncated: true,
  };
}

export function writeBrowserArtifact(
  content: string,
  options: { label: string; extension: string; sessionId?: string },
): string {
  const dir = getEvidenceDir(options.sessionId);
  updateLatestEvidencePointer(options.sessionId);
  mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    `${Date.now()}-${sanitizeLabel(options.label, "artifact")}.${options.extension}`,
  );
  writeFileSync(file, content, "utf8");
  return file;
}

export function okText(lines: Array<string | undefined | false>): string {
  return lines.filter(Boolean).join("\n");
}
