import {execFileSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'

function findRepoRoot(): string {
    const marker: string = path.join('packages', 'libraries', 'graph-tools', 'bin', 'vt-graph.ts')
    const scriptDir: string = path.dirname(fileURLToPath(import.meta.url))

    for (const startDir of [scriptDir, process.cwd()]) {
        let dir: string = startDir
        while (dir !== path.dirname(dir)) {
            if (fs.existsSync(path.join(dir, marker))) {
                return dir
            }
            dir = path.dirname(dir)
        }
    }

    throw new Error('Cannot find repo root (looked for packages/libraries/graph-tools/bin/vt-graph.ts)')
}

function hasPortFlag(args: readonly string[]): boolean {
    return args.some((arg: string) => arg === '--port' || arg.startsWith('--port='))
}

function formatVtGraphOutput(output: string): string {
    return output.replaceAll('vt-graph live', 'vt graph live')
}

export async function graphLive(port: number, _terminalId: string | undefined, args: string[]): Promise<void> {
    const repoRoot: string = findRepoRoot()
    const vtGraphBin: string = path.join(repoRoot, 'packages', 'libraries', 'graph-tools', 'bin', 'vt-graph.ts')
    const forwardedArgs: readonly string[] = hasPortFlag(args) ? args : [...args, '--port', String(port)]

    try {
        const result: string = execFileSync(
            process.execPath,
            ['--import', 'tsx', vtGraphBin, 'live', ...forwardedArgs],
            {
                cwd: repoRoot,
                stdio: ['inherit', 'pipe', 'pipe'],
                encoding: 'utf8',
                timeout: 60_000,
            },
        )
        if (result) process.stdout.write(formatVtGraphOutput(result))
    } catch (err: unknown) {
        const execError: {stdout?: string; stderr?: string; status?: number} =
            err as {stdout?: string; stderr?: string; status?: number}
        if (execError.stdout) process.stdout.write(formatVtGraphOutput(execError.stdout))
        if (execError.stderr) process.stderr.write(formatVtGraphOutput(execError.stderr))
        process.exit(execError.status ?? 1)
    }
}
