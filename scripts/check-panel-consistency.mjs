#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * check-panel-consistency.mjs
 *
 * Lint every bundled extension that registers a slash command and make
 * sure it is wired into the standardized panel pattern:
 *
 *   1. Imports `openCommandPanel` (or sf-pi-manager's bespoke overlay,
 *      which is the documented exception).
 *   2. Imports `openInfoPanel` so panel-driven action results land in a
 *      popup overlay instead of dumping a notify line.
 *   3. Imports the shared lifecycle toggle helper from sf-pi-manager so
 *      "Disable this extension" / "Enable this extension" works in
 *      every panel.
 *
 * Prints a concise table of compliance and exits non-zero on any
 * violation. Run from `npm run validate` (CI) or directly during local
 * development.
 *
 * Excluded from the contract:
 *   - sf-pi-manager itself (provides the overlay; not a per-extension panel)
 *   - sf-brain (alwaysActive; no command surface)
 *   - sf-ohana-spinner (no command surface)
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG_PATH = join(REPO_ROOT, "catalog", "index.json");

// Extensions that participate in the contract but are documented exceptions
// (own bespoke overlay, alwaysActive lifecycle, etc.).
const EXEMPT_EXTENSIONS = new Map([
  ["sf-pi-manager", "provides the package overlay; not a per-extension settings panel"],
  ["sf-brain", "alwaysActive; no command surface"],
  ["sf-ohana-spinner", "no command surface"],
  [
    "sf-lsp",
    "renders rich Doctor + Recent activity sections in its own ctx.ui.custom layout; still uses openInfoPanel for action results and the shared lifecycle toggle",
  ],
]);

const REQUIRED_IMPORTS = [
  {
    label: "openCommandPanel",
    pattern: /openCommandPanel/,
    rationale: "shared command panel — title, status, grouped actions, exit/quit close",
  },
  {
    label: "openInfoPanel",
    pattern: /openInfoPanel/,
    rationale: "panel action results render in a popup, not a chat notify dump",
  },
  {
    label: "lifecycle toggle helper",
    pattern: /buildToggleExtensionAction|performToggleExtension/,
    rationale: "every panel exposes Disable / Enable this extension",
  },
];

