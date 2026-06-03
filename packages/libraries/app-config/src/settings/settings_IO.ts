import { promises as fs } from 'fs';
import path from 'path';
import type { VTSettings } from '@vt/graph-model/settings';

import {DEFAULT_SETTINGS} from '@vt/graph-model/settings';
import {getCallbacks} from '@vt/graph-model';
import {resolveVoicetreeHomePath} from '@vt/paths';
import {SETTINGS_FILENAME} from '../config-files.ts';

function getSettingsPath(voicetreeHomePath: string): string {
  return path.join(voicetreeHomePath, SETTINGS_FILENAME);
}

/** Reset the settings cache. For testing only. */
export function clearSettingsCache(): void {
  // No-op: loadSettings reads from disk on every call so cross-process writes are visible immediately.
}

export async function loadSettings(): Promise<VTSettings> {
  const voicetreeHomePath: string = resolveVoicetreeHomePath();
  const settingsPath: string = getSettingsPath(voicetreeHomePath);
  try {
    const data: string = await fs.readFile(settingsPath, 'utf-8');
    const userSettings: Partial<VTSettings> = JSON.parse(data) as Partial<VTSettings>;
    // Shallow merge at top level; deep-merge INJECT_ENV_VARS so new default keys always reach users
    // without clobbering user-owned overrides such as AGENT_PROMPT_CORE.
    const settings: VTSettings = {
      ...DEFAULT_SETTINGS,
      ...userSettings,
      INJECT_ENV_VARS: {
        ...DEFAULT_SETTINGS.INJECT_ENV_VARS,
        ...userSettings.INJECT_ENV_VARS,
      },
    };
    return settings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await saveSettings(DEFAULT_SETTINGS);
      return DEFAULT_SETTINGS;
    }
    throw error;
  }
}

/**
 * Migrates layoutConfig JSON string to update nodeSpacing from old default (70) to new default (120).
 * Silent migration — no dialog, since users are unlikely to have intentionally set this value.
 * @returns true if migration occurred, false otherwise
 */
export async function migrateLayoutConfigIfNeeded(): Promise<boolean> {
  const voicetreeHomePath: string = resolveVoicetreeHomePath();
  const settingsPath: string = getSettingsPath(voicetreeHomePath);

  let userSettings: Partial<VTSettings>;
  try {
    const data: string = await fs.readFile(settingsPath, 'utf-8');
    userSettings = JSON.parse(data) as Partial<VTSettings>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }

  const layoutConfigStr: string | undefined = userSettings.layoutConfig;
  if (!layoutConfigStr) {
    return false; // No saved layoutConfig — will use new default anyway
  }

  try {
    const parsed: Record<string, unknown> = JSON.parse(layoutConfigStr) as Record<string, unknown>;
    if (parsed.nodeSpacing !== 70) {
      return false; // User has a custom value or already migrated
    }
    parsed.nodeSpacing = 120;
    const updatedSettings: VTSettings = {
      ...DEFAULT_SETTINGS,
      ...userSettings,
      layoutConfig: JSON.stringify(parsed, null, 2),
    };
    await saveSettings(updatedSettings);
    return true;
  } catch {
    return false; // Malformed JSON — leave as-is
  }
}

/**
 * Migrates starredFolders from old default (empty array) to new default
 * which includes ~/brain/workflows. Silent migration.
 * @returns true if migration occurred, false otherwise
 */
export async function migrateStarredFoldersIfNeeded(): Promise<boolean> {
  const voicetreeHomePath: string = resolveVoicetreeHomePath();
  const settingsPath: string = getSettingsPath(voicetreeHomePath);

  let userSettings: Partial<VTSettings>;
  try {
    const data: string = await fs.readFile(settingsPath, 'utf-8');
    userSettings = JSON.parse(data) as Partial<VTSettings>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }

  // Only migrate if user has an explicit empty starredFolders array (old default)
  // If they have any entries, they've customized it — don't touch
  if (!Array.isArray(userSettings.starredFolders) || userSettings.starredFolders.length > 0) {
    return false;
  }

  const defaultStarred: readonly string[] | undefined = DEFAULT_SETTINGS.starredFolders;
  if (!defaultStarred || defaultStarred.length === 0) {
    return false; // No default to migrate to
  }

  const updatedSettings: VTSettings = {
    ...DEFAULT_SETTINGS,
    ...userSettings,
    starredFolders: [...defaultStarred],
  };

  await saveSettings(updatedSettings);
  return true;
}

