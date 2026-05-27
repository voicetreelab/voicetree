// Compatibility shim. The per-process appSupportPath cell that used to
// live here has been removed — every caller resolves the path on demand
// from $VOICETREE_APP_SUPPORT (the single source of truth, set at boot
// by whichever process launched graph-db-server).
//
// `getAppSupportPath` mirrors `@vt/app-config`'s `resolveAppSupportPath`
// rather than re-exporting it; the local copy avoids adding
// `resolveAppSupportPath` as a value symbol on the
// graph-db-server → app-config cross-package-coupling edge. The two
// copies must stay in sync — both return $VOICETREE_APP_SUPPORT when
// set, otherwise the same OS-platform default.

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
