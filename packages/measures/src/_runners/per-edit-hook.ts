#!/usr/bin/env node
// PostToolUse agent-hook runner. Reads the tool envelope from stdin,
// reads the just-edited file, runs every pure measure under
// checks/tier_0_post_edit/, prints any violations to stderr, exits 2 if
// any measure violated (blocks the agent so it must refactor).
//
// All I/O lives here (the runner edge); the measures themselves are
// pure transforms of {filePath, content} → violation | null. This
// keeps checks/tier_0_post_edit/ in the pure core of measures/checks/.
//
// Invoked by .claude/hooks/run-per-edit.cjs and (via symlink)
// .codex/hooks/run-per-edit.cjs.

import {readFile, readdir} from 'node:fs/promises'
import {dirname, extname, join, resolve} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

type ToolEnvelope = {
    readonly tool_input?: {
        readonly file_path?: string
        readonly absolutePath?: string
        readonly notebook_path?: string
    }
}

type PerEditMeasure = (args: {readonly filePath: string; readonly content: string}) =>
    | {readonly message: string}
    | null
    | Promise<{readonly message: string} | null>

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const MEASURE_DIR = resolve(SCRIPT_DIR, '..', 'checks', 'tier_0_post_edit')

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
    const settled = await Promise.all(measures.map(measure => measure({filePath, content})))
    const violations = settled.filter((v): v is {readonly message: string} => v !== null)
    if (violations.length === 0) return 0
    process.stderr.write(violations.map(v => v.message).join('\n') + '\n')
    return 2
}

main().then(code => process.exit(code)).catch(() => process.exit(0))
