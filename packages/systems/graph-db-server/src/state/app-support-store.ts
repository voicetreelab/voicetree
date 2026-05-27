// Per-process appSupportPath cell for vt-graphd. Set once at boot by
// startDaemon.ts after resolveDaemonAppSupportPath; read by every leaf
// that touches @vt/app-config (loadSettings, loadConfig, project-store).
//
// Replaces @vt/graph-model's deleted `_config` cell. Lifting the cell
// into a process-local module makes the boot-time dependency explicit
// and prevents the dual-state failure mode (one cell per process, no
// cross-process aliasing possible).

let appSupportPath: string | undefined

export function setAppSupportPath(path: string): void {
    appSupportPath = path
}

export function getAppSupportPath(): string {
    if (appSupportPath === undefined) {
        throw new Error(
            'vt-graphd appSupportPath not set. Call setAppSupportPath() at boot before any RPC handler runs.',
        )
    }
    return appSupportPath
}

export function clearAppSupportPathForTest(): void {
    appSupportPath = undefined
}
