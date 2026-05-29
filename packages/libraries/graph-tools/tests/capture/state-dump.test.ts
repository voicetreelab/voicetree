import {execFileSync} from 'node:child_process'
import {existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, describe, expect, it} from 'vitest'

const testDir: string = path.dirname(fileURLToPath(import.meta.url))
const repoRoot: string = path.resolve(testDir, '../../../../..')

function runStateDumpCli(args: readonly string[]): string {
    return execFileSync(
        process.execPath,
        ['--import', 'tsx', 'packages/libraries/graph-tools/bin/vt-graph.ts', 'state', 'dump', ...args],
        {
            cwd: repoRoot,
            encoding: 'utf8',
        },
    )
}

describe('vt-graph state dump CLI', () => {
    const tempDirs: string[] = []

    afterEach(() => {
        for (const tempDir of tempDirs) {
            rmSync(tempDir, {recursive: true, force: true})
        }
        tempDirs.length = 0
    })

    function makeFixtureProject(): string {
        const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vt-state-dump-'))
        tempDirs.push(tempDir)

        mkdirSync(path.join(tempDir, 'knowledge'))
        writeFileSync(path.join(tempDir, 'index.md'), '# Index\n\n[[knowledge/idea]]\n')
        writeFileSync(path.join(tempDir, 'knowledge', 'knowledge.md'), '---\nposition:\n  x: 10\n  y: 20\n---\n# Knowledge\n')
        writeFileSync(path.join(tempDir, 'knowledge', 'idea.md'), '# Idea\n')

        return tempDir
    }

    it('prints valid serialized State JSON to stdout', () => {
        const projectPath = makeFixtureProject()
        const stdout = runStateDumpCli([projectPath])
        const parsed = JSON.parse(stdout) as {
            meta: {schemaVersion: number; revision: number}
            folderState: readonly (readonly [string, string])[]
            graph: {nodes: Record<string, unknown>}
            layout: {positions: readonly unknown[]}
        }

        expect(parsed.meta.schemaVersion).toBe(1)
        expect(parsed.meta.revision).toBe(0)
        expect(parsed.folderState).toEqual([[projectPath, 'expanded']])
        expect(Object.keys(parsed.graph.nodes)).toHaveLength(3)
        expect(parsed.layout.positions.length).toBeGreaterThan(0)
        expect(stdout).toContain('\n  "meta": {')
    })

    it('supports --out and compact output', () => {
        const projectPath = makeFixtureProject()
        const outPath = path.join(projectPath, 'state.json')
        const stdout = runStateDumpCli([projectPath, '--no-pretty', '--out', outPath])

        expect(existsSync(outPath)).toBe(true)
        expect(readFileSync(outPath, 'utf8')).toBe(stdout)
        expect(stdout.trim()).not.toContain('\n')

        const parsed = JSON.parse(stdout) as {
            meta: {schemaVersion: number}
            graph: {nodes: Record<string, unknown>}
        }

        expect(parsed.meta.schemaVersion).toBe(1)
        expect(Object.keys(parsed.graph.nodes)).toHaveLength(3)
    })
})
