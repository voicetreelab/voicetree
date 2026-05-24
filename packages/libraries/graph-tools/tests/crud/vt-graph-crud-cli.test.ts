import {execFileSync} from 'node:child_process'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'

const testDir: string = path.dirname(fileURLToPath(import.meta.url))
const repoRoot: string = path.resolve(testDir, '../../../../..')
const entrypoint = 'packages/libraries/graph-tools/bin/vt-graph.ts'

function runVtGraph(args: readonly string[]): string {
    return execFileSync(
        process.execPath,
        ['--import', 'tsx', entrypoint, ...args],
        {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: 'pipe',
        },
    )
}

function runVtGraphFailure(args: readonly string[]): {readonly status: number; readonly stderr: string} {
    try {
        runVtGraph(args)
    } catch (error) {
        const failed = error as {readonly status?: number; readonly stderr?: string | Buffer}
        return {
            status: failed.status ?? 1,
            stderr: Buffer.isBuffer(failed.stderr)
                ? failed.stderr.toString('utf8')
                : failed.stderr ?? '',
        }
    }

    throw new Error(`Expected vt-graph ${args.join(' ')} to fail`)
}

describe('vt-graph live CRUD CLI', () => {
    it.each([
        ['add-node', ['--file', '--label', '--x', '--y', '--vault']],
        ['rm-node', ['--file', '--vault']],
        ['add-edge', ['--src-file', '--tgt-file', '--label', '--vault']],
        ['rm-edge', ['--src-file', '--tgt-file', '--vault']],
        ['mv-node', ['--file', '--x', '--y', '--vault']],
    ])('prints per-verb help for %s', (verb: string, flags: readonly string[]) => {
        const stdout = runVtGraph(['live', verb, '--help'])

        expect(stdout).toContain(`Usage: vt-graph live ${verb}`)
        expect(stdout).toContain('Returns the resulting Delta as JSON.')
        for (const flag of flags) {
            expect(stdout).toContain(flag)
        }
    })

    it('lists CRUD verbs in live help', () => {
        const stdout = runVtGraph(['live', '--help'])

        expect(stdout).toContain('add-node')
        expect(stdout).toContain('rm-node')
        expect(stdout).toContain('add-edge')
        expect(stdout).toContain('rm-edge')
        expect(stdout).toContain('mv-node')
    })

    it('reports a missing required add-node flag before any daemon round-trip', () => {
        const failure = runVtGraphFailure(['live', 'add-node'])

        expect(failure.status).not.toBe(0)
        expect(failure.stderr).toContain("error: 'add-node' requires --file <file-path>")
    })

    it('reports wrong numeric types before any daemon round-trip', () => {
        const failure = runVtGraphFailure([
            'live',
            'mv-node',
            '--file',
            'f.md',
            '--x',
            'notanumber',
            '--y',
            '0',
        ])

        expect(failure.status).not.toBe(0)
        expect(failure.stderr).toContain('--x')
        expect(failure.stderr).toContain('number')
        expect(failure.stderr).toContain("got 'notanumber'")
    })

    it('reports unknown flags and lists valid flags before any daemon round-trip', () => {
        const failure = runVtGraphFailure([
            'live',
            'add-node',
            '--file',
            'f.md',
            '--bogus',
            '1',
        ])

        expect(failure.status).not.toBe(0)
        expect(failure.stderr).toContain("error: unknown flag --bogus for 'add-node'")
        expect(failure.stderr).toContain('Valid flags:')
        expect(failure.stderr).toContain('--file')
    })
})
