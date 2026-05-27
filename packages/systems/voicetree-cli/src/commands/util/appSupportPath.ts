import {homedir} from 'node:os'
import {join} from 'node:path'

/**
 * Resolve the platform-default Voicetree application-support directory used
 * as the fallback for `$VOICETREE_APP_SUPPORT`. Mirrored from @vt/app-config's
 * resolveAppSupportPath so voicetree-cli can stay free of app-config value
 * imports (cross-package-coupling budget = 0). The two copies must stay in
 * sync: both return $VOICETREE_APP_SUPPORT when set, otherwise the same
 * platform default.
 */
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

export function resolveAppSupportPath(): string {
    return process.env.VOICETREE_APP_SUPPORT ?? defaultAppSupportPath()
}
