/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Anthropic Messages transport for the SF LLM Gateway.
 *
 * Wraps pi-ai's `streamSimpleAnthropic` with the Gateway-specific Opus 4.7
 * policy:
 *   - Pre-set `options.maxTokens` to the level-scaled floor so pi-ai's
 *     buildBaseOptions does not clamp to 32K before we ever see the payload.
 *   - Force adaptive thinking + per-level effort via `onPayload`.
 *   - Strip incompatible `temperature` values.
 *
 * Older Claude models pass straight through — pi-ai already handles 4.6
 * adaptive thinking and budget-based thinking for earlier ones.
 *
 * The Anthropic-specific transient-error retry wrapper
 * (`streamAnthropicWithRobustRetry`) lives in `./shared.ts` so the OpenAI
 * transports can avoid pulling its dependencies.
 */
import {
  streamSimpleAnthropic,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { applyOpus47MaxThinking } from "./payloads.ts";
import {
  isOpus47ModelId,
  OPUS_47_MODEL_MAX_TOKENS,
  resolveOpus47MaxTokensFloor,
  streamAnthropicWithRobustRetry,
  type PiReasoningLevel,
} from "./shared.ts";

export function streamSfGatewayAnthropic(
  model: Model<"anthropic-messages">,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  if (!isOpus47ModelId(model.id)) {
    return streamAnthropicWithRobustRetry(
      model,
      () => streamSimpleAnthropic(model, context, options),
      options?.signal,
    );
  }

  const existingOnPayload = options?.onPayload;
  const piLevel = options?.reasoning as PiReasoningLevel | undefined;

  const wrappedOptions: SimpleStreamOptions = {
    ...options,
    // Raise the buildBaseOptions ceiling before pi-ai clamps to 32K. Use a
    // floor scaled by the pi reasoning level so low-effort turns do not get
    // silently inflated into the Opus 4.7 64K-output profile that correlates
    // with Anthropic's intermittent `api_error: Internal server error`
    // window. Keep the caller's explicit value when it is already above the
    // level-scaled floor. Never exceed the model's hard 128K output ceiling.
    maxTokens: Math.min(
      Math.max(options?.maxTokens ?? 0, resolveOpus47MaxTokensFloor(piLevel)),
      OPUS_47_MODEL_MAX_TOKENS,
    ),
    onPayload: async (payload, payloadModel) => {
      let nextPayload = payload;

      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        const objectPayload = payload as Record<string, unknown>;
        applyOpus47MaxThinking(objectPayload, piLevel);
        nextPayload = objectPayload;
      }

      return existingOnPayload ? existingOnPayload(nextPayload, payloadModel) : nextPayload;
    },
  };

  return streamAnthropicWithRobustRetry(
    model,
    () => streamSimpleAnthropic(model, context, wrappedOptions),
    options?.signal,
  );
}
