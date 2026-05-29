// BF-382 · Phase 3 — atomic publication of `<vault>/.voicetree/otlp.port`.
//
// Mirrors the RPC port-file shape (`packages/libraries/vt-rpc/src/portFile.ts`).
// The OTLP HTTP receiver may bind anywhere in the 4318–4327 window (matching
// the legacy `OTLP_BASE_PORT` retry contract), so the actual port can vary
// across processes / restarts; agents and CLI peers discover it by reading
// this file. Atomic publish via temp + rename so readers see either no file
// or a fully-written one — never a half-written port.
//
// Phase 1's `bin/vtd.ts` (BF-371) is not on this leaf's baseline. The future
// `@vt/vt-daemon-client.getOtlpEndpoint(vault)` becomes a thin wrapper around
// `readOtlpPortFile(vault)` at that point.

import {mkdir, readFile, rename, unlink, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'

import {getProjectDotVoicetreePath} from '@vt/paths'

export const OTLP_PORT_FILENAME: string = 'otlp.port'

export function otlpPortFilePath(vaultPath: string): string {
    return join(getProjectDotVoicetreePath(resolve(vaultPath)), OTLP_PORT_FILENAME)
}

export async function writeOtlpPortFile(vaultPath: string, port: number): Promise<void> {
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`writeOtlpPortFile: invalid port ${port}`)
    }
    const finalPath: string = otlpPortFilePath(vaultPath)
    const tempPath: string = `${finalPath}.${process.pid}.tmp`
    await mkdir(getProjectDotVoicetreePath(resolve(vaultPath)), {recursive: true})
    await writeFile(tempPath, `${port}\n`, 'utf8')
    await rename(tempPath, finalPath)
}

// Returns null when the file is missing or malformed. Mirrors the rpc port
// discipline — callers should treat absence as "no daemon at this vault" and
// surface a single transport-layer error rather than a parse-failure variant.
export async function readOtlpPortFile(vaultPath: string): Promise<number | null> {
    try {
        const text: string = await readFile(otlpPortFilePath(vaultPath), 'utf8')
        const port: number = Number.parseInt(text.trim(), 10)
        return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null
    } catch {
        return null
    }
}

// Best-effort cleanup on shutdown. The file is a discovery hint, not a lock;
// ENOENT (already removed by a previous shutdown) is non-fatal.
export async function removeOtlpPortFile(vaultPath: string): Promise<void> {
    try {
        await unlink(otlpPortFilePath(vaultPath))
    } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    }
}
