/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  withFileMutationQueue,
  type TruncationResult,
} from "@mariozechner/pi-coding-agent";

export interface D360TruncatedOutput {
  text: string;
  truncation?: TruncationResult;
  fullOutputPath?: string;
}

export const D360_OUTPUT_SUFFIX =
  ` Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} ` +
  `(whichever is hit first). If truncated, the full output is saved to a temp file.`;

export async function truncateD360Output(text: string): Promise<D360TruncatedOutput> {
  const truncation = truncateHead(text);
  if (!truncation.truncated) return { text: truncation.content };

  const tempDir = await mkdtemp(join(tmpdir(), "pi-d360-"));
  const fullOutputPath = join(tempDir, "output.json");

  await withFileMutationQueue(fullOutputPath, async () => {
    await writeFile(fullOutputPath, text, "utf8");
  });

  return {
    text: `${truncation.content}\n\n${buildTruncationNote(truncation, fullOutputPath)}`,
    truncation,
    fullOutputPath,
  };
}

function buildTruncationNote(truncation: TruncationResult, fullOutputPath: string): string {
  return (
    `[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines ` +
    `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ` +
    `Full output saved to: ${fullOutputPath}]`
  );
}
