#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Generate the sf-data360 facade operation registry.
 *
 * The upstream snapshot intentionally contains only operation identity and REST
 * shape. Local overrides supply safety, parameter metadata, and operational
 * tips. This keeps future upstream imports reviewable while forcing every
 * executable operation to declare a safety level before it reaches d360.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const REGISTRY_DIR = path.join(ROOT, "extensions/sf-data360/registry");

const CHECK = process.argv.includes("--check");
const SAFETY_VALUES = new Set(["read", "safe_post", "confirmed", "destructive"]);
const METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);

const upstream = readJson("upstream-operations.json");
const overrides = readJson("overrides.json");
const families = readJson("families.json");
const runbooks = readJson("runbooks.json");
const examples = readJson("examples.json");

const generated = generateOperations(upstream, overrides);
validateRegistry({ operations: generated, families, runbooks, examples });

const targetPath = path.join(REGISTRY_DIR, "operations.json");
const current = readJson("operations.json");

if (CHECK) {
  if (!isDeepStrictEqual(current, generated)) {
    console.error(
      "❌ extensions/sf-data360/registry/operations.json is out of date. Run: npm run generate-d360-registry",
    );
    process.exit(1);
  }
  console.log(`✅ d360 operations registry is up to date (${generated.length} operation(s))`);
} else {
  writeFileSync(targetPath, `${JSON.stringify(generated, null, 2)}\n`, "utf8");
  console.log(`✅ d360 operations registry generated (${generated.length} operation(s))`);
}

function readJson(fileName) {
  return JSON.parse(readFileSync(path.join(REGISTRY_DIR, fileName), "utf8"));
}

function generateOperations(upstreamOps, overrideMap) {
  if (!Array.isArray(upstreamOps)) throw new Error("upstream-operations.json must be an array.");
  if (!overrideMap || typeof overrideMap !== "object" || Array.isArray(overrideMap)) {
    throw new Error("overrides.json must be an object keyed by operation name.");
  }

  return upstreamOps.map((source) => {
    const override = overrideMap[source.name] ?? {};
    const safety = override.safety ?? inferSafety(source);
    if (!safety) {
      throw new Error(
        `Operation ${source.name} has no safety override and safety could not be inferred.`,
      );
    }
    const merged = stripUndefined({ ...source, ...override, safety });
    return merged;
  });
}

function inferSafety(op) {
  if (op.method === "GET") return "read";
  if (op.method === "DELETE") return "destructive";
  if (op.method === "PATCH" || op.method === "PUT") return "confirmed";
  if (op.method !== "POST") return undefined;

  const pathText = String(op.path ?? "").toLowerCase();
  if (
    pathText.includes("/query-sql") ||
    pathText.includes("/connect/search/metadata/results") ||
    pathText.includes("/actions/validate") ||
    pathText.includes("/actions/test") ||
    pathText.includes("data-transforms-validation")
  ) {
    return "safe_post";
  }
  if (
    /\/actions\/(run|publish|enable|disable|deactivate|run-now|cancel|retry|refresh-status)\b/.test(
      pathText,
    ) ||
    pathText.includes("/deploy") ||
    pathText.includes("/undeploy")
  ) {
    return "confirmed";
  }
  return undefined;
}

function validateRegistry({ operations, families, runbooks, examples }) {
  const errors = [];
  const familyNames = new Set((families ?? []).map((family) => family.name));
  const operationNames = new Set();
  const runbookNames = new Set();

  for (const family of families ?? []) {
    if (!family.name) errors.push("Family missing name.");
    if (!family.summary) errors.push(`Family ${family.name} missing summary.`);
    if (!Array.isArray(family.keywords)) errors.push(`Family ${family.name} missing keywords[].`);
  }

  for (const op of operations) {
    if (!op.name) errors.push("Operation missing name.");
    if (operationNames.has(op.name)) errors.push(`Duplicate operation ${op.name}.`);
    operationNames.add(op.name);
    if (!familyNames.has(op.family))
      errors.push(`Operation ${op.name} has unknown family ${op.family}.`);
    if (!METHODS.has(op.method))
      errors.push(`Operation ${op.name} has invalid method ${op.method}.`);
    if (typeof op.path !== "string" || !op.path.startsWith("/")) {
      errors.push(`Operation ${op.name} path must start with /.`);
    }
    if (!SAFETY_VALUES.has(op.safety))
      errors.push(`Operation ${op.name} has invalid safety ${op.safety}.`);
    for (const param of pathParams(op.path)) {
      if (!(op.requiredParams ?? []).includes(param)) {
        errors.push(`Operation ${op.name} path param {${param}} must be listed in requiredParams.`);
      }
    }
  }

  for (const runbook of runbooks ?? []) {
    if (!runbook.name) errors.push("Runbook missing name.");
    if (runbookNames.has(runbook.name)) errors.push(`Duplicate runbook ${runbook.name}.`);
    runbookNames.add(runbook.name);
    if (!familyNames.has(runbook.family)) {
      errors.push(`Runbook ${runbook.name} has unknown family ${runbook.family}.`);
    }
  }

  const capabilityNames = new Set([...operationNames, ...runbookNames]);
  for (const [key, example] of Object.entries(examples ?? {})) {
    const capability = example && typeof example === "object" ? example.capability : undefined;
    if (!capability) {
      errors.push(`Example ${key} must reference capability.`);
      continue;
    }
    if (!capabilityNames.has(capability)) {
      errors.push(`Example ${key} references unknown capability ${capability}.`);
    }
  }

  if (errors.length) {
    for (const error of errors) console.error(`❌ ${error}`);
    throw new Error(`d360 registry validation failed with ${errors.length} error(s).`);
  }
}

function pathParams(pathText) {
  return [...String(pathText ?? "").matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
}

function stripUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}
