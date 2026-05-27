import {execFileSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'
import {setErrorClass} from '../cliDeps'

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

const LIVE_PATH_FLAGS: readonly string[] = ['--file', '--src-file', '--tgt-file']

function isLivePathFlag(flag: string): boolean {
    return LIVE_PATH_FLAGS.includes(flag)
}

function normalizePathFlagValue(flag: string, value: string, cwd: string): string {
    return `${flag}=${path.resolve(cwd, value)}`
}

function normalizeLivePathArgs(args: readonly string[], cwd: string): string[] {
    const normalized: string[] = []

    for (let i = 0; i < args.length; i++) {
        const arg: string = args[i] ?? ''
        const equalsIndex: number = arg.indexOf('=')
        if (equalsIndex !== -1) {
            const flag: string = arg.slice(0, equalsIndex)
            if (isLivePathFlag(flag)) {
                normalized.push(normalizePathFlagValue(flag, arg.slice(equalsIndex + 1), cwd))
                continue
            }
        }

        if (isLivePathFlag(arg)) {
            const value: string | undefined = args[i + 1]
            if (value !== undefined && !value.startsWith('--')) {
                normalized.push(arg, path.resolve(cwd, value))
                i++
                continue
            }
        }

        normalized.push(arg)
    }

    return normalized
}

function formatVtGraphOutput(output: string): string {
    return output.replaceAll('vt-graph live', 'vt graph live')
}

export async function graphLive(_terminalId: string | undefined, args: string[]): Promise<void> {
    const repoRoot: string = findRepoRoot()
    const vtGraphBin: string = path.join(repoRoot, 'packages', 'libraries', 'graph-tools', 'bin', 'vt-graph.ts')
    const forwardedArgs: readonly string[] = normalizeLivePathArgs(args, process.cwd())

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
        setErrorClass(err instanceof Error ? err.name : 'GraphLiveSubprocessExit')
        process.exit(execError.status ?? 1)
    }
}
