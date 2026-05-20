/* SPDX-License-Identifier: Apache-2.0 */
/** Browser Evidence capture tool for SF Browser. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { captureEvidence } from "./operations.ts";

export const SF_BROWSER_CAPTURE_EVIDENCE_TOOL_NAME = "sf_browser_capture_evidence";

const EvidenceMode = StringEnum(["artifact", "thumbnail", "full"] as const, {
  description:
    "artifact stores only a file reference, thumbnail returns a bounded image result, full returns the full screenshot when small enough. Defaults to thumbnail.",
});

export function registerSfBrowserCaptureEvidenceTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: SF_BROWSER_CAPTURE_EVIDENCE_TOOL_NAME,
    label: "SF Browser Capture Evidence",
    description:
      "Capture Browser Evidence from agent-browser. Stores a full private screenshot artifact, optionally dismisses known ambient Salesforce overlays, and optionally returns a bounded image for model vision. Use artifact mode for batches.",
    promptSnippet:
      "Capture private Salesforce browser screenshots with optional bounded model-visible images",
    promptGuidelines: [
      "Use sf_browser_capture_evidence with imageMode=thumbnail when the model should inspect the current screen; use imageMode=artifact for repeated or batch captures.",
    ],
    parameters: Type.Object({
      label: Type.Optional(
        Type.String({ description: "Short public-safe label for the evidence file." }),
      ),
      imageMode: Type.Optional(EvidenceMode),
      dismissOverlays: Type.Optional(
        Type.Boolean({
          description:
            "Best-effort dismissal of known non-workflow Salesforce overlays before capture. Defaults to true.",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return captureEvidence(pi, ctx.cwd, params, signal);
    },
  });
}
