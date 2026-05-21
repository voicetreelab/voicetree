// Browser-only stub of `@/shell/edge/UI-edge/graph/popups/userEngagementPrompts`.
//
// The real module shows email-collection / feedback dialogs after the user has
// applied N graph deltas. It reads `window.electronAPI.main.loadSettings()`
// and dereferences `settings.userEmail` — both of which crash against the
// playground's electronAPI stub. The playground doesn't need engagement
// prompts.

export function checkEngagementPrompts(): void {}
