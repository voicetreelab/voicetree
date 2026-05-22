/**
 * Renderer-facing accessors for the daemon's HTTP URL and bearer token
 * (Step 9 §2.7). Exposed via mainAPI.getDaemonUrl / mainAPI.getAuthToken.
 * Both throw `daemon_unreachable` when the daemon hasn't published its
 * port/token files yet — eventSubscription treats as transient (§2.9).
 *
 * 9b extends this with the Windows-side `wsl.exe hostname -I` branch (§3.2).
 */
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { getVaultPaths } from '@/shell/edge/main/graph/watch_folder/watchFolder'

async function vaultDir(): Promise<string> {
    const fromEnv: string | undefined = process.env.VOICETREE_VAULT_PATH
    if (fromEnv) return fromEnv
    const vaults: readonly string[] = await getVaultPaths()
    if (!vaults[0]) throw new Error('daemon_unreachable: no vault path')
    return vaults[0]
}

export async function getDaemonUrl(): Promise<string> {
    if (process.env.VOICETREE_DAEMON_URL) return process.env.VOICETREE_DAEMON_URL
    const portFile: string = path.join(await vaultDir(), '.voicetree', 'rpc.port')
    const port: number = Number.parseInt((await fs.readFile(portFile, 'utf-8')).trim(), 10)
    if (!Number.isInteger(port) || port <= 0) throw new Error('daemon_unreachable: invalid rpc.port')
    return `http://127.0.0.1:${port}`
}

export async function getAuthToken(): Promise<string> {
    const tokenFile: string = path.join(await vaultDir(), '.voicetree', 'auth-token')
    const token: string = (await fs.readFile(tokenFile, 'utf-8')).trim()
    if (!token) throw new Error('daemon_unreachable: empty auth-token')
    return token
}
