// Regression test for the silent-no-op bug where `vt --help` exits 0 with no
// output when the CLI entry file is loaded through a symlink.
//
// Root cause was a string comparison in `isDirectExecution()` between
// `import.meta.url` (resolved real path) and `pathToFileURL(process.argv[1])`
// (symlinked path verbatim). When Node loads the script through a symlink,
// the two strings differ and the `if (isDirectExecution()) void main()` guard
// silently skips execution.
//
// In this monorepo, `node_modules/@voicetree/cli` is a workspace symlink to
// `packages/systems/voicetree-cli`, so every `vt` invocation through
// `node_modules/.bin/vt` triggers the bug.
//
// This test directly invokes `node` against a symlink to the CLI entry, which
// is the minimum reproduction. It deliberately bypasses the bash wrapper so
// the regression surface is the TypeScript guard alone.

import {spawn, type ChildProcess} from 'node:child_process'
import {mkdtemp, rm, symlink} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

const TEST_FILE_DIR: string = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR: string = resolve(TEST_FILE_DIR, '..')
const SOURCE_ENTRY: string = join(PACKAGE_DIR, 'src', 'voicetree-cli.ts')
const TSX_REQUIRE: NodeJS.Require = createRequire(import.meta.url)
const TSX_PACKAGE_DIR: string = dirname(TSX_REQUIRE.resolve('tsx/package.json'))
const TSX_CLI_PATH: string = join(TSX_PACKAGE_DIR, 'dist', 'cli.mjs')
const TSCONFIG_PATH: string = join(PACKAGE_DIR, 'tsconfig.json')

const TIMEOUT_MS: number = 20_000

type SpawnResult = {
    code: number | null
    stdout: string
    stderr: string
}

function runNode(scriptPath: string, args: string[]): Promise<SpawnResult> {
    return new Promise<SpawnResult>((resolvePromise, rejectPromise) => {
        const childEnv: Record<string, string | undefined> = {...process.env}
        delete childEnv.VT_SESSION
        delete childEnv.VOICETREE_TERMINAL_ID
        childEnv.TSX_TSCONFIG_PATH = TSCONFIG_PATH
        const env: Record<string, string> = {}
        for (const [key, value] of Object.entries(childEnv)) {
            if (value !== undefined) env[key] = value
        }

        const child: ChildProcess = spawn(
            process.execPath,
            [TSX_CLI_PATH, scriptPath, ...args],
            {env, stdio: ['ignore', 'pipe', 'pipe']},
        )
        const stdoutChunks: Buffer[] = []
        const stderrChunks: Buffer[] = []

        child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
        child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

        const timer: NodeJS.Timeout = setTimeout(() => {
            child.kill('SIGKILL')
            rejectPromise(new Error(`node ${scriptPath} ${args.join(' ')} timed out after ${TIMEOUT_MS}ms`))
        }, TIMEOUT_MS)

        child.on('error', (err: Error) => {
            clearTimeout(timer)
            rejectPromise(err)
        })
        child.on('close', (code: number | null) => {
            clearTimeout(timer)
            resolvePromise({
                code,
                stdout: Buffer.concat(stdoutChunks).toString('utf8'),
                stderr: Buffer.concat(stderrChunks).toString('utf8'),
            })
        })
    })
}

describe('vt CLI symlink invocation (regression for isDirectExecution string-compare bug)', () => {
    let scratchDir: string

    beforeEach(async () => {
        scratchDir = await mkdtemp(join(tmpdir(), 'vt-symlink-'))
    })

    afterEach(async () => {
        await rm(scratchDir, {recursive: true, force: true})
    })

    it('prints help when the entry file is loaded through a symlink', async () => {
        const linkPath: string = join(scratchDir, 'voicetree-cli.ts')
        await symlink(SOURCE_ENTRY, linkPath)

        const result: SpawnResult = await runNode(linkPath, ['--help'])

        // Pre-fix: this would silently exit 0 with empty stdout. The help text
        // assertion is the load-bearing check; the exit code is a sanity backup.
        expect(result.stdout, `expected help text, got stderr: ${result.stderr}`)
            .toContain('Usage: vt')
        expect(result.stdout).toContain('graph')
        expect(result.code).toBe(0)
    })
})
