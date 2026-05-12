#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
// Guardrail for sf-pi's boot-path contract.
//
// Pi loads every extension entry point before session_start. In this repo,
// extension entry points import a shared lib/common tree, so a single heavy
// runtime import in that tree can silently become startup work for many
// extensions. This lint walks the runtime static-import graph starting at each
// extension index file and rejects Salesforce SDK imports that should be
// lazy-loaded behind command/tool/live-refresh paths instead.
//
// Allowed:
//   import type { Connection } from "@salesforce/core";
//   const { Org } = await import("@salesforce/core"); // lazy, not static
//
// Rejected:
//   import { Org } from "@salesforce/core";
//   import { ComponentSet } from "@salesforce/source-deploy-retrieve";
//   import jsforce from "jsforce";
//
// Intentional exceptions must be explicit with a nearby comment containing:
//   sf-pi-allow-boot-import
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const extensionsDir = path.join(repoRoot, "extensions");

const HEAVY_RUNTIME_IMPORTS = ["@salesforce/core", "@salesforce/source-deploy-retrieve", "jsforce"];
const ALLOW_COMMENT = "sf-pi-allow-boot-import";

function discoverEntries() {
  return readdirSync(extensionsDir)
    .map((name) => path.join(extensionsDir, name, "index.ts"))
    .filter((file) => existsSync(file))
    .sort();
}

function rel(file) {
  return path.relative(repoRoot, file);
}

function startsWithHeavyImport(source) {
  return HEAVY_RUNTIME_IMPORTS.find((heavy) => source === heavy || source.startsWith(heavy + "/"));
}

function isTypeOnlyImport(importClause) {
  const clause = importClause.trim();
  if (clause.startsWith("type ")) return true;
  if (!clause.startsWith("{")) return false;

  // Handles: import { type Foo, type Bar as Baz } from "...";
  // Mixed imports like { foo, type Foo } are runtime imports.
  const inner = clause.replace(/^\{/, "").replace(/\}$/, "").trim();
  if (!inner) return false;
  return inner
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .every((part) => part.startsWith("type "));
}

function hasAllowComment(lines, lineNumber) {
  const candidates = [lineNumber - 1, lineNumber - 2, lineNumber - 3]
    .filter((index) => index >= 0)
    .map((index) => lines[index]);
  return candidates.some((line) => line?.includes(ALLOW_COMMENT));
}

function parseStaticImports(file) {
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const imports = [];

  // import ... from "..."; supports multiline import clauses.
  const fromRe = /import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  for (const match of text.matchAll(fromRe)) {
    const before = text.slice(0, match.index ?? 0);
    const lineNumber = before.split(/\r?\n/).length;
    const lineText = lines[lineNumber - 1]?.trim() ?? "";
    if (lineText.startsWith("//") || lineText.startsWith("*")) continue;
    const importClause = match[1] ?? "";
    const source = match[2] ?? "";
    imports.push({
      source,
      lineNumber,
      typeOnly: isTypeOnlyImport(importClause),
      allowed: hasAllowComment(lines, lineNumber - 1),
    });
  }

  // import "side-effect";
  const sideEffectRe = /import\s+["']([^"']+)["']/g;
  for (const match of text.matchAll(sideEffectRe)) {
    const before = text.slice(0, match.index ?? 0);
    const lineNumber = before.split(/\r?\n/).length;
    const lineText = lines[lineNumber - 1]?.trim() ?? "";
    if (lineText.startsWith("//") || lineText.startsWith("*")) continue;
    const source = match[1] ?? "";
    imports.push({
      source,
      lineNumber,
      typeOnly: false,
      allowed: hasAllowComment(lines, lineNumber - 1),
    });
  }

  return imports;
}

function resolveRelativeImport(fromFile, source) {
  if (!source.startsWith(".")) return null;

  const base = path.resolve(path.dirname(fromFile), source);
  const candidates = [];
  const ext = path.extname(base);
  if (ext) {
    candidates.push(base);
    if (ext === ".js") candidates.push(base.slice(0, -3) + ".ts");
    if (ext === ".ts") candidates.push(base.slice(0, -3) + ".js");
  } else {
    candidates.push(`${base}.ts`, `${base}.tsx`, `${base}.js`, path.join(base, "index.ts"));
  }

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

const violations = [];
const visited = new Set();

function walk(file, entry, stack) {
  const key = `${entry}::${file}`;
  if (visited.has(key)) return;
  visited.add(key);

  for (const imp of parseStaticImports(file)) {
    if (!imp.typeOnly) {
      const heavy = startsWithHeavyImport(imp.source);
      if (heavy && !imp.allowed) {
        violations.push({
          entry,
          file,
          lineNumber: imp.lineNumber,
          source: imp.source,
          heavy,
          stack: [...stack, file],
        });
      }
    }

    // Type-only relative imports are erased by TS and are not part of the
    // runtime boot graph, so don't follow them.
    if (imp.typeOnly) continue;
    const resolved = resolveRelativeImport(file, imp.source);
    if (resolved && resolved.startsWith(repoRoot)) {
      walk(resolved, entry, [...stack, file]);
    }
  }
}

for (const entry of discoverEntries()) {
  walk(entry, entry, []);
}

if (violations.length > 0) {
  console.error("Boot-path import violations found.\n");
  for (const v of violations) {
    console.error(`- ${rel(v.file)}:${v.lineNumber}`);
    console.error(`  imports ${v.source}`);
    console.error(`  reached from ${rel(v.entry)}`);
    const chain = v.stack.map(rel);
    if (chain.length > 1) {
      console.error("  chain:");
      for (const item of chain) console.error(`    → ${item}`);
    }
    console.error("");
  }
  console.error("Why this fails:");
  console.error(
    "  Salesforce SDK imports in the boot graph slow startup and can trigger auth/keychain work before first paint.",
  );
  console.error("Fix:");
  console.error("  - use import type for types only");
  console.error(
    "  - move runtime imports behind await import(...) in command/tool/live-refresh functions",
  );
  console.error(
    `  - if truly required at startup, add a nearby '${ALLOW_COMMENT}' comment with rationale`,
  );
  process.exit(1);
}

console.log("✅ boot-path import check passed");