/**
 * Migrates starredFolders entries from ~/voicetree/workflows to ~/brain/workflows.
 * Simple string replace on each entry. Silent migration.
 * @returns true if migration occurred, false otherwise
 */
export async function migrateStarredFoldersBrainRename(): Promise<boolean> {
  const voicetreeHomePath: string = resolveVoicetreeHomePath();
  const settingsPath: string = getSettingsPath(voicetreeHomePath);

  let userSettings: Partial<VTSettings>;
  try {
    const data: string = await fs.readFile(settingsPath, 'utf-8');
    userSettings = JSON.parse(data) as Partial<VTSettings>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }

  if (!Array.isArray(userSettings.starredFolders)) {
    return false;
  }

  const migrated: string[] = userSettings.starredFolders.map((entry: string) =>
    entry.replace('/voicetree/workflows', '/brain/workflows'),
  );

  const changed: boolean = migrated.some((entry: string, i: number) => entry !== userSettings.starredFolders![i]);
  if (!changed) {
    return false;
  }

  const updatedSettings: VTSettings = {
    ...DEFAULT_SETTINGS,
    ...userSettings,
    starredFolders: migrated,
  };

  await saveSettings(updatedSettings);
  return true;
}

/**
 * Project the resolved `VTSettings` down to a browser-safe view (RE-PLAN B /
 * Design B). VTD's authenticated `GET /settings` previously shipped the full
 * settings INCLUDING `INJECT_ENV_VARS` (API keys etc.) to the browser; behind
 * the bearer gate, any webapp XSS would leak every secret.
 *
 * This is an EXPLICIT ALLOWLIST: it constructs the result field-by-field, so a
 * newly added `VTSettings` field is NOT exposed to the browser until someone
 * consciously adds it here — the projection fails CLOSED, which is the security
 * property we want.
 *
 * Co-located with `loadSettings` because it projects a loaded-settings value
 * for a browser client; that is a settings-IO concern, not a graph-model one.
 *
 * Stripped:
 *   - `INJECT_ENV_VARS` → `{}` (the secret bag). This is semantically TRUE for
 *     the browser: the browser is not the injection site — the daemon injects
 *     agent env server-side via buildTerminalEnvVars, and browser-mode spawn
 *     routes through VTD RPC carrying only {taskNodeId, agentCommand,
 *     terminalCount}. So this is data-minimisation, not a workaround.
 *   - `hooks` → omitted (host shell commands the browser never runs).
 *   - `shell` → omitted (host shell override; a host concern).
 *
 * Returns a `VTSettings` (not a narrower type) on purpose: Electron + browser
 * share one `loadSettings(): Promise<VTSettings>` contract, and a structurally
 * narrower type would force a cross-cutting refactor of shared renderer UI.
 */
