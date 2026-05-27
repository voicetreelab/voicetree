// Per-process appSupportPath cell. vt-daemon's bin/vtd.ts is the sole
// production writer (boot-time, before any tool handler runs). Tests set
// the value before exercising any code path that calls loadSettings /
// loadProjects / loadConfig.
//
// Replaces @vt/graph-model's deleted `_config` cell, which was a hidden
// per-process singleton invisible to the import graph. Lifting it into a
// process-local module makes the boot-time dependency explicit and
// localises it to the process that actually needs it.

let appSupportPath: string | undefined

export function setAppSupportPath(path: string): void {
    appSupportPath = path
}

export function getAppSupportPath(): string {
    if (appSupportPath === undefined) {
        throw new Error(
            'vt-daemon appSupportPath not set. Call setAppSupportPath() at boot before any tool handler runs.',
        )
    }
    return appSupportPath
}

export function clearAppSupportPathForTest(): void {
    appSupportPath = undefined
}
