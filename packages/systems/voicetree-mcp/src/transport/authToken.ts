// Generate a fresh bearer token at daemon startup, write it atomically to
// `<vault>/.voicetree/auth-token` with mode 0600. Filesystem permissions are
// the trust root (design doc §2.4). Daemon-restart invalidates — there's no
// rotation endpoint and no persistence across restarts (§2.8).

import {randomBytes} from 'node:crypto'
import {chmod, mkdir, rename, writeFile} from 'node:fs/promises'
import {dirname} from 'node:path'

import {authTokenFilePath, redactToken} from '@vt/vt-rpc'

const TOKEN_BYTE_LENGTH: number = 32
const TOKEN_FILE_MODE: number = 0o600

export function generateAuthToken(): string {
    return randomBytes(TOKEN_BYTE_LENGTH).toString('hex')
}

export async function writeAuthTokenFile(vaultPath: string, token: string): Promise<void> {
    if (token.length === 0) {
        throw new Error('writeAuthTokenFile: refusing to write empty token')
    }
    const finalPath: string = authTokenFilePath(vaultPath)
    const tempPath: string = `${finalPath}.${process.pid}.tmp`
    await mkdir(dirname(finalPath), {recursive: true})
    await writeFile(tempPath, `${token}\n`, {encoding: 'utf8', mode: TOKEN_FILE_MODE})
    // Re-chmod in case the umask masked off bits (writeFile honors the mode
    // arg only on create, and may be subject to process umask).
    await chmod(tempPath, TOKEN_FILE_MODE)
    await rename(tempPath, finalPath)
    await chmod(finalPath, TOKEN_FILE_MODE)
}

export {redactToken}
