import {homedir} from 'node:os'
import {join} from 'node:path'

export function resolveAppSupportPath(): string {
    return process.env.VOICETREE_APP_SUPPORT ?? join(homedir(), '.voicetree')
}
