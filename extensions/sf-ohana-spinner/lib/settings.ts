/* SPDX-License-Identifier: Apache-2.0 */
/** Persistent user preference for the Ohana spinner mode. */
import {
  globalSettingsPath,
  projectSettingsPath,
  readJsonFile,
  writeJsonFile,
} from "../../../lib/common/sf-pi-settings.ts";

export const OHANA_SPINNER_MODES = ["ohana", "calm"] as const;
export type OhanaSpinnerMode = (typeof OHANA_SPINNER_MODES)[number];
export type OhanaSpinnerSettingsScope = "global" | "project";

export interface OhanaSpinnerSettings {
  mode: OhanaSpinnerMode;
}

export interface ScopedOhanaSpinnerSettings {
  scope: OhanaSpinnerSettingsScope;
  path: string;
  settings: OhanaSpinnerSettings;
  exists: boolean;
}

export interface EffectiveOhanaSpinnerSettings extends OhanaSpinnerSettings {
  source: OhanaSpinnerSettingsScope | "default";
  path?: string;
}

export const DEFAULT_OHANA_SPINNER_SETTINGS: OhanaSpinnerSettings = { mode: "ohana" };

function settingsPathForScope(cwd: string, scope: OhanaSpinnerSettingsScope): string {
  return scope === "project" ? projectSettingsPath(cwd) : globalSettingsPath();
}

function getNestedRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function isOhanaSpinnerMode(value: unknown): value is OhanaSpinnerMode {
  return OHANA_SPINNER_MODES.includes(value as OhanaSpinnerMode);
}

export function normalizeOhanaSpinnerSettings(value: unknown): OhanaSpinnerSettings {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    mode: isOhanaSpinnerMode(candidate.mode) ? candidate.mode : DEFAULT_OHANA_SPINNER_SETTINGS.mode,
  };
}

function readOhanaSpinnerSettingsFromRoot(root: Record<string, unknown>): OhanaSpinnerSettings {
  const sfPi = getNestedRecord(root, "sfPi");
  const ohanaSpinner = getNestedRecord(sfPi, "ohanaSpinner");
  return normalizeOhanaSpinnerSettings(ohanaSpinner);
}

function hasOwnMode(root: Record<string, unknown>): boolean {
  const sfPi = getNestedRecord(root, "sfPi");
  const ohanaSpinner = getNestedRecord(sfPi, "ohanaSpinner");
  return Object.prototype.hasOwnProperty.call(ohanaSpinner, "mode");
}

function writeOhanaSpinnerSettingsToRoot(
  root: Record<string, unknown>,
  settings: OhanaSpinnerSettings,
): Record<string, unknown> {
  const nextRoot = { ...root };
  const sfPi = { ...getNestedRecord(nextRoot, "sfPi") };
  sfPi.ohanaSpinner = normalizeOhanaSpinnerSettings(settings);
  nextRoot.sfPi = sfPi;
  return nextRoot;
}

export function readScopedOhanaSpinnerSettings(
  cwd: string,
  scope: OhanaSpinnerSettingsScope,
): ScopedOhanaSpinnerSettings {
  const filePath = settingsPathForScope(cwd, scope);
  const root = readJsonFile(filePath);
  return {
    scope,
    path: filePath,
    settings: readOhanaSpinnerSettingsFromRoot(root),
    exists: hasOwnMode(root),
  };
}

export function readEffectiveOhanaSpinnerSettings(cwd: string): EffectiveOhanaSpinnerSettings {
  const project = readScopedOhanaSpinnerSettings(cwd, "project");
  if (project.exists) {
    return { ...project.settings, source: "project", path: project.path };
  }

  const global = readScopedOhanaSpinnerSettings(cwd, "global");
  if (global.exists) {
    return { ...global.settings, source: "global", path: global.path };
  }

  return { ...DEFAULT_OHANA_SPINNER_SETTINGS, source: "default" };
}

export function writeScopedOhanaSpinnerSettings(
  cwd: string,
  scope: OhanaSpinnerSettingsScope,
  settings: OhanaSpinnerSettings,
): ScopedOhanaSpinnerSettings {
  const filePath = settingsPathForScope(cwd, scope);
  const root = readJsonFile(filePath);
  const normalized = normalizeOhanaSpinnerSettings(settings);
  const nextRoot = writeOhanaSpinnerSettingsToRoot(root, normalized);
  writeJsonFile(filePath, nextRoot);

  return {
    scope,
    path: filePath,
    settings: normalized,
    exists: true,
  };
}

export function describeOhanaSpinnerSettingsSource(
  settings: EffectiveOhanaSpinnerSettings,
): string {
  if (settings.source === "default") return "default";
  return `${settings.source} (${settings.path})`;
}
