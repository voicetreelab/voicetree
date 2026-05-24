// Tier-1 CLI smoke test (teammate's request).
//
// Catches the "vt CLI broken at the wrapper level" class of regression at the
// cheapest possible cost. Spawns the real package `bin/vt` script as a child
// process — no Electron, no playwright, no MCP daemon roundtrip. Three
// scenarios that exercise the layers most likely to break:
//
//   1. `vt --help`: proves the wrapper loads tsx, resolves package-local imports
//      via the pinned tsconfig, and the dispatcher renders help without crashing.
//      Catches the BF-223 / Directory Fanout regression class.
//
//   2. `vt graph create file.md` (filesystem mode, no folder note): proves the
//      authoring path writes a markdown file when no schema gate applies.
//      Catches regressions in the FS-native authoring rails.
//
//   3. `vt graph create file.md` with an upstream `## Type:` folder note and a
//      `.voicetree/schemas.cjs` plugin: proves the schema gate runs and either
//      writes (valid body) or rejects with structured stderr JSON (invalid
//      body). Catches regressions in the folder-note walk-up, plugin loader,
//      and gate-into-action wiring shipped in Phase 1.

import {spawn, type ChildProcess} from 'node:child_process'
import {access, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

const TEST_FILE_DIR: string = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR: string = resolve(TEST_FILE_DIR, '..')
const VT_BIN: string = join(PACKAGE_DIR, 'bin', 'vt')

const SMOKE_TIMEOUT_MS: number = 20_000

type SpawnResult = {
    code: number | null
    stdout: string
    stderr: string
}

function runVt(args: string[], cwd: string): Promise<SpawnResult> {
    return new Promise<SpawnResult>((resolvePromise, rejectPromise) => {
        // Strip session/terminal env vars so the spawned CLI starts clean. The
        // real `vt` wrapper inherits the rest of process.env.
        const childEnv: Record<string, string | undefined> = {...process.env}
        delete childEnv.VT_SESSION
        delete childEnv.VOICETREE_TERMINAL_ID
        // Force source-mode dispatch so the test exercises the live tsx path
        // rather than any locally built bundle in `dist/voicetree-cli.js`.
        childEnv.VT_FORCE_SOURCE = '1'
        const env: Record<string, string> = {}
        for (const [key, value] of Object.entries(childEnv)) {
            if (value !== undefined) env[key] = value
        }

        const child: ChildProcess = spawn(VT_BIN, args, {cwd, env, stdio: ['ignore', 'pipe', 'pipe']})
        const stdoutChunks: Buffer[] = []
        const stderrChunks: Buffer[] = []

        child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
        child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

        const timer: NodeJS.Timeout = setTimeout(() => {
            child.kill('SIGKILL')
            rejectPromise(new Error(`vt ${args.join(' ')} timed out after ${SMOKE_TIMEOUT_MS}ms`))
        }, SMOKE_TIMEOUT_MS)

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

describe('vt CLI smoke (Tier 1)', () => {
    let vaultRoot: string

    beforeEach(async () => {
        vaultRoot = await mkdtemp(join(tmpdir(), 'vt-smoke-'))
    })

    afterEach(async () => {
        await rm(vaultRoot, {recursive: true, force: true})
    })

    it('loads and prints help from outside the package directory', async () => {
        // Run from /tmp to prove the tsconfig pinning fix works: tsx
        // auto-discovers tsconfig from CWD, which would otherwise be a vault
        // dir. The vt wrapper pins TSX_TSCONFIG_PATH so module resolution stays
        // consistent regardless of CWD.
        const result: SpawnResult = await runVt(['--help'], tmpdir())

        expect(result.code).toBe(0)
        expect(result.stdout).toContain('Usage: vt')
        expect(result.stdout).toContain('graph')
        // Critical: no ERR_MODULE_NOT_FOUND. That's the regression class this
        // test exists to catch.
        expect(result.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND/)
        expect(result.stderr).not.toMatch(/Cannot find package/)
    })

    it('creates a markdown file in filesystem mode when no schema gate applies', async () => {
        const targetPath: string = join(vaultRoot, 'note.md')
        await writeFile(targetPath, '# Topic\n\nFree-form body, no folder note upstream.\n', 'utf8')

        const result: SpawnResult = await runVt(['graph', 'create', 'note.md'], vaultRoot)

        expect(result.code).toBe(0)
        // File still exists (and is non-empty) after the create call.
        await expect(access(targetPath)).resolves.toBeUndefined()
        const onDisk: string = await readFile(targetPath, 'utf8')
        expect(onDisk).toContain('# Topic')
    })

    it('rejects a schema-gated invalid body with structured stderr JSON and exit 1', async () => {
        // Set up the folder note + schema plugin so the gate fires.
        const workDir: string = join(vaultRoot, 'work')
        await mkdir(workDir, {recursive: true})
        await writeFile(
            join(workDir, 'work.md'),
            '# Work\n\n## Type: my-kind\n\nfolder note body\n',
            'utf8'
        )
        await mkdir(join(vaultRoot, '.voicetree'), {recursive: true})
        await writeFile(
            join(vaultRoot, '.voicetree', 'schemas.cjs'),
            `module.exports = {
                'my-kind': {
                    validate(body) {
                        if (body.includes('Needed marker')) return []
                        return [{
                            ruleId: 'body.missing_needed_marker',
                            message: "body must include 'Needed marker'",
                            severity: 'error',
                        }]
                    }
                }
            }`,
            'utf8'
        )

        const targetPath: string = join(workDir, 'topic.md')
        const originalBody: string = '# Topic\n\nthis body lacks the marker\n'
        await writeFile(targetPath, originalBody, 'utf8')

        const result: SpawnResult = await runVt(['graph', 'create', 'work/topic.md'], vaultRoot)

        expect(result.code).toBe(1)
        // The stderr should contain the batch-report JSON envelope, possibly
        // with other diagnostic chatter around it. Find the JSON object.
        const jsonMatch: RegExpMatchArray | null = result.stderr.match(/\{[\s\S]*\}/)
        expect(jsonMatch, `expected JSON envelope in stderr, got: ${result.stderr}`).not.toBeNull()
        const payload: unknown = JSON.parse((jsonMatch as RegExpMatchArray)[0])
        expect(payload).toMatchObject({
            kind: 'graph_create_batch_result',
            nodes: [
                {
                    path: 'work/topic.md',
                    status: 'rejected',
                    typeName: 'my-kind',
                    ruleIds: ['body.missing_needed_marker'],
                },
            ],
            summary: {ok: 0, rejected: 1, skipped: 0, warning: 0},
        })
        // The file on disk must NOT have been touched by the rejected write.
        const onDisk: string = await readFile(targetPath, 'utf8')
        expect(onDisk).toBe(originalBody)
    })

    it('reports per-node verdicts for a 2-node batch (one valid, one invalid) and exits 1', async () => {
        // Step 5 acceptance: gate-all must evaluate BOTH nodes (no first-fail
        // cascade) and the batch report must surface both verdicts.
        const workDir: string = join(vaultRoot, 'work')
        await mkdir(workDir, {recursive: true})
        await writeFile(
            join(workDir, 'work.md'),
            '# Work\n\n## Type: my-kind\n\nfolder note body\n',
            'utf8'
        )
        await mkdir(join(vaultRoot, '.voicetree'), {recursive: true})
        await writeFile(
            join(vaultRoot, '.voicetree', 'schemas.cjs'),
            `module.exports = {
                'my-kind': {
                    validate(body) {
                        if (body.includes('Needed marker')) return []
                        return [{
                            ruleId: 'body.missing_needed_marker',
                            message: 'missing marker',
                            severity: 'error',
                        }]
                    }
                }
            }`,
            'utf8'
        )

        const goodPath: string = join(workDir, 'a.md')
        const badPath: string = join(workDir, 'b.md')
        const badOriginalBody: string = '# B\n\nno marker here\n'
        await writeFile(goodPath, '# A\n\nNeeded marker present.\n', 'utf8')
        await writeFile(badPath, badOriginalBody, 'utf8')

        const result: SpawnResult = await runVt(
            ['graph', 'create', 'work/a.md', 'work/b.md'],
            vaultRoot,
        )

        expect(result.code).toBe(1)
        const jsonMatch: RegExpMatchArray | null = result.stderr.match(/\{[\s\S]*\}/)
        expect(jsonMatch, `expected batch envelope in stderr, got: ${result.stderr}`).not.toBeNull()
        const payload: unknown = JSON.parse((jsonMatch as RegExpMatchArray)[0])
        expect(payload).toMatchObject({
            kind: 'graph_create_batch_result',
            nodes: [
                {path: 'work/a.md', status: 'ok'},
                {path: 'work/b.md', status: 'rejected', ruleIds: ['body.missing_needed_marker']},
            ],
            summary: {ok: 1, rejected: 1, skipped: 0, warning: 0},
        })
        // The rejected file on disk must NOT have been touched.
        const onDisk: string = await readFile(badPath, 'utf8')
        expect(onDisk).toBe(badOriginalBody)
    })

    it('accepts a schema-gated valid body and writes the file', async () => {
        const workDir: string = join(vaultRoot, 'work')
        await mkdir(workDir, {recursive: true})
        await writeFile(
            join(workDir, 'work.md'),
            '# Work\n\n## Type: my-kind\n\nfolder note body\n',
            'utf8'
        )
        await mkdir(join(vaultRoot, '.voicetree'), {recursive: true})
        await writeFile(
            join(vaultRoot, '.voicetree', 'schemas.cjs'),
            `module.exports = {
                'my-kind': {
                    validate(body) {
                        return body.includes('Needed marker')
                            ? []
                            : [{ruleId: 'body.missing_needed_marker', message: 'missing', severity: 'error'}]
                    }
                }
            }`,
            'utf8'
        )

        const targetPath: string = join(workDir, 'topic.md')
        await writeFile(targetPath, '# Topic\n\nbody with Needed marker present.\n', 'utf8')

        const result: SpawnResult = await runVt(['graph', 'create', 'work/topic.md'], vaultRoot)

        expect(result.code).toBe(0)
        expect(result.stderr).toBe('')
        await expect(access(targetPath)).resolves.toBeUndefined()
    })
})
