import {execFileSync} from 'node:child_process'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, describe, expect, it} from 'vitest'

import {
    applyCommand,
    loadSequence,
    serializeCommand,
    serializeState,
    toFixtureJson,
} from '@vt/graph-state'

type ExecFailure = Error & {
    readonly status?: number
    readonly stdout?: string | Buffer
    readonly stderr?: string | Buffer
}

const testDir: string = path.dirname(fileURLToPath(import.meta.url))
const repoRoot: string = path.resolve(testDir, '../../..')

function runApplyCli(args: readonly string[], input?: string): string {
    return execFileSync(
        process.execPath,
        ['--import', 'tsx', 'packages/graph-tools/bin/vt-graph.ts', 'apply', ...args],
        {
            cwd: repoRoot,
            encoding: 'utf8',
            ...(input !== undefined ? {input} : {}),
        },
    )
}

function runApplyCliFailure(args: readonly string[], input?: string): ExecFailure {
    try {
        runApplyCli(args, input)
    } catch (err) {
        return err as ExecFailure
    }

    throw new Error('Expected vt-graph apply to fail')
}

describe('vt-graph apply CLI', () => {
    const tempDirs: string[] = []

    afterEach(() => {
        for (const tempDir of tempDirs) {
            rmSync(tempDir, {recursive: true, force: true})
        }
        tempDirs.length = 0
    })

    it('applies the collapse fixture sequence from stdin to stdout', () => {
        const sequence = loadSequence('100-collapse-command')
        const command = sequence.commands[0]
        const initialJson = toFixtureJson(serializeState(sequence.initial))
        const expected = serializeState(applyCommand(sequence.initial, command))

        const output = runApplyCli([JSON.stringify(serializeCommand(command))], initialJson)

        expect(JSON.parse(output)).toEqual(expected)
    })

    it('supports --state-file and --out for serialized state IO', () => {
        const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vt-state-apply-'))
        tempDirs.push(tempDir)

        const sequence = loadSequence('100-collapse-command')
        const command = sequence.commands[0]
        const stateFilePath = path.join(tempDir, 'state.json')
        const outPath = path.join(tempDir, 'next-state.json')
        const expected = serializeState(applyCommand(sequence.initial, command))

        writeFileSync(stateFilePath, toFixtureJson(serializeState(sequence.initial)))

        runApplyCli([
            JSON.stringify(serializeCommand(command)),
            '--state-file',
            stateFilePath,
            '--out',
            outPath,
        ])

        expect(JSON.parse(readFileSync(outPath, 'utf8'))).toEqual(expected)
    })

    it('fails with a helpful error for an unknown command discriminator', () => {
        const failure = runApplyCliFailure([JSON.stringify({type: 'Explode'})])

        expect(failure.status).toBe(1)
        expect(String(failure.stderr)).toContain('Unknown command type: "Explode"')
        expect(String(failure.stderr)).toContain('Expected one of: Collapse, Expand, Select')
    })
})