// Panels that route lifecycle.toggle through performToggleExtension MUST
// pass closeBeforeAction so the panel closes BEFORE ctx.reload() runs.
// Skipping it strands the ctx.ui.custom() promise and hangs the surrounding
// slash-command handler. See lib/common/command-panel.ts (closeBeforeAction
// docstring) for the full rationale.
const CLOSE_BEFORE_ACTION_RULE = {
  label: "closeBeforeAction wiring for lifecycle.toggle",
  // Trigger: imports performToggleExtension AND calls openCommandPanel.
  triggers: [/performToggleExtension/, /openCommandPanel\s*\(/],
  // Required evidence: imports the helper AND uses it as closeBeforeAction.
  required: [/isLifecycleToggleAction/, /closeBeforeAction\s*:\s*isLifecycleToggleAction/],
  rationale:
    "actions that call ctx.reload() must close the panel first, otherwise the ctx.ui.custom() promise dangles and the slash-command handler hangs",
};

function loadCatalog() {
  const raw = readFileSync(CATALOG_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("catalog/index.json is not an array");
  }
  return parsed;
}

function safeReadDir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function readDirRecursive(dir) {
  const out = [];
  for (const entry of safeReadDir(dir)) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...readDirRecursive(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

const FORBIDDEN_FILENAMES = new Map([
  [
    "lib/panel.ts",
    "renamed to lib/command-panel.ts \u2014 reserved name for the no-args slash-command panel",
  ],
  [
    "lib/settings-panel.ts",
    "renamed to lib/preferences-panel.ts \u2014 disambiguates from the manager-invoked lib/config-panel.ts",
  ],
]);

function checkForbiddenFilenames(ext) {
  const extDir = join(REPO_ROOT, "extensions", ext.id);
  const violations = [];
  for (const [rel, reason] of FORBIDDEN_FILENAMES) {
    if (existsSync(join(extDir, rel))) {
      violations.push(`${rel} \u2014 ${reason}`);
    }
  }
  return violations;
}

function checkExtension(ext) {
  if (!Array.isArray(ext.commands) || ext.commands.length === 0) return null;
  if (EXEMPT_EXTENSIONS.has(ext.id)) return null;
  // (We still apply the openInfoPanel + lifecycle-toggle checks below to
  // every non-exempt extension. The exempt list is just for the panel
  // entry point.)

  const entryPath = join(REPO_ROOT, ext.entry);
  let entrySource;
  try {
    entrySource = readFileSync(entryPath, "utf8");
  } catch (error) {
    return {
      id: ext.id,
      ok: false,
      missing: ["index.ts entry not readable"],
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  // Some extensions split their panel into a sibling file (sf-llm-gateway-internal,
  // sf-lsp). We grep the entry plus every .ts file under lib/ so the import does
  // not have to live in the entry itself.
  const libRoot = join(dirname(entryPath), "lib");
  const libSource = readDirRecursive(libRoot)
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  const allSources = [entrySource, libSource].join("\n");

  const missing = REQUIRED_IMPORTS.filter((req) => !req.pattern.test(allSources)).map(
    (req) => `${req.label} — ${req.rationale}`,
  );

  // closeBeforeAction wiring lint. Only applies when the extension uses
  // openCommandPanel AND routes lifecycle.toggle through performToggleExtension.
  // (sf-lsp uses its own ctx.ui.custom layout that already closes the panel
  // before invoking the action, which is why it is on the EXEMPT_EXTENSIONS
  // list at the top.)
  const triggers = CLOSE_BEFORE_ACTION_RULE.triggers.every((re) => re.test(allSources));
  const closeBeforeViolations = [];
  if (triggers) {
    for (const re of CLOSE_BEFORE_ACTION_RULE.required) {
      if (!re.test(allSources)) {
        closeBeforeViolations.push(
          `${CLOSE_BEFORE_ACTION_RULE.label} — ${CLOSE_BEFORE_ACTION_RULE.rationale}`,
        );
        break;
      }
    }
  }

  const forbidden = checkForbiddenFilenames(ext).map((entry) => `forbidden filename ${entry}`);
  const issues = [...missing, ...closeBeforeViolations, ...forbidden];

  return { id: ext.id, ok: issues.length === 0, missing: issues };
}

function main() {
  const catalog = loadCatalog();
  const reports = [];
  for (const ext of catalog) {
    const report = checkExtension(ext);
    if (report) reports.push(report);
  }

  const violations = reports.filter((r) => !r.ok);
  const passing = reports.filter((r) => r.ok);
  const exempt = catalog
    .filter((ext) => EXEMPT_EXTENSIONS.has(ext.id))
    .map((ext) => ({ id: ext.id, reason: EXEMPT_EXTENSIONS.get(ext.id) }));

  console.log(
    `Panel consistency check — ${passing.length} ok, ${violations.length} violation(s), ${exempt.length} exempt`,
  );
  for (const r of passing) {
    console.log(`  ✓ ${r.id}`);
  }
  for (const r of violations) {
    console.log(`  ✗ ${r.id}`);
    for (const reason of r.missing) console.log(`      - missing ${reason}`);
    if (r.detail) console.log(`      ${r.detail}`);
  }
  for (const e of exempt) {
    console.log(`  ◆ ${e.id} (exempt: ${e.reason})`);
  }

  if (violations.length > 0) {
    console.log("");
    console.log("How to fix:");
    console.log("  See lib/common/command-panel.ts and");
    console.log("  lib/common/extension-toggle.ts for the contract.");
    console.log("  sf-slack and sf-devbar are reference implementations.");
    process.exit(1);
  }
}

main();
