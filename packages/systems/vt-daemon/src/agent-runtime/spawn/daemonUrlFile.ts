// Read the unified HTTP daemon's port from
// `<project>/.voicetree/rpc.port`. Returns null when the file is missing or
// malformed — callers omit `VOICETREE_DAEMON_URL` from spawn envs in that
// case, and the agent's hook subprocess silently falls back to a no-op
// (curl against an empty URL fails fast under the `|| true` clamp).
//
// Single source of truth for the spawn pipeline. Mirrors the convention
// from `@vt/vt-rpc`'s rpcPortFilePath but lives here to keep agent-runtime
// off vt-rpc as a hard dep (agent-runtime is imported by many tools and
// shouldn't pull in a transport library just for one file read).

import {readFile} from 'node:fs/promises'
import path from 'path'

export async function readDaemonPortFromProject(voicetreeProjectDir: string): Promise<number | null> {
    if (!voicetreeProjectDir) return null
    try {
        const text: string = await readFile(path.join(voicetreeProjectDir, 'rpc.port'), 'utf8')
        const port: number = Number.parseInt(text.trim(), 10)
        return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null
    } catch {
        return null
    }
}
