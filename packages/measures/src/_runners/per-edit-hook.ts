#!/usr/bin/env node
// PostToolUse agent-hook runner. Reads the tool envelope from stdin,
// reads the just-edited file, runs every pure measure under
// checks/tier_0_post_edit/, prints any violations to stderr, exits 2 if
// any measure violated (blocks the agent so it must refactor).
//
// All I/O lives here (the runner edge); the measures themselves are
// pure transforms of {filePath, content, env} → violation | null. The
// `env` argument (FP pattern 3, Reader-env) holds the impure capabilities
// each measure may need — fs / path / git — so measure files declare a
// narrow env shape in their own signature (structural typing) and never
// import fs/path/child_process themselves. The impurity boundary stays
// in this file.
//
// Invoked by .claude/hooks/run-per-edit.cjs and (via symlink)
// .codex/hooks/run-per-edit.cjs.

import {execFileSync} from 'node:child_process'
import {readFile, readdir} from 'node:fs/promises'
import {basename as pathBasename, dirname, extname, join, resolve as pathResolve} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

type ToolEnvelope = {
    readonly tool_input?: {
        readonly file_path?: string
        readonly absolutePath?: string
        readonly notebook_path?: string
    }
}

type PerEditEnv = {
    readonly readFile: (absPath: string) => Promise<string | null>
    readonly basename: (absPath: string) => string
    readonly resolve: (...parts: readonly string[]) => string
    readonly gitToplevel: () => string | null
    readonly gitHeadSha: () => string | null
    readonly gitFileAtHead: (absOrRelPath: string) => string | null
}

type PerEditMeasure = (args: {
    readonly filePath: string
    readonly content: string
    readonly env: PerEditEnv
}) =>
    | {readonly message: string; readonly severity?: 'block' | 'warn'}
    | null
    | Promise<{readonly message: string; readonly severity?: 'block' | 'warn'} | null>

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const MEASURE_DIR = pathResolve(SCRIPT_DIR, '..', 'checks', 'tier_0_post_edit')

function runGitOrNull(args: readonly string[]): string | null {
    try {
        return execFileSync('git', [...args], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        })
    } catch {
        return null
    }
}

function buildEnv(): PerEditEnv {
    return {
        readFile: (absPath) => readFile(absPath, 'utf8').then(c => c as string | null).catch(() => null),
        basename: (absPath) => pathBasename(absPath),
        resolve: (...parts) => pathResolve(...parts),
        gitToplevel: () => runGitOrNull(['rev-parse', '--show-toplevel'])?.trim() ?? null,
        gitHeadSha: () => runGitOrNull(['rev-parse', 'HEAD'])?.trim() ?? null,
        gitFileAtHead: (filePath) => {
            const relPath = runGitOrNull(['ls-files', '--full-name', '--', filePath])?.trim()
            if (relPath === null || relPath === undefined || relPath.length === 0) return null
            return runGitOrNull(['show', `HEAD:${relPath}`])
        },
    }
}

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks).toString('utf8')
}

function pathFromEnvelope(envelope: ToolEnvelope): string | null {
    const input = envelope.tool_input
    if (!input) return null
    return input.file_path ?? input.absolutePath ?? input.notebook_path ?? null
}

async function discoverMeasures(): Promise<readonly PerEditMeasure[]> {
    const entries = await readdir(MEASURE_DIR).catch(() => [] as string[])
    const measureFiles = entries
        .filter(name => extname(name) === '.ts' && !name.startsWith('_') && !name.endsWith('.test.ts'))
        .sort()
    const loaded = await Promise.all(measureFiles.map(async name => {
        const mod = await import(pathToFileURL(join(MEASURE_DIR, name)).href)
        if (typeof mod.checkFile !== 'function') {
            throw new Error(`per-edit measure ${name} must export \`checkFile\``)
        }
        return mod.checkFile as PerEditMeasure
    }))
    return loaded
}

async function main(): Promise<number> {
    const raw = (await readStdin()).trim()
    if (!raw) return 0
    let envelope: ToolEnvelope
    try {
        envelope = JSON.parse(raw) as ToolEnvelope
    } catch {
        return 0
    }
    const filePath = pathFromEnvelope(envelope)
    if (!filePath) return 0
    let content: string
    try {
        content = await readFile(filePath, 'utf8')
    } catch {
        return 0
    }
    const measures = await discoverMeasures()
    const env = buildEnv()
    const settled = await Promise.all(measures.map(measure => measure({filePath, content, env})))
    const violations = settled.filter((v): v is {readonly message: string; readonly severity?: 'block' | 'warn'} => v !== null)
    if (violations.length === 0) return 0
    process.stderr.write(violations.map(v => v.message).join('\n') + '\n')
    return violations.some(v => v.severity !== 'warn') ? 2 : 0
}

main().then(code => process.exit(code)).catch(() => process.exit(0))
