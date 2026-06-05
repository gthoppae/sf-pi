/* SPDX-License-Identifier: Apache-2.0 */
/**
 * mcp.ts — tiny one-shot MCP stdio client for Salesforce mcp-adaptor.
 *
 * This is intentionally not a general MCP host/client integration. It is a
 * narrow transport layer used by native Pi tools:
 *   Pi tool -> spawn mcp-adaptor serve --server google_workspace -> tools/call
 */

import { spawn, execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { sanitizeForLog } from "./security.ts";

const execFileAsync = promisify(execFile);

export const DEFAULT_MCP_SERVER = "google_workspace";
export const DEFAULT_MCP_TIMEOUT_MS = 60_000;
export const DEFAULT_MCP_PROTOCOL_VERSION = "2024-11-05";

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpTransportConfig {
  adaptorPath: string;
  server: string;
  timeoutMs: number;
}

export class McpAdaptorError extends Error {
  readonly details?: unknown;
  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "McpAdaptorError";
    this.details = details;
  }
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

export function resolveMcpTransportConfig(
  env: Record<string, string | undefined> = process.env,
): McpTransportConfig {
  return {
    adaptorPath:
      env.GWS_MCP_ADAPTOR ||
      env.MCP_ADAPTOR_PATH ||
      join(homedir(), ".mcp-adaptor", "bin", "mcp-adaptor"),
    server: env.GWS_MCP_SERVER || DEFAULT_MCP_SERVER,
    timeoutMs: parsePositiveInt(env.GWS_MCP_TIMEOUT_MS, DEFAULT_MCP_TIMEOUT_MS),
  };
}

export async function assertMcpAdaptorAvailable(path: string): Promise<void> {
  try {
    await access(path);
  } catch {
    throw new McpAdaptorError(`mcp-adaptor not found at ${path}`);
  }
}

export async function validateMcpAuth(
  config: McpTransportConfig = resolveMcpTransportConfig(),
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  await assertMcpAdaptorAvailable(config.adaptorPath);
  try {
    const { stdout, stderr } = await execFileAsync(config.adaptorPath, ["auth", "--validate"], {
      timeout: Math.min(config.timeoutMs, 30_000),
    });
    return { ok: true, stdout: sanitizeText(stdout), stderr: sanitizeText(stderr) };
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: sanitizeText(error.stdout || ""),
      stderr: sanitizeText(error.stderr || error.message || ""),
    };
  }
}

export async function listMcpTools(
  config: McpTransportConfig = resolveMcpTransportConfig(),
): Promise<McpToolInfo[]> {
  const response = await mcpRequest(
    2,
    [
      initializeMessage(1),
      initializedNotification(),
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    ],
    config,
  );

  const tools = (response as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return [];
  return tools
    .filter((tool): tool is Record<string, unknown> => typeof tool === "object" && tool !== null)
    .map((tool) => ({
      name: typeof tool.name === "string" ? tool.name : "",
      description: typeof tool.description === "string" ? tool.description : undefined,
      inputSchema: tool.inputSchema,
    }))
    .filter((tool) => tool.name);
}

export async function callMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  config: McpTransportConfig = resolveMcpTransportConfig(),
): Promise<unknown> {
  const response = await mcpRequest(
    2,
    [
      initializeMessage(1),
      initializedNotification(),
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      },
    ],
    config,
  );
  return response;
}

