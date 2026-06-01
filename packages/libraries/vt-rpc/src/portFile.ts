// Read and atomic-write of `<project>/.voicetree/rpc.port`. Plain decimal
// integer + trailing newline. Atomic publish via temp + rename so any reader
// (CLI, renderer, hook subprocess) sees either no file or a fully-written one
// — never a half-written port. Design doc §2.7 / §8.7.

import {mkdir, readFile, rename, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {getProjectDotVoicetreePath} from '@vt/paths'

export const RPC_PORT_FILENAME: string = 'rpc.port'

export function rpcPortFilePath(projectPath: string): string {
    return join(getProjectDotVoicetreePath(resolve(projectPath)), RPC_PORT_FILENAME)
}

export async function writeRpcPortFile(projectPath: string, port: number): Promise<void> {
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`writeRpcPortFile: invalid port ${port}`)
    }
    const finalPath: string = rpcPortFilePath(projectPath)
    const tempPath: string = `${finalPath}.${process.pid}.tmp`
    await mkdir(getProjectDotVoicetreePath(resolve(projectPath)), {recursive: true})
    await writeFile(tempPath, `${port}\n`, 'utf8')
    await rename(tempPath, finalPath)
}

// Returns null when the file is missing or malformed (matches the
// `daemon_unreachable` discipline — CLI surfaces a single transport-layer
// error rather than a different error per parse-failure mode).
export async function readRpcPortFile(projectPath: string): Promise<number | null> {
    try {
        const text: string = await readFile(rpcPortFilePath(projectPath), 'utf8')
        const port: number = Number.parseInt(text.trim(), 10)
        return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null
    } catch {
        return null
    }
}
