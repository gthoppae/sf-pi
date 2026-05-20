/* SPDX-License-Identifier: Apache-2.0 */
/** Tiny timing helpers for SF Browser user-visible duration reporting. */

export interface DurationResult {
  durationMs: number;
  durationText: string;
}

export function startTimer(): () => DurationResult {
  const start = performance.now();
  return () => durationFrom(start);
}

export function durationFrom(start: number): DurationResult {
  const durationMs = Math.max(0, Math.round(performance.now() - start));
  return { durationMs, durationText: formatDuration(durationMs) };
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}
