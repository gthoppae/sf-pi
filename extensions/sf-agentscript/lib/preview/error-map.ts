/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Map cryptic SFAP `/einstein/ai-agent/*` server errors to actionable
 * messages with chain-able recovery hints.
 *
 * The Einstein Agent server returns short messages routed through an
 * internal v6.0.0 service. Most LLMs (and humans) can't act on them. This
 * module recognizes the known patterns and rewrites them into "do this next"
 * diagnostics.
 *
 * Pure function — no I/O, no Connection. Wire into the catch-paths of
 * `startPreview`, `startPreviewByApiName`, `sendMessage`, `endPreview`.
 */

export interface PreviewErrorContext {
  /** Which call surfaced the error: "start" | "send" | "end" | "trace". */
  phase: "start" | "send" | "end" | "trace";
  /**
   * "agent_file" (v1.1 authoring preview) or "api_name" (production-agent v1).
   * Different surfaces emit different error wording.
   */
  surface: "agent_file" | "api_name";
  /** The .agent file's bundle name when surface=agent_file. */
  agentName?: string;
  /** The published agent's DeveloperName when surface=api_name. */
  agentApiName?: string;
}

export interface MappedPreviewError {
  /** Rewritten user-facing message. */
  message: string;
  /** When non-null, the LLM should try this tool call as a recovery step. */
  recover_via?: { tool: string; params: Record<string, unknown> };
  /** The matched pattern key, for diagnostics + tests. */
  matched: string | null;
}

/**
 * Map an HTTP error from an SFAP preview call to a clean diagnostic.
 * When no pattern matches, returns the original message verbatim with
 * `matched: null` — the caller surfaces it unchanged.
 */
export function mapPreviewError(
  status: number,
  body: unknown,
  context: PreviewErrorContext,
): MappedPreviewError {
  const text = errorBlob(body);

  // -- 1. version-mismatch on start (v1.1 preview) -----------------------------
  if (
    /retrieve bot version ID to insert into cache/i.test(text) ||
    /bot version.*not found/i.test(text)
  ) {
    return {
      message:
        `agentVersion.developerName doesn't match a known BotVersion in the ` +
        `org. Most often: the bundle's <target>X.vN</target> in bundle-meta.xml ` +
        `points at a BotVersion that hasn't been published yet. Try one of: ` +
        `(a) remove the <target> tag (defaults to "v0", a fresh-preview sentinel), ` +
        `(b) set it to an existing version like "v1", or ` +
        `(c) publish first: agentscript_lifecycle action='publish'.`,
      matched: "version-cache-miss",
    };
  }

  // -- 2. send/end against a session the server doesn't know about ------------
  if (/V6Session not found|Session not found for sessionId/i.test(text)) {
    return {
      message:
        `The server doesn't know about this session. Common causes: ` +
        `(a) target_org on send/end differs from the one start used (now caught ` +
        `pre-flight, but legacy sessions on disk may still hit this), ` +
        `(b) the session expired (idle TTL), or ` +
        `(c) the agent was deactivated mid-session. Re-run agentscript_preview ` +
        `action='start' to open a fresh session.`,
      recover_via: {
        tool: "agentscript_preview",
        params: { action: "start" },
      },
      matched: "session-not-found",
    };
  }

  // -- 3. start session with empty bot user (Service Agent without BotUser) ---
  if (/Invalid user ID provided on start session/i.test(text)) {
    return {
      message:
        `The agent's running-user couldn't be resolved. ` +
        (context.surface === "api_name"
          ? `For Service Agents, assign a BotUser via 'sf org create agent-user' ` +
            `then re-publish. For Employee Agents this should never happen ` +
            `\u2014 the agent_type may be miscategorized.`
          : `For local previews, set agent_type to 'AgentforceEmployeeAgent' ` +
            `(no BotUser needed) or assign a real default_agent_user before ` +
            `starting the preview.`),
      matched: "invalid-user-id",
    };
  }

  // -- 4. published agent inactive (412 PRECONDITION_FAILED) ------------------
  if (/No access to Einstein Copilot/i.test(text) || status === 412) {
    const apiName = context.agentApiName ?? "<agent>";
    return {
      message:
        `The agent has no active BotVersion (or you lack Einstein Copilot ` +
        `access). Activate first: agentscript_lifecycle action='activate' ` +
        `agent_api_name='${apiName}'.`,
      recover_via: {
        tool: "agentscript_lifecycle",
        params: { action: "activate", agent_api_name: apiName },
      },
      matched: "inactive-agent",
    };
  }

  // -- 5. SFAP route unavailable in this org ----------------------------------
  if (status === 404 && /ERROR_HTTP_404|URL No Longer Exists|api\.salesforce\.com/i.test(text)) {
    return {
      message:
        `The Einstein AI Agent SFAP routes returned 404 across api / test.api / ` +
        `dev.api hosts. The org isn't Agentforce-enabled (e.g. a basic dev ` +
        `edition) or the user lacks permission. Use a sandbox or production ` +
        `org with Agentforce enabled, or assign the right permission set.`,
      matched: "sfap-404",
    };
  }

  // -- 6. JWT bootstrap failed ------------------------------------------------
  if (/agentforce\/bootstrap\/nameduser/i.test(text) || /sfap_api/i.test(text)) {
    return {
      message:
        `Failed to mint the named-user JWT required by /einstein/ai-agent/*. ` +
        `If using a custom Connected App, add scopes: chatbot_api, sfap_api, ` +
        `web. Otherwise re-auth: sf org login web -a <alias>.`,
      matched: "bootstrap-failed",
    };
  }

  // -- default: pass through verbatim -----------------------------------------
  const phase = context.phase;
  return {
    message: `Preview ${phase} failed (HTTP ${status}): ${text.slice(0, 600)}`,
    matched: null,
  };
}

function errorBlob(body: unknown): string {
  if (body == null) return "";
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}