export function searchTools(
  tools: readonly McpToolInfo[],
  query: string,
  limit = 20,
): McpToolInfo[] {
  const tokens = normalizeSearchTokens(query);
  const filtered = tokens.length
    ? tools
        .map((tool) => ({ tool, score: scoreToolMatch(tool, tokens) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
        .map((entry) => entry.tool)
    : [...tools];
  return filtered.slice(0, Math.max(1, Math.min(50, limit)));
}

function scoreToolMatch(tool: McpToolInfo, tokens: readonly string[]): number {
  const name = normalizeSearchText(tool.name);
  const description = normalizeSearchText(tool.description || "");
  const combined = `${name} ${description}`;
  if (!tokens.every((token) => combined.includes(token))) return 0;

  let score = 1;
  for (const token of tokens) {
    if (name.includes(token)) score += 20;
    if (description.includes(token)) score += 2;
  }
  if (tokens.every((token) => name.includes(token))) score += 50;
  return score;
}

function normalizeSearchText(value: string): string {
  return ` ${value.toLowerCase().replace(/[_\W]+/g, " ")} `;
}

function normalizeSearchTokens(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/[_\W]+/)
    .filter(Boolean)
    .map((token) => (token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token))
    .filter((token, index, all) => all.indexOf(token) === index);
}

const WRITE_NAME_PATTERN =
  /(^|_)(create|update|delete|remove|send|draft|modify|batch_modify|insert|append|replace|import|upload|copy|move|share|permission|set|grant|revoke|resolve_comment|reply_comment)(_|$)/i;

const READ_NAME_PATTERN = /(^|_)(get|list|search|read|fetch|export|download|query|inspect)(_|$)/i;

export function isLikelyWriteTool(toolName: string): boolean {
  if (WRITE_NAME_PATTERN.test(toolName)) return true;
  if (READ_NAME_PATTERN.test(toolName)) return false;
  return false;
}

export function assertMcpToolAllowed(toolName: string, opts: { allowWrite?: boolean } = {}): void {
  if (isLikelyWriteTool(toolName) && !opts.allowWrite) {
    throw new McpAdaptorError(
      `Refusing write-like Google Workspace MCP tool "${toolName}". Set GWS_ALLOW_MCP_WRITE=true to enable write tools after review.`,
    );
  }
}

export function formatMcpToolList(tools: readonly McpToolInfo[]): string {
  if (tools.length === 0) return "No Google Workspace MCP tools matched.";
  return tools
    .map((tool, index) => {
      const description = tool.description
        ? ` — ${tool.description.replace(/\s+/g, " ").trim()}`
        : "";
      return `${index + 1}. ${tool.name}${description}`;
    })
    .join("\n");
}

export function sanitizeMcpResult(result: unknown): unknown {
  return sanitizeForLog(result);
}

export function stringifyBounded(value: unknown, maxChars = 12_000): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[Output truncated to ${maxChars} chars]`;
}

async function mcpRequest(
  targetId: number,
  messages: readonly unknown[],
  config: McpTransportConfig,
): Promise<unknown> {
  await assertMcpAdaptorAvailable(config.adaptorPath);

  return new Promise<unknown>((resolve, reject) => {
    let settled = false;
    let stdoutBuffer = "";
    let stderr = "";
    const child = spawn(config.adaptorPath, ["serve", "--server", config.server], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    const timer = setTimeout(() => {
      finish(new McpAdaptorError(`mcp-adaptor timed out after ${config.timeoutMs}ms`, { stderr }));
    }, config.timeoutMs);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        handleLine(line);
        newlineIndex = stdoutBuffer.indexOf("\n");
      }
    });

    child.on("error", (err) => finish(err));
    child.on("exit", (code) => {
      if (!settled) {
        finish(
          new McpAdaptorError(`mcp-adaptor exited before response (code=${code})`, { stderr }),
        );
      }
    });

    for (const message of messages) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    function handleLine(line: string): void {
      if (!line || !line.startsWith("{")) return;
      let parsed: JsonRpcResponse;
      try {
        parsed = JSON.parse(line) as JsonRpcResponse;
      } catch {
        return;
      }
      if (parsed.id !== targetId) return;
      if (parsed.error) {
        finish(new McpAdaptorError(parsed.error.message || "MCP tool call failed", parsed.error));
        return;
      }
      finish(undefined, parsed.result);
    }

    function finish(err?: unknown, result?: unknown): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.destroy();
      child.kill("SIGTERM");
      if (err) {
        reject(err instanceof Error ? err : new McpAdaptorError(String(err)));
      } else {
        resolve(result);
      }
    }
  });
}

function initializeMessage(id: number) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: DEFAULT_MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "sf-google-workspace-pi", version: "0.1.0" },
    },
  };
}

function initializedNotification() {
  return { jsonrpc: "2.0", method: "notifications/initialized", params: {} };
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizeText(text: string): string {
  return stringifyBounded(sanitizeForLog(text), 4_000);
}
