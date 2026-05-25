import {homedir} from 'node:os'
import {join} from 'node:path'

/**
 * Resolve the platform-default Voicetree application-support directory used
 * as the fallback for `$VOICETREE_APP_SUPPORT`. Extracted out of `serve.ts`
 * so both `runServeCommand` and the telemetry sink installer can share a
 * single source of truth for this path.
 */
export function defaultAppSupportPath(): string {
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
