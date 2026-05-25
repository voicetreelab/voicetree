import {execFileSync} from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs'
import {fileURLToPath} from 'node:url'
import {setErrorClass} from '../telemetry/recordCliInvocation'

function findRepoRoot(): string {
    const marker: string = path.join('packages', 'libraries', 'graph-tools', 'bin', 'vt-debug.ts')

    const scriptDir: string = path.dirname(fileURLToPath(import.meta.url))
    let dir: string = scriptDir
    while (dir !== path.dirname(dir)) {
        if (fs.existsSync(path.join(dir, marker))) {
            return dir
        }
        dir = path.dirname(dir)
    }

    dir = process.cwd()
    while (dir !== path.dirname(dir)) {
        if (fs.existsSync(path.join(dir, marker))) {
            return dir
        }
        dir = path.dirname(dir)
    }
    throw new Error('Cannot find repo root (looked for packages/libraries/graph-tools/bin/vt-debug.ts)')
}

export async function runDebugCommand(args: string[]): Promise<void> {
    const repoRoot: string = findRepoRoot()
    const vtDebugBin: string = path.join(repoRoot, 'packages', 'libraries', 'graph-tools', 'bin', 'vt-debug.ts')

    try {
        const result: string = execFileSync(
            process.execPath,
            ['--import', 'tsx', vtDebugBin, ...args],
            {
                cwd: repoRoot,
                stdio: ['inherit', 'pipe', 'pipe'],
                encoding: 'utf8',
                timeout: 60_000,
            },
        )
        if (result) process.stdout.write(result)
    } catch (err: unknown) {
        const execError: { stdout?: string; stderr?: string; status?: number } =
            err as { stdout?: string; stderr?: string; status?: number }
        if (execError.stdout) process.stdout.write(execError.stdout)
        if (execError.stderr) process.stderr.write(execError.stderr)
        setErrorClass(err instanceof Error ? err.name : 'DebugSubprocessExit')
        process.exit(execError.status ?? 1)
    }
}
