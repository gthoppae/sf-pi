/* SPDX-License-Identifier: Apache-2.0 */
/**
 * On-disk store for preview sessions.
 *
 * Layout (Salesforce-standard, mirrored from `@salesforce/agents` ScriptAgent):
 *
 *   <cwd>/.sfdx/agents/<agentName>/sessions/<sessionId>/
 *   ├── metadata.json        { sessionId, agentName, startTime, endTime?, mockMode, planIds[] }
 *   ├── transcript.jsonl     append-only; one TranscriptEntry per line (user|agent)
 *   └── traces/<planId>.json full PlannerResponse per turn
 *
 * sf-guardrail allows `.sfdx/agents/**` (carve-out from the broader `.sfdx/**`
 * block). Other paths under `.sfdx/` remain locked.
 *
 * Append-only writes: transcript.jsonl is appended via fs.appendFile so
 * concurrent writes don't clobber each other. metadata.json is rewritten on
 * each flush — small enough that atomicity isn't a concern.
 */

import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// -------------------------------------------------------------------------------------------------
// Public types
// -------------------------------------------------------------------------------------------------

export interface PreviewMetadata {
  sessionId: string;
  agentName: string;
  startTime: string;
  endTime?: string;
  mockMode: "Mock" | "Live Test";
  /** agent_file = v1.1 preview session; api_name = published-agent v1 session. */
  sessionKind?: "agent_file" | "api_name";
  planIds: string[];
}

export interface TranscriptEntry {
  timestamp: string;
  agentName: string;
  sessionId: string;
  role: "user" | "agent";
  text?: string;
  raw?: unknown;
  reason?: string;
  planId?: string;
}

// -------------------------------------------------------------------------------------------------
// Path helpers
// -------------------------------------------------------------------------------------------------

const SESSIONS_BASE_REL = path.join(".sfdx", "agents");

export function getSessionDir(cwd: string, agentName: string, sessionId: string): string {
  return path.join(cwd, SESSIONS_BASE_REL, agentName, "sessions", sessionId);
}

export function getAgentBaseDir(cwd: string, agentName?: string): string {
  return agentName
    ? path.join(cwd, SESSIONS_BASE_REL, agentName)
    : path.join(cwd, SESSIONS_BASE_REL);
}

// -------------------------------------------------------------------------------------------------
// Read
// -------------------------------------------------------------------------------------------------

export async function loadSession(
  cwd: string,
  agentName: string,
  sessionId: string,
): Promise<{ metadata: PreviewMetadata; transcript: TranscriptEntry[] }> {
  const dir = getSessionDir(cwd, agentName, sessionId);
  const metaRaw = await readFile(path.join(dir, "metadata.json"), "utf8");
  const metadata = JSON.parse(metaRaw) as PreviewMetadata;
  let transcript: TranscriptEntry[] = [];
  try {
    const raw = await readFile(path.join(dir, "transcript.jsonl"), "utf8");
    transcript = raw
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as TranscriptEntry);
  } catch {
    /* empty session — no transcript yet */
  }
  return { metadata, transcript };
}

// -------------------------------------------------------------------------------------------------
// Write
// -------------------------------------------------------------------------------------------------

export async function initSession(
  cwd: string,
  meta: Omit<PreviewMetadata, "endTime" | "planIds"> & { planIds?: string[] },
): Promise<string> {
  const dir = getSessionDir(cwd, meta.agentName, meta.sessionId);
  await mkdir(dir, { recursive: true });
  await mkdir(path.join(dir, "traces"), { recursive: true });
  const full: PreviewMetadata = {
    sessionId: meta.sessionId,
    agentName: meta.agentName,
    startTime: meta.startTime,
    mockMode: meta.mockMode,
    sessionKind: meta.sessionKind,
    planIds: meta.planIds ?? [],
  };
  await writeFile(path.join(dir, "metadata.json"), JSON.stringify(full, null, 2), "utf8");
  return dir;
}

export async function logTurn(sessionDir: string, entry: TranscriptEntry): Promise<void> {
  await appendFile(path.join(sessionDir, "transcript.jsonl"), JSON.stringify(entry) + "\n", "utf8");
}

export async function logTrace(sessionDir: string, planId: string, trace: unknown): Promise<void> {
  const file = path.join(sessionDir, "traces", `${planId}.json`);
  await writeFile(file, JSON.stringify(trace, null, 2), "utf8");
  // Update metadata.json to track planIds.
  try {
    const metaPath = path.join(sessionDir, "metadata.json");
    const metaRaw = await readFile(metaPath, "utf8");
    const meta = JSON.parse(metaRaw) as PreviewMetadata;
    if (!meta.planIds.includes(planId)) {
      meta.planIds.push(planId);
      await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");
    }
  } catch {
    /* non-fatal — metadata will sync on endSession */
  }
}

export async function endSession(sessionDir: string, endTime: string): Promise<PreviewMetadata> {
  const metaPath = path.join(sessionDir, "metadata.json");
  const metaRaw = await readFile(metaPath, "utf8");
  const meta = JSON.parse(metaRaw) as PreviewMetadata;
  meta.endTime = endTime;
  await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");
  return meta;
}

// -------------------------------------------------------------------------------------------------
// Cleanup (preview action=cleanup)
// -------------------------------------------------------------------------------------------------

export interface CleanupResult {
  removed: Array<{ agent: string; session_id: string; age_days: number }>;
  kept_count: number;
}

/**
 * Walk the agents tree and remove session dirs whose `metadata.endTime` (or
 * `startTime` if endTime is missing) is older than `olderThanDays`. With
 * `dryRun=true`, returns what would be removed without actually deleting.
 */
export async function cleanupSessions(
  cwd: string,
  olderThanDays: number,
  dryRun = false,
): Promise<CleanupResult> {
  const removed: CleanupResult["removed"] = [];
  let keptCount = 0;
  const now = Date.now();
  const cutoffMs = olderThanDays * 24 * 60 * 60 * 1000;

  const agentsRoot = getAgentBaseDir(cwd);
  let agents: string[];
  try {
    agents = await readdir(agentsRoot);
  } catch {
    return { removed: [], kept_count: 0 };
  }

  for (const agent of agents) {
    const agentSessionsDir = path.join(agentsRoot, agent, "sessions");
    let sessions: string[];
    try {
      sessions = await readdir(agentSessionsDir);
    } catch {
      continue;
    }
    for (const sessionId of sessions) {
      const sessionDir = path.join(agentSessionsDir, sessionId);
      let info;
      try {
        info = await stat(sessionDir);
      } catch {
        continue;
      }
      if (!info.isDirectory()) continue;

      let metadata: PreviewMetadata | null = null;
      try {
        const raw = await readFile(path.join(sessionDir, "metadata.json"), "utf8");
        metadata = JSON.parse(raw) as PreviewMetadata;
      } catch {
        // Treat sessions without metadata as old enough to remove if the
        // dir mtime exceeds the cutoff.
      }

      const referenceTime = metadata?.endTime ?? metadata?.startTime;
      const ageMs = referenceTime ? now - new Date(referenceTime).getTime() : now - info.mtimeMs;
      const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));

      if (ageMs > cutoffMs) {
        removed.push({ agent, session_id: sessionId, age_days: ageDays });
        if (!dryRun) {
          await rmrf(sessionDir);
        }
      } else {
        keptCount++;
      }
    }
  }

  return { removed, kept_count: keptCount };
}

async function rmrf(dir: string): Promise<void> {
  const { rm } = await import("node:fs/promises");
  await rm(dir, { recursive: true, force: true });
}
