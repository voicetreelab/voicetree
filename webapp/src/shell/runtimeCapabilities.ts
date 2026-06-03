// Runtime capability flags — the single source of truth for which native-only
// operations the current host runtime can perform.
//
// Electron can do everything (real OS dialogs, git worktrees, clipboard image
// I/O, settings persistence). The browser adapter talks only to VTD over HTTP;
// it can do those operations VTD exposes a gateway for (e.g. git worktrees) and
// none of the rest. The UI gates native-only controls on these flags AT
// THE CONTROL (hides the button / omits the menu item) rather than letting a
// click reach an operation that throws — the adapter's loud `unsupported()`
// throwers remain only as a defence-in-depth backstop.
//
// This module is pure data + one thin reader. No drift: each adapter returns the
// matching record and the booleans live here, never duplicated at a call site.

export interface RuntimeCapabilities {
    /** Native folder dialogs: showFolderPicker, createNewProject, browse-external. */
    readonly nativeFolderPicker: boolean
    /** Git worktrees: createWorktree, removeWorktree, worktree menu/spawn UI. */
    readonly worktrees: boolean
    /** Clipboard image I/O: saveClipboardImage, readImageAsDataUrl, paste-image. */
    readonly clipboardImages: boolean
    /** Persisting edited settings back to disk: saveSettings. */
    readonly settingsPersistence: boolean
    /**
     * Switching the active project at runtime: the project-selection screen and
     * its "← Back to projects" entry. Native only — browser-mode VTD is launched
     * per-project (`vt webapp --project X`) and the browser talks to exactly one
     * daemon it cannot replace, so switching is a launcher concern.
     */
    readonly projectSwitching: boolean
    /**
     * Usage/observability panel: token-JSONL scraping, headless `claude /usage`
     * PTY scrape, and the native-terminal "open in Claude/Codex" shortcuts
     * (getUsageData / refreshClaudeUsageHeadless / openClaudeUsage /
     * openCodexStatus). Desktop-only; the browser hides the UsageSection.
     */
    readonly usageObservability: boolean
    /**
     * Deep-link to the OS microphone-permission settings pane
     * (openMicrophoneSettings). Native only — a browser grants mic access via
     * getUserMedia + its own site-settings UI, which pages cannot open
     * programmatically, so the "Open System Settings" affordance is hidden.
     */
    readonly nativeMicrophoneSettings: boolean
    /**
     * Ask-mode (askQuery / askModeCreateAndSpawn): semantic-search the graph for
     * a question then create a context node and spawn an agent on it. Native
     * only for now — the semantic backend (text-to-tree server) is not reachable
     * from the browser and there is no VTD createContextNodeFromQuestion+spawn
     * route yet, so the browser hides the Ask toggle rather than silently no-op.
     */
    readonly askMode: boolean
}

export const ELECTRON_CAPABILITIES: RuntimeCapabilities = {
    nativeFolderPicker: true,
    worktrees: true,
    clipboardImages: true,
    settingsPersistence: true,
    projectSwitching: true,
    usageObservability: true,
    nativeMicrophoneSettings: true,
    askMode: true,
}

export const BROWSER_CAPABILITIES: RuntimeCapabilities = {
    nativeFolderPicker: false,
    // VTD owns the git plumbing and exposes the `worktree.*` gateway RPCs, so
    // the browser can create/list/remove worktrees via the daemon.
    worktrees: true,
    // VTD owns the filesystem and exposes /clipboard-image + /image, so the
    // browser reads the clipboard (Clipboard API) and persists via the daemon.
    clipboardImages: true,
    settingsPersistence: false,
    projectSwitching: false,
    usageObservability: false,
    nativeMicrophoneSettings: false,
    askMode: false,
}

/**
 * Read the host runtime's capabilities. Defaults to the full Electron set when
 * the host adapter is absent — safe because `installBrowserRuntimeIfNeeded()`
 * runs before React renders, so by paint `capabilities` is always set; the
 * default only covers Electron and unit tests that never install an adapter.
 */
export function hostCapabilities(): RuntimeCapabilities {
    return window.hostAPI?.capabilities ?? ELECTRON_CAPABILITIES
}
