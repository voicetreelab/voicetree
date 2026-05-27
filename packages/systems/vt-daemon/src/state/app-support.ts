// Compatibility shim. The per-process appSupportPath cell that used to
// live here has been removed — every caller resolves the path on demand
// from $VOICETREE_APP_SUPPORT (the single source of truth, set at boot
// by whichever process launched vt-daemon).
//
// `getAppSupportPath` mirrors `@vt/app-config`'s `resolveAppSupportPath`
// rather than re-exporting it; the local copy keeps the vt-daemon →
// app-config cross-package-coupling edge at 1 value symbol (just
// `loadSettings`). The two copies must stay in sync — both return
// $VOICETREE_APP_SUPPORT when set, otherwise the same OS-platform
// default. Any new direct caller in vt-daemon should reach into the
// app-support resolution through this shim.

import {homedir} from 'node:os'
import {join} from 'node:path'

function defaultAppSupportPath(): string {
    if (process.platform === 'darwin') {
        return join(homedir(), 'Library', 'Application Support', 'Voicetree')
    }

    if (process.platform === 'win32') {
        return join(
            process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
            'Voicetree',
        )
    }

    return join(
        process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
        'Voicetree',
    )
}

export function getAppSupportPath(): string {
    return process.env.VOICETREE_APP_SUPPORT ?? defaultAppSupportPath()
}

export function setAppSupportPath(path: string): void {
    process.env.VOICETREE_APP_SUPPORT = path
}

export function clearAppSupportPathForTest(): void {
    delete process.env.VOICETREE_APP_SUPPORT
}
