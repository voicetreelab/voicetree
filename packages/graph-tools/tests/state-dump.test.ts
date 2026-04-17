import {execFileSync} from 'node:child_process'
import {existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, describe, expect, it} from 'vitest'

const testDir: string = path.dirname(fileURLToPath(import.meta.url))
const repoRoot: string = path.resolve(testDir, '../../..')

function runStateDumpCli(args: readonly string[]): string {
    return execFileSync(
        process.execPath,
        ['--import', 'tsx', 'packages/graph-tools/bin/vt-graph.ts', 'state', 'dump', ...args],
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

    function makeFixtureVault(): string {
        const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vt-state-dump-'))
        tempDirs.push(tempDir)

        mkdirSync(path.join(tempDir, 'knowledge'))
        writeFileSync(path.join(tempDir, 'index.md'), '# Index\n\n[[knowledge/idea]]\n')
        writeFileSync(path.join(tempDir, 'knowledge', 'knowledge.md'), '# Knowledge\n')
        writeFileSync(path.join(tempDir, 'knowledge', 'idea.md'), '# Idea\n')

        return tempDir
    }

    it('prints valid serialized State JSON to stdout', () => {
        const vaultPath = makeFixtureVault()
        const stdout = runStateDumpCli([vaultPath])
        const parsed = JSON.parse(stdout) as {
            meta: {schemaVersion: number; revision: number}
            roots: {loaded: string[]}
            graph: {nodes: Record<string, unknown>}
            layout: {positions: readonly unknown[]}
        }

        expect(parsed.meta.schemaVersion).toBe(1)
        expect(parsed.meta.revision).toBe(0)
        expect(parsed.roots.loaded).toEqual([vaultPath])
        expect(Object.keys(parsed.graph.nodes)).toHaveLength(3)
        expect(parsed.layout.positions.length).toBeGreaterThan(0)
        expect(stdout).toContain('\n  "meta": {')
    })

    it('supports --out and compact output', () => {
        const vaultPath = makeFixtureVault()
        const outPath = path.join(vaultPath, 'state.json')
        const stdout = runStateDumpCli([vaultPath, '--no-pretty', '--out', outPath])

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
