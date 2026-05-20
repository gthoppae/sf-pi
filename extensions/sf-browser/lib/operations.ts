/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared command/tool operations for SF Browser.
 */
import { existsSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { runAgentBrowser } from "./agent-browser.ts";
import {
  commitEvidenceCapture,
  type EvidenceImageMode,
  evidenceModeFromUnknown,
  imageContentFromFile,
  planEvidenceCapture,
} from "./artifacts.ts";
import { OPEN_NEXT_STEPS } from "./guidance.ts";
import { dismissAmbientOverlays } from "./overlay-dismissal.ts";
import { redactUrl } from "./redaction.ts";
import { resolveOpenOrgUrl, summarizeOpenTarget, type OpenOrgInput } from "./salesforce-open.ts";
import { startTimer } from "./timing.ts";
import { okText } from "./tool-support.ts";

export async function openOrgInAgentBrowser(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  input: OpenOrgInput,
  signal?: AbortSignal,
): Promise<{ text: string; details: Record<string, unknown> }> {
  const stopTimer = startTimer();
  const open = await resolveOpenOrgUrl(pi, ctx, input, signal);
  await runAgentBrowser(pi, ["open", open.url], { cwd: ctx.cwd, signal });
  const duration = stopTimer();
  return {
    text: okText([
      summarizeOpenTarget(open.targetOrg, open.path),
      input.purpose ? `Purpose: ${input.purpose}` : undefined,
      `Duration: ${duration.durationText}`,
      "",
      OPEN_NEXT_STEPS,
    ]),
    details: {
      ok: true,
      targetOrg: open.targetOrg,
      path: open.path,
      setup: input.setup,
      purpose: input.purpose,
      session: "sf-pi",
      ...duration,
    },
  };
}

export async function captureEvidence(
  pi: ExtensionAPI,
  cwd: string,
  input: { label?: string; imageMode?: EvidenceImageMode | string; dismissOverlays?: boolean },
  signal?: AbortSignal,
): Promise<{ content: Array<TextContent | ImageContent>; details: Record<string, unknown> }> {
  const stopTimer = startTimer();
  const mode = evidenceModeFromUnknown(input.imageMode);
  const planned = planEvidenceCapture(input.label);
  const overlayDismissal =
    input.dismissOverlays === false
      ? { dismissedRefs: [], snapshotChecked: false }
      : await dismissAmbientOverlays(pi, cwd, signal);

  await runAgentBrowser(pi, ["screenshot", planned.path], { cwd, signal });

  let image: ImageContent | null = null;
  let thumbnailPath: string | undefined;
  if (mode === "thumbnail") {
    await runAgentBrowser(pi, ["screenshot", planned.thumbnailPath], {
      cwd,
      signal,
      extraGlobalArgs: ["--screenshot-format", "jpeg", "--screenshot-quality", "55"],
    });
    thumbnailPath = existsSync(planned.thumbnailPath) ? planned.thumbnailPath : undefined;
    if (thumbnailPath) image = imageContentFromFile(thumbnailPath, "image/jpeg");
  } else if (mode === "full") {
    image = imageContentFromFile(planned.path, "image/png");
  }

  const currentUrl = await getCurrentUrl(pi, cwd, signal);
  const duration = stopTimer();
  const capture = commitEvidenceCapture({
    id: planned.id,
    label: planned.label,
    path: planned.path,
    thumbnailPath,
    createdAt: new Date().toISOString(),
    imageMode: mode,
    includedImage: image !== null,
    url: currentUrl,
  });

  const text = okText([
    `Captured Browser Evidence #${capture.id}.`,
    `Label: ${capture.label}`,
    `Mode: ${capture.imageMode}`,
    `Image included: ${capture.includedImage ? "yes" : "no"}`,
    `Duration: ${duration.durationText}`,
    `Path: ${capture.path}`,
    capture.thumbnailPath ? `Thumbnail: ${capture.thumbnailPath}` : undefined,
    capture.url ? `URL: ${capture.url}` : undefined,
    overlayDismissal.dismissedRefs.length
      ? `Dismissed ambient overlays: ${overlayDismissal.dismissedRefs.join(", ")}`
      : undefined,
    mode === "artifact"
      ? "Artifact mode is best for repeated or batch captures."
      : "Use artifact mode for repeated captures; thumbnail mode is for current-screen model inspection.",
  ]);
  const content: Array<TextContent | ImageContent> = [{ type: "text", text }];
  if (image) content.push(image);
  return { content, details: { ok: true, capture, overlayDismissal, ...duration } };
}

async function getCurrentUrl(
  pi: ExtensionAPI,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  try {
    const result = await runAgentBrowser(pi, ["get", "url"], { cwd, signal, timeoutMs: 15_000 });
    return redactUrl(result.stdout.trim());
  } catch {
    return undefined;
  }
}
