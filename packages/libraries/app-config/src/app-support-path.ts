import {homedir} from 'node:os'
import {join} from 'node:path'

// Platform-default Voicetree application-support directory. Used as the
// fallback when $VOICETREE_APP_SUPPORT is unset.
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

// Resolve the per-process Voicetree application-support directory. Reads
// $VOICETREE_APP_SUPPORT on every call so there is no module-level cache —
// the env var is the single source of truth, set once at boot by the
// launching process (CLI / Electron) and inherited by all children.
export function resolveAppSupportPath(): string {
    return process.env.VOICETREE_APP_SUPPORT ?? defaultAppSupportPath()
}
