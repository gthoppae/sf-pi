/* SPDX-License-Identifier: Apache-2.0 */
/** Native Google Drive convenience wrappers built on top of mcp-adaptor. */

import { callMcpTool, sanitizeMcpResult } from "./mcp.ts";

export const DEFAULT_DRIVE_SEARCH_TOOL = "search_drive_files";

export interface GoogleDriveSearchParams {
  query: string;
  limit?: number;
  page_token?: string | null;
  drive_id?: string | null;
  include_items_from_all_drives?: boolean;
  corpora?: string | null;
  file_type?: string | null;
  detailed?: boolean;
}

export interface GoogleDriveSearchFile {
  name: string;
  id: string;
  mimeType: string;
  typeLabel: string;
  size: string | null;
  sizeBytes: number | null;
  sizeLabel: string | null;
  modifiedTime: string | null;
  link: string | null;
}

export interface GoogleDriveSearchResult {
  query: string;
  files: GoogleDriveSearchFile[];
  nextPageToken?: string;
  rawText: string;
}

export async function searchGoogleDrive(
  params: GoogleDriveSearchParams,
  opts: { toolName?: string } = {},
): Promise<GoogleDriveSearchResult> {
  if (!params.query?.trim()) {
    throw new Error("google_drive_search requires a non-empty query");
  }

  const toolName = opts.toolName || process.env.GWS_DRIVE_SEARCH_TOOL || DEFAULT_DRIVE_SEARCH_TOOL;
  const mcpArgs = buildDriveSearchArgs(params);
  const rawResult = await callMcpTool(toolName, mcpArgs);
  const safe = sanitizeMcpResult(rawResult);
  const rawText = extractMcpText(safe);
  return parseDriveSearchText(params.query, rawText);
}

export function buildDriveSearchArgs(params: GoogleDriveSearchParams): Record<string, unknown> {
  const args: Record<string, unknown> = {
    query: params.query,
    page_size: clampLimit(params.limit, 10, 50),
    include_items_from_all_drives: params.include_items_from_all_drives ?? true,
    detailed: params.detailed ?? true,
  };
  if (params.page_token) args.page_token = params.page_token;
  if (params.drive_id) args.drive_id = params.drive_id;
  if (params.corpora) args.corpora = params.corpora;
  if (params.file_type) args.file_type = params.file_type;
  return args;
}

export function parseDriveSearchText(query: string, text: string): GoogleDriveSearchResult {
  const tokenMatch = text.match(/nextPageToken:\s*([\s\S]+)$/);
  const nextPageToken = tokenMatch ? tokenMatch[1]?.replace(/\s+/g, "").trim() : undefined;
  const withoutToken = tokenMatch ? text.slice(0, tokenMatch.index).trimEnd() : text;

  const files: GoogleDriveSearchFile[] = [];
  const filePattern =
    /- Name:\s*"([^"]+)"\s*\(ID:\s*([^,]+),\s*Type:\s*([^,]+),\s*Size:\s*([^,]+),\s*Modified:\s*([^)]+)\)\s*Link:\s*(https?:\/\/\S+)/g;
  for (const match of withoutToken.matchAll(filePattern)) {
    const mimeType = match[3]?.trim() || "unknown";
    const rawSize = normalizeNullable(match[4]);
    const sizeBytes = parseSizeBytes(rawSize);
    files.push({
      name: match[1]?.trim() || "Untitled",
      id: match[2]?.trim() || "",
      mimeType,
      typeLabel: friendlyMimeType(mimeType),
      size: rawSize,
      sizeBytes,
      sizeLabel: formatSizeLabel(sizeBytes),
      modifiedTime: normalizeNullable(match[5]),
      link: normalizeNullable(match[6]),
    });
  }

  return { query, files, nextPageToken, rawText: text };
}

export function formatDriveSearchResult(result: GoogleDriveSearchResult): string {
  if (result.files.length === 0) {
    return `No Drive files parsed for query "${result.query}".`;
  }

  const lines = [`Found ${result.files.length} Drive file(s) matching "${result.query}":`, ""];
  result.files.forEach((file, index) => {
    const modified = file.modifiedTime ? file.modifiedTime.slice(0, 10) : "unknown";
    lines.push(`${index + 1}. ${file.name}`);
    lines.push(`   ID: ${file.id}`);
    lines.push(`   Type: ${file.typeLabel}`);
    if (file.sizeLabel) lines.push(`   Size: ${file.sizeLabel}`);
    lines.push(`   Modified: ${modified}`);
    if (file.link) lines.push(`   Link: ${file.link}`);
  });

  if (result.nextPageToken) {
    lines.push("");
    lines.push(
      "More results are available. Use the returned page_token from tool details to fetch the next page.",
    );
  }

  return lines.join("\n");
}

function extractMcpText(value: unknown): string {
  if (typeof value === "string") return value;
  if (isRecord(value)) {
    const content = value.content;
    if (Array.isArray(content)) {
      const textParts = content
        .filter(isRecord)
        .map((part) => (typeof part.text === "string" ? part.text : ""))
        .filter(Boolean);
      if (textParts.length) return textParts.join("\n");
    }
  }
  return JSON.stringify(value, null, 2);
}

function friendlyMimeType(mimeType: string): string {
  switch (mimeType) {
    case "application/vnd.google-apps.presentation":
      return "Presentation";
    case "application/vnd.google-apps.document":
      return "Document";
    case "application/vnd.google-apps.spreadsheet":
      return "Spreadsheet";
    case "application/vnd.google-apps.folder":
      return "Folder";
    case "application/pdf":
      return "PDF";
    case "text/plain":
      return "Text";
    default:
      return mimeType;
  }
}

/**
 * Parse a raw size string (bytes as digits) into a number or null.
 */
export function parseSizeBytes(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Format bytes into a human-friendly size label.
 */
export function formatSizeLabel(bytes: number | null): string | null {
  if (bytes == null) return null;
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  // Bytes: no decimals. KB+: 1 decimal for values >= 10, otherwise 2
  if (i === 0) return `${Math.round(value)} ${units[i]}`;
  const precision = value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[i]}`;
}

function normalizeNullable(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return null;
  return trimmed;
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (!value || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
