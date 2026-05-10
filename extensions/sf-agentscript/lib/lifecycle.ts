/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Lifecycle ops against an Agentforce org — publish, activate, deactivate, list versions.
 *
 * Endpoints:
 *   POST  https://api.salesforce.com/einstein/ai-agent/v1.1/authoring/scripts            (server compile)
 *   POST  https://api.salesforce.com/einstein/ai-agent/v1.1/authoring/agents              (publish — first version)
 *   POST  https://api.salesforce.com/einstein/ai-agent/v1.1/authoring/agents/{botId}/versions  (publish — new version)
 *   POST  /connect/bot-versions/{botVersionId}/activation                                 (activate / deactivate; instance URL)
 *   SOQL  BotDefinition / BotVersion / GenAiPlannerDefinition                             (resolve, list)
 *
 * Auth: every call goes through `@salesforce/core` `Connection`. SFAP routes
 * use sfapRequest with the api → test.api → dev.api fallback. Instance-URL
 * routes use `Connection.request` directly.
 *
 * Local-first: publish always server-compiles first; if local SDK loads, we
 * pre-validate before burning a server call (matches preview's pattern).
 */

import type { Connection } from "@salesforce/core";
import { isSfapRoutingFailure, sfapRequest } from "./eval/sfap.ts";
import { loadAgentforceSDK } from "./sdk.ts";

// -------------------------------------------------------------------------------------------------
// Endpoints
// -------------------------------------------------------------------------------------------------

const COMPILE_URL = "https://api.salesforce.com/einstein/ai-agent/v1.1/authoring/scripts";
const AGENTS_URL = "https://api.salesforce.com/einstein/ai-agent/v1.1/authoring/agents";

// -------------------------------------------------------------------------------------------------
// Public types
// -------------------------------------------------------------------------------------------------

interface CompileResponseBody {
  status?: string;
  compiledArtifact?: AgentJsonShape;
  errorMessage?: string;
}

interface AgentJsonShape {
  globalConfiguration?: {
    label?: string;
    developerName?: string;
    agentType?: string;
    defaultAgentUser?: string;
  };
  agentVersion?: { developerName?: string };
}

interface PublishResponseBody {
  botId?: string;
  botVersionId?: string;
  errorMessage?: string;
}

export interface PublishResult {
  ok: true;
  bot_id: string;
  bot_version_id: string;
  developer_name: string;
  /** Whether this created the first version of a new agent or a new version of an existing one. */
  was_new_agent: boolean;
  /** When `activate=true` was passed and activation succeeded. */
  activated?: boolean;
  /** Bot version DeveloperName (e.g. v3) — useful for the bundle-meta.xml `target` attribute. */
  version_developer_name?: string;
}

export interface BotVersionRow {
  Id: string;
  VersionNumber: number;
  Status: string;
  DeveloperName?: string;
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

function soqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

async function findBotId(conn: Connection, agentApiName: string): Promise<string | undefined> {
  const r = await conn.query<{ Id: string }>(
    `SELECT Id FROM BotDefinition WHERE DeveloperName='${soqlEscape(agentApiName)}'`,
  );
  return r.records[0]?.Id;
}

async function getVersionDeveloperName(
  conn: Connection,
  botVersionId: string,
): Promise<string | undefined> {
  const r = await conn.query<{ DeveloperName: string }>(
    `SELECT DeveloperName FROM BotVersion WHERE Id='${soqlEscape(botVersionId)}' LIMIT 1`,
  );
  return r.records[0]?.DeveloperName;
}

// -------------------------------------------------------------------------------------------------
// Server compile (also used by compile fallback="server")
// -------------------------------------------------------------------------------------------------

export async function serverCompile(
  conn: Connection,
  agentSource: string,
): Promise<{ ok: true; agentJson: AgentJsonShape } | { ok: false; status: number; body: unknown }> {
  const resp = await sfapRequest<CompileResponseBody>(conn, {
    url: COMPILE_URL,
    method: "POST",
    headers: { "x-client-name": "sf-pi", "content-type": "application/json" },
    body: {
      assets: [{ type: "AFScript", name: "AFScript", content: agentSource }],
      afScriptVersion: "2.0.0",
    },
  });
  if (resp.status < 200 || resp.status >= 300 || resp.body.status !== "success") {
    return { ok: false, status: resp.status, body: resp.body };
  }
  if (!resp.body.compiledArtifact) {
    return { ok: false, status: resp.status, body: { error: "no compiledArtifact" } };
  }
  return { ok: true, agentJson: resp.body.compiledArtifact };
}

// -------------------------------------------------------------------------------------------------
// publish
// -------------------------------------------------------------------------------------------------

export interface PublishOptions {
  conn: Connection;
  agentSource: string;
  /** AAB / agent DeveloperName. Used for the SOQL existence check + return value. */
  agentApiName: string;
  /** When true, immediately activate the new version. Default false. */
  activate?: boolean;
  /** Optional progress callback. */
  log?: (msg: string) => void;
}

/**
 * Server-compile then publish. Creates a new agent if BotDefinition is absent;
 * otherwise creates a new version on the existing agent.
 */
export async function publishAgent(opts: PublishOptions): Promise<PublishResult> {
  const log = opts.log ?? (() => {});

  // Local pre-flight when the SDK is loadable — saves a network call when the
  // source is obviously broken.
  const sdk = await loadAgentforceSDK();
  if (sdk) {
    log("Pre-flighting local compile…");
    const compile = sdk.compileSource(opts.agentSource);
    const sev1 = compile.diagnostics
      .filter((d): d is { severity?: number } => typeof d === "object" && d !== null)
      .filter((d) => (d as { severity?: number }).severity === 1);
    if (sev1.length > 0) {
      throw new Error(
        `Local compile rejected the source (${sev1.length} severity-1 errors). ` +
          `Run agentscript_compile to see them, fix, and retry.`,
      );
    }
  }

  log("Server-compiling…");
  const compileResult = await serverCompile(opts.conn, opts.agentSource);
  if (compileResult.ok === false) {
    if (
      isSfapRoutingFailure({ status: compileResult.status, body: compileResult.body, endpoint: "" })
    ) {
      throw new Error(
        "Server compile is unavailable in this org — the Einstein AI Agent SFAP routes returned 404 across api / test.api / dev.api hosts. " +
          "This typically means the org isn't Agentforce-enabled (e.g. a basic dev edition). Use a sandbox or production org with Agentforce enabled.",
      );
    }
    throw new Error(
      `Server compile failed (HTTP ${compileResult.status}): ${JSON.stringify(compileResult.body).slice(0, 600)}`,
    );
  }
  const agentJson = compileResult.agentJson;

  log("Looking up existing BotDefinition…");
  const existingBotId = await findBotId(opts.conn, opts.agentApiName);
  const url = existingBotId ? `${AGENTS_URL}/${existingBotId}/versions` : AGENTS_URL;
  log(
    existingBotId
      ? `Publishing new version of ${opts.agentApiName}…`
      : `Publishing new agent ${opts.agentApiName}…`,
  );

  const publishResp = await sfapRequest<PublishResponseBody>(opts.conn, {
    url,
    method: "POST",
    headers: { "x-client-name": "sf-pi", "content-type": "application/json" },
    body: {
      agentDefinition: agentJson,
      instanceConfig: { endpoint: opts.conn.instanceUrl },
    },
  });
  if (publishResp.status < 200 || publishResp.status >= 300) {
    if (isSfapRoutingFailure(publishResp)) {
      throw new Error(
        "Publish is unavailable in this org — the SFAP authoring endpoint returned 404 across api / test.api / dev.api hosts. " +
          "Use an Agentforce-enabled org.",
      );
    }
    throw new Error(
      `Publish failed (HTTP ${publishResp.status}): ${JSON.stringify(publishResp.body).slice(0, 600)}`,
    );
  }
  const { botId, botVersionId, errorMessage } = publishResp.body;
  if (!botId || !botVersionId) {
    throw new Error(`Publish returned no botId/botVersionId: ${errorMessage ?? "unknown"}`);
  }

  const versionDeveloperName = await getVersionDeveloperName(opts.conn, botVersionId);

  let activated = false;
  if (opts.activate) {
    log(`Activating ${botVersionId}…`);
    await setVersionStatus(opts.conn, botVersionId, "Active");
    activated = true;
  }

  return {
    ok: true,
    bot_id: botId,
    bot_version_id: botVersionId,
    developer_name: opts.agentApiName,
    was_new_agent: !existingBotId,
    activated,
    version_developer_name: versionDeveloperName,
  };
}

// -------------------------------------------------------------------------------------------------
// activate / deactivate
// -------------------------------------------------------------------------------------------------

interface BotActivationResponseBody {
  success: boolean;
  isActivated?: boolean;
  messages?: string[] | string;
}

export interface ActivateOptions {
  conn: Connection;
  agentApiName: string;
  /** Specific version number; default: latest. */
  version?: number;
}

export async function activateVersion(opts: ActivateOptions): Promise<BotVersionRow> {
  return setActivationByApiName(opts, "Active");
}

export async function deactivateVersion(opts: ActivateOptions): Promise<BotVersionRow> {
  return setActivationByApiName(opts, "Inactive");
}

async function setActivationByApiName(
  opts: ActivateOptions,
  desired: "Active" | "Inactive",
): Promise<BotVersionRow> {
  const botId = await findBotId(opts.conn, opts.agentApiName);
  if (!botId) {
    throw new Error(
      `Agent '${opts.agentApiName}' not found. Verify the DeveloperName via ` +
        `\`SELECT Id, DeveloperName FROM BotDefinition\`.`,
    );
  }

  // Resolve the target BotVersion row.
  const versionFilter = opts.version ? `AND VersionNumber=${opts.version}` : "";
  const versions = await opts.conn.query<BotVersionRow>(
    `SELECT Id, VersionNumber, Status FROM BotVersion ` +
      `WHERE BotDefinitionId='${soqlEscape(botId)}' ${versionFilter} ` +
      `ORDER BY VersionNumber DESC LIMIT 1`,
  );
  if (versions.records.length === 0) {
    throw new Error(
      opts.version
        ? `No BotVersion ${opts.version} for agent '${opts.agentApiName}'.`
        : `No BotVersion records for agent '${opts.agentApiName}'.`,
    );
  }
  const row = versions.records[0];
  if (row.Status === desired) {
    return row; // already in desired state — idempotent
  }
  await setVersionStatus(opts.conn, row.Id, desired);
  return { ...row, Status: desired };
}

async function setVersionStatus(
  conn: Connection,
  botVersionId: string,
  desired: "Active" | "Inactive",
): Promise<void> {
  const url = `/connect/bot-versions/${botVersionId}/activation`;
  const resp = (await conn.request({
    method: "POST",
    url,
    body: JSON.stringify({ status: desired }),
    headers: { "Content-Type": "application/json" },
  } as Parameters<typeof conn.request>[0])) as BotActivationResponseBody;
  if (!resp.success) {
    const msg = Array.isArray(resp.messages)
      ? resp.messages.join("; ")
      : (resp.messages ?? "unknown");
    throw new Error(`Activation request did not succeed: ${msg}`);
  }
}

// -------------------------------------------------------------------------------------------------
// list_versions
// -------------------------------------------------------------------------------------------------

export interface ListVersionsResult {
  ok: true;
  agent_api_name: string;
  bot_id: string;
  versions: Array<{
    bot_version_id: string;
    version_number: number;
    developer_name?: string;
    status: string;
    created_date?: string;
    last_modified_date?: string;
  }>;
}

export async function listVersions(
  conn: Connection,
  agentApiName: string,
): Promise<ListVersionsResult> {
  const botId = await findBotId(conn, agentApiName);
  if (!botId) {
    throw new Error(`Agent '${agentApiName}' not found. Verify the DeveloperName.`);
  }
  const r = await conn.query<{
    Id: string;
    VersionNumber: number;
    DeveloperName: string;
    Status: string;
    CreatedDate: string;
    LastModifiedDate: string;
  }>(
    `SELECT Id, VersionNumber, DeveloperName, Status, CreatedDate, LastModifiedDate ` +
      `FROM BotVersion WHERE BotDefinitionId='${soqlEscape(botId)}' ORDER BY VersionNumber DESC`,
  );
  return {
    ok: true,
    agent_api_name: agentApiName,
    bot_id: botId,
    versions: r.records.map((row) => ({
      bot_version_id: row.Id,
      version_number: row.VersionNumber,
      developer_name: row.DeveloperName,
      status: row.Status,
      created_date: row.CreatedDate,
      last_modified_date: row.LastModifiedDate,
    })),
  };
}
