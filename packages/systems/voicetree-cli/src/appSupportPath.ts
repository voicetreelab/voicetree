// Resolve the per-process Voicetree application-support directory for the CLI
// process. Mirrors @vt/app-config/app-support-path's resolution so the CLI does
// not need to import any value symbol from @vt/app-config (boundary-budget 0).
// The CLI is an "edge" process: it sets VOICETREE_APP_SUPPORT before spawning
// daemons (so children read the same path via @vt/app-config) and uses the
// resolved path for CLI-local files like cli-telemetry.jsonl.

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

export function resolveAppSupportPath(): string {
    return process.env.VOICETREE_APP_SUPPORT ?? defaultAppSupportPath()
}
