import * as path from 'node:path'
import * as os from 'node:os'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

export const PROJECT_ROOT = path.resolve(process.cwd())

function canLoadNativeGraphDbModules(nodeBin: string): boolean {
    try {
        execFileSync(nodeBin, ['-e', "const { DatabaseSync } = require('node:sqlite'); new DatabaseSync(':memory:').close()"], {
            cwd: path.resolve(PROJECT_ROOT, '..'),
            stdio: 'ignore',
        })
        return true
    } catch {
        return false
    }
}

export function resolveGraphDaemonNodeBin(): string {
    const nvmNodeBin = path.join(os.homedir(), '.nvm', 'versions', 'node', 'v22.20.0', 'bin', 'node')
    const candidates = [
        process.env.VT_GRAPHD_NODE_BIN,
        process.env.npm_node_execpath,
        process.execPath,
        existsSync(nvmNodeBin) ? nvmNodeBin : undefined,
        'node',
    ].filter((c): c is string => Boolean(c))
    return candidates.find(canLoadNativeGraphDbModules) ?? process.execPath
}
