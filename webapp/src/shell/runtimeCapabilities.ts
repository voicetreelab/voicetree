// Runtime capability flags — the single source of truth for which native-only
// operations the current host runtime can perform.
//
// Electron can do everything (real OS dialogs, git worktrees, clipboard image
// I/O, settings persistence). The browser adapter talks only to VTD over HTTP
// and can do none of those. The UI gates native-only controls on these flags AT
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
}

export const ELECTRON_CAPABILITIES: RuntimeCapabilities = {
    nativeFolderPicker: true,
    worktrees: true,
    clipboardImages: true,
    settingsPersistence: true,
}

export const BROWSER_CAPABILITIES: RuntimeCapabilities = {
    nativeFolderPicker: false,
    worktrees: false,
    clipboardImages: false,
    settingsPersistence: false,
}

/**
 * Read the host runtime's capabilities. Defaults to the full Electron set when
 * the host adapter is absent — safe because `installBrowserRuntimeIfNeeded()`
 * runs before React renders, so by paint `capabilities` is always set; the
 * default only covers Electron and unit tests that never install an adapter.
 */
export function hostCapabilities(): RuntimeCapabilities {
    return window.electronAPI?.capabilities ?? ELECTRON_CAPABILITIES
}
