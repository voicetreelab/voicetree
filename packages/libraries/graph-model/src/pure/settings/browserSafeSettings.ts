import type {VTSettings} from './types'

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
