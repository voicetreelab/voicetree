/**
 * Publish the daemon's hook HTTP port to `<vault>/.voicetree/hook.port` so
 * (a) the spawn pipeline reads it back when assembling agent env vars and
 * (b) external diagnostics can discover the port without poking the daemon.
 *
 * Atomic write (temp + rename) so a spawned-agent reader never observes a
 * half-written file. Design doc §3.4.
 */

import {mkdir, rename, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'

const VOICETREE_DIRNAME: string = '.voicetree'
const HOOK_PORT_FILENAME: string = 'hook.port'

export function hookPortFilePath(vaultPath: string): string {
    return join(resolve(vaultPath), VOICETREE_DIRNAME, HOOK_PORT_FILENAME)
}

export async function writeHookPortFile(vaultPath: string, port: number): Promise<void> {
    const finalPath: string = hookPortFilePath(vaultPath)
    const tempPath: string = `${finalPath}.${process.pid}.tmp`
    await mkdir(join(resolve(vaultPath), VOICETREE_DIRNAME), {recursive: true})
    await writeFile(tempPath, `${port}\n`, 'utf8')
    await rename(tempPath, finalPath)
}