export function projectBrowserSafeSettings(s: VTSettings): VTSettings {
  return {
    // UI-driving, non-secret fields — copied verbatim.
    terminalSpawnPathRelativeToWatchedDirectory: s.terminalSpawnPathRelativeToWatchedDirectory,
    agents: s.agents,
    shiftEnterSendsOptionEnter: s.shiftEnterSendsOptionEnter,
    contextNodeMaxDistance: s.contextNodeMaxDistance,
    enableSemanticContext: s.enableSemanticContext,
    contextMaxChars: s.contextMaxChars,
    askModeContextDistance: s.askModeContextDistance,
    agentPermissionModeChosen: s.agentPermissionModeChosen,
    userEmail: s.userEmail,
    emptyFolderTemplate: s.emptyFolderTemplate,
    vimMode: s.vimMode,
    siliconValleyMode: s.siliconValleyMode,
    hotkeys: s.hotkeys,
    defaultAllowlistPatterns: s.defaultAllowlistPatterns,
    feedbackDialogShown: s.feedbackDialogShown,
    autoNotifyUnseenNodes: s.autoNotifyUnseenNodes,
    darkMode: s.darkMode,
    zoomSensitivity: s.zoomSensitivity,
    nodeLineLimit: s.nodeLineLimit,
    subgraphWarnThreshold: s.subgraphWarnThreshold,
    subgraphErrorThreshold: s.subgraphErrorThreshold,
    starredFolders: s.starredFolders,
    terminalTmuxMouseMode: s.terminalTmuxMouseMode,
    terminalScrollStrategy: s.terminalScrollStrategy,
    defaultAgent: s.defaultAgent,
    notifyOnAgentCompletion: s.notifyOnAgentCompletion,
    showFps: s.showFps,
    layoutConfig: s.layoutConfig,
    // EXCLUDED secrets/host concerns — emptied (INJECT_ENV_VARS is required,
    // so it must be present; hooks/shell are optional and omitted entirely).
    INJECT_ENV_VARS: {},
  };
}

export async function saveSettings(settings: VTSettings): Promise<boolean> {
  const voicetreeHomePath: string = resolveVoicetreeHomePath();
  const settingsPath: string = getSettingsPath(voicetreeHomePath);
  const settingsDir: string = path.dirname(settingsPath);

  await fs.mkdir(settingsDir, { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  getCallbacks().onSettingsChanged?.();
  return true;
}

/**
 * Merge a browser-originated settings patch onto the on-disk settings, accepting
 * ONLY browser-safe fields. This is the WRITE-side counterpart of
 * `projectBrowserSafeSettings`: the browser-mode renderer holds the projected
 * (secret-stripped) settings, edits some fields, and POSTs them back — but the
 * daemon must never let the renderer write `INJECT_ENV_VARS` (API keys), `hooks`
 * (host shell commands) or `shell` (host shell override). Behind the bearer gate
 * alone, any webapp XSS could otherwise overwrite secrets / inject shell hooks.
 *
 * The write allowlist is DERIVED from the read projection — the writable keys are
 * exactly the keys `projectBrowserSafeSettings` exposes, minus `INJECT_ENV_VARS`
 * (which the projection zeroes, and which is the secret bag the browser may never
 * write). Defining one allowlist in terms of the other makes drift impossible: a
 * field is browser-writable iff it is browser-readable.
 *
 * Fail-closed: any key in `incoming` outside the allowlist is silently dropped,
 * and the resulting object keeps `current`'s secret/host fields untouched because
 * the patch can never contain them.
 */
export function mergeBrowserSafeSettings(current: VTSettings, incoming: Partial<VTSettings>): VTSettings {
  const writableKeys: readonly (keyof VTSettings)[] =
    (Object.keys(projectBrowserSafeSettings(current)) as (keyof VTSettings)[])
      .filter((key: keyof VTSettings): boolean => key !== 'INJECT_ENV_VARS');

  const patch: Partial<VTSettings> = {};
  for (const key of writableKeys) {
    if (key in incoming) {
      // key ∈ keyof VTSettings; the per-key value types are heterogeneous, so
      // index-assign through an unknown view. The allowlist guarantees `key`
      // is never a secret/host field.
      (patch as Record<string, unknown>)[key] = incoming[key];
    }
  }

  return { ...current, ...patch };
}

/**
 * Persist a browser-originated settings patch to disk through the browser-safe
 * write allowlist (see `mergeBrowserSafeSettings`). Loads the current on-disk
 * settings (carrying the secrets the browser never sees), merges the allowlisted
 * fields, writes, and returns the browser-safe projection of the saved result so
 * the caller can echo back exactly what the browser is now permitted to observe.
 */
export async function saveBrowserSafeSettings(incoming: Partial<VTSettings>): Promise<VTSettings> {
  const current: VTSettings = await loadSettings();
  const merged: VTSettings = mergeBrowserSafeSettings(current, incoming);
  await saveSettings(merged);
  return projectBrowserSafeSettings(merged);
}
