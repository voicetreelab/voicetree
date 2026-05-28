import {describe, expect, it} from 'vitest'
import {walkDirectories} from '../walk-directories.ts'
import {checkDirectoryFanouts} from './directory-fanout.ts'

type Tree = {[path: string]: readonly string[]}

const REPO = '/repo'
const ROOT = '/repo/src'

function fakeWalker(tree: Tree): typeof walkDirectories {
    return async (root, options) => {
        const walked: Array<{absolutePath: string; entries: ReadonlyArray<{name: string; absolutePath: string; kind: 'directory' | 'file' | 'other'}>}> = []
        const visit = (path: string): void => {
            const children = tree[path] ?? []
            const entries = children
                .map(name => ({
                    name,
                    absolutePath: `${path}/${name}`,
                    kind: tree[`${path}/${name}`] !== undefined ? 'directory' as const : 'file' as const,
                }))
                .filter(options?.includeEntry ?? (() => true))
            walked.push({absolutePath: path, entries})
            for (const entry of entries) {
                if (entry.kind === 'directory') visit(entry.absolutePath)
            }
        }
        visit(root)
        return walked
    }
}

describe('checkDirectoryFanouts', () => {
    it('reports no violations when every directory is at or below the limit', async () => {
        const tree: Tree = {[ROOT]: Array.from({length: 15}, (_, i) => `c-${i}.ts`)}
        const report = await checkDirectoryFanouts({roots: [ROOT], repoRoot: REPO, walker: fakeWalker(tree)})

        expect(report.violations).toEqual([])
        expect(report.report).toBe('')
        expect(report.maxChildCount).toBe(15)
        expect(report.maxAllowedChildCount).toBe(15)
    })

    it('flags directories strictly over the limit, sorted by count desc then name', async () => {
        const big = (name: string, n: number): readonly string[] => Array.from({length: n}, (_, i) => `${name}-${i}.ts`)
        const tree: Tree = {
            [ROOT]: ['huge', 'a', 'b', 'small'],
            [`${ROOT}/huge`]: big('h', 25),
            [`${ROOT}/a`]: big('a', 16),
            [`${ROOT}/b`]: big('b', 16),
            [`${ROOT}/small`]: big('s', 5),
        }
        const report = await checkDirectoryFanouts({roots: [ROOT], repoRoot: REPO, walker: fakeWalker(tree)})

        expect(report.violations.map(v => v.directory.split('/').pop())).toEqual(['huge', 'a', 'b'])
        expect(report.maxChildCount).toBe(25)
    })

    it('renders a singular vs plural remediation hint in the printable report', async () => {
        const oneTree: Tree = {[ROOT]: ['x'], [`${ROOT}/x`]: Array.from({length: 16}, (_, i) => `f-${i}.ts`)}
        const oneReport = await checkDirectoryFanouts({roots: [ROOT], repoRoot: REPO, walker: fakeWalker(oneTree)})

        const manyTree: Tree = {
            [ROOT]: ['x', 'y'],
            [`${ROOT}/x`]: Array.from({length: 16}, (_, i) => `f-${i}.ts`),
            [`${ROOT}/y`]: Array.from({length: 16}, (_, i) => `g-${i}.ts`),
        }
        const manyReport = await checkDirectoryFanouts({roots: [ROOT], repoRoot: REPO, walker: fakeWalker(manyTree)})

        expect(oneReport.report).toContain('1 source directory has')
        expect(oneReport.report).toContain('folder hierarchy')
        expect(oneReport.report).toContain('15-child fanout limit')
        expect(manyReport.report).toContain('2 source directories have')
    })

    it('honours the walker\'s includeEntry filter (so callers can hide build/dist/node_modules)', async () => {
        const callsToFilter: string[] = []
        const recordingWalker: typeof walkDirectories = async (root, options) => {
            const tree: Tree = {
                [root]: ['src', 'node_modules', 'dist'],
                [`${root}/src`]: ['a.ts'],
                [`${root}/node_modules`]: Array.from({length: 50}, (_, i) => `lib-${i}`),
                [`${root}/dist`]: Array.from({length: 50}, (_, i) => `out-${i}`),
            }
            const include = options?.includeEntry ?? (() => true)
            const entries = (tree[root] ?? []).map(name => {
                callsToFilter.push(name)
                return {name, absolutePath: `${root}/${name}`, kind: 'directory' as const}
            }).filter(include)
            return [{absolutePath: root, entries}]
        }

        await checkDirectoryFanouts({roots: [ROOT], repoRoot: REPO, walker: recordingWalker})
        expect(callsToFilter).toContain('node_modules')
        expect(callsToFilter).toContain('dist')
    })
})
