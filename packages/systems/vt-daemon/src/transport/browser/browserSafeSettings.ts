// Browser-safe settings projection + write path (RE-PLAN B / Design B).
//
// VTD's authenticated browser-mode `GET/POST /settings` is the SOLE consumer of
// these — they live here, next to `settingsHandler.ts`, rather than in shared
// `@vt/app-config` so the secret-stripping logic is co-located with the one HTTP
// edge that must apply it. `loadSettings`/`saveSettings` (the on-disk settings
// IO, shared across Electron + daemon) stay in `@vt/app-config/settings`.

import type {VTSettings} from '@vt/graph-model/settings'
import {loadSettings, saveSettings} from '@vt/app-config/settings'

/**
 * Project the resolved `VTSettings` down to a browser-safe view. VTD's
 * authenticated `GET /settings` previously shipped the full settings INCLUDING
 * `INJECT_ENV_VARS` (API keys etc.) to the browser; behind the bearer gate, any
 * webapp XSS would leak every secret.
 *
 * This is an EXPLICIT ALLOWLIST: it constructs the result field-by-field, so a
 * newly added `VTSettings` field is NOT exposed to the browser until someone
 * consciously adds it here — the projection fails CLOSED, which is the security
 * property we want.
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
  }
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
      .filter((key: keyof VTSettings): boolean => key !== 'INJECT_ENV_VARS')

  const patch: Partial<VTSettings> = {}
  for (const key of writableKeys) {
    if (key in incoming) {
      // key ∈ keyof VTSettings; the per-key value types are heterogeneous, so
      // index-assign through an unknown view. The allowlist guarantees `key`
      // is never a secret/host field.
      (patch as Record<string, unknown>)[key] = incoming[key]
    }
  }

  return {...current, ...patch}
}

/**
 * Persist a browser-originated settings patch to disk through the browser-safe
 * write allowlist (see `mergeBrowserSafeSettings`). Loads the current on-disk
 * settings (carrying the secrets the browser never sees), merges the allowlisted
 * fields, writes, and returns the browser-safe projection of the saved result so
 * the caller can echo back exactly what the browser is now permitted to observe.
 */
export async function saveBrowserSafeSettings(incoming: Partial<VTSettings>): Promise<VTSettings> {
  const current: VTSettings = await loadSettings()
  const merged: VTSettings = mergeBrowserSafeSettings(current, incoming)
  await saveSettings(merged)
  return projectBrowserSafeSettings(merged)
}
