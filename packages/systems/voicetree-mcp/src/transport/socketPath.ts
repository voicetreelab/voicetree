// UDS socket-path conventions shared by daemon-side bootstrap (where we
// resolve from a known vault root) and the CLI client (where we walk up from
// cwd). Keeps the convention authoritative in one place — design doc §3.

import {createHash} from 'node:crypto'
import {homedir} from 'node:os'
import {join, resolve} from 'node:path'

export const VOICETREE_DIRNAME: string = '.voicetree'
export const SOCKET_FILENAME: string = 'vt.sock'

export function resolveVaultSocketPath(vaultPath: string): string {
    return join(resolve(vaultPath), VOICETREE_DIRNAME, SOCKET_FILENAME)
}

export function resolveHomeSocketPath(vaultPath: string): string {
    const hash: string = createHash('sha256').update(resolve(vaultPath)).digest('hex').slice(0, 16)
    return join(homedir(), VOICETREE_DIRNAME, `${hash}.sock`)
}
