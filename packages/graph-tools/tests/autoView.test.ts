import {execFileSync} from 'node:child_process'
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, describe, expect, it} from 'vitest'
import {
    scanMarkdownFiles,
    getNodeId,
    extractLinks,
    buildUniqueBasenameMap,
    resolveLinkTarget,
} from '../src/primitives'
import {renderAutoView} from '../src/autoView'
import {
    computeArboricity,
    deriveTitle,
    buildFolderSpine,
    renderSpine,
    renderCoverForest,
} from '../scripts/L3-BF-192-tree-cover-render'

const testDir: string = path.dirname(fileURLToPath(import.meta.url))
const repoRoot: string = path.resolve(testDir, '../../..')

function runViewCli(args: readonly string[]): string {
    return execFileSync(
        process.execPath,
        ['--import', 'tsx', 'packages/graph-tools/bin/vt-graph.ts', 'view', ...args],
        {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    )
}

function legacyTreeCover(vaultPath: string): string {
    const mdFiles = scanMarkdownFiles(vaultPath)
    const structureNodes = new Map<string, {id: string; title: string; outgoingIds: readonly string[]}>()
    const contentMap = new Map<string, string>()
    for (const absPath of mdFiles) {
        const id = getNodeId(vaultPath, absPath)
        const content = fs.readFileSync(absPath, 'utf8')
        structureNodes.set(id, {id, title: id, outgoingIds: []})
        contentMap.set(id, content)
    }

    const uniqueBasenames = buildUniqueBasenameMap(structureNodes)
    const state = {graph: {nodes: {} as Record<string, {absoluteFilePathIsID: string; contentWithoutYamlOrLinks: string; outgoingEdges: {targetId: string}[]}>}}
    for (const [id, content] of contentMap) {
        const absPath = path.join(vaultPath, id + '.md')
        const outgoingEdges: {targetId: string}[] = []
        for (const link of extractLinks(content)) {
            const target = resolveLinkTarget(link, id, structureNodes, uniqueBasenames)
            if (target && target !== id) {
                outgoingEdges.push({targetId: path.join(vaultPath, target + '.md')})
            }
        }
        state.graph.nodes[absPath] = {
            absoluteFilePathIsID: absPath,
            contentWithoutYamlOrLinks: content,
            outgoingEdges,
        }
    }

    const titleOf = new Map<string, string>()
    const edges: {src: string; tgt: string}[] = []
    for (const [id, node] of Object.entries(state.graph.nodes)) {
        titleOf.set(id, deriveTitle(node.contentWithoutYamlOrLinks, path.basename(id, '.md')))
        for (const edge of node.outgoingEdges) {
            if (edge.targetId !== id) {
                edges.push({src: id, tgt: edge.targetId})
            }
        }
    }

    const cover = computeArboricity(Object.keys(state.graph.nodes).length, edges)
    return [
        '═══ SPINE (folder hierarchy, no content edges) ═══',
        renderSpine(buildFolderSpine(state, vaultPath), vaultPath),
        '',
        ...cover.forests.flatMap((forest, index) => [renderCoverForest(index + 1, forest, titleOf, vaultPath), '']),
    ].join('\n')
}

describe('renderAutoView', () => {
    const tempDirs: string[] = []

    afterEach(() => {
        for (const tempDir of tempDirs) {
            rmSync(tempDir, {recursive: true, force: true})
        }
        tempDirs.length = 0
    })

    function makeFixtureVault(): string {
        const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vt-auto-view-'))
        tempDirs.push(tempDir)

        mkdirSync(path.join(tempDir, 'notes'))
        mkdirSync(path.join(tempDir, 'tasks'))
        writeFileSync(path.join(tempDir, 'root.md'), '# Root\n\n[[notes/summary]]\n[[tasks/task-1]]\n')
        writeFileSync(path.join(tempDir, 'notes', 'summary.md'), '# Summary\n\n[[notes/detail]]\n')
        writeFileSync(path.join(tempDir, 'notes', 'detail.md'), '# Detail\n\n[[notes/summary]]\n')
        writeFileSync(path.join(tempDir, 'tasks', 'task-1.md'), '# Task 1\n\n[[tasks/task-2]]\n[[root]]\n')
        writeFileSync(path.join(tempDir, 'tasks', 'task-2.md'), '# Task 2\n\n[[tasks/task-3]]\n[[tasks/task-1]]\n')
        writeFileSync(path.join(tempDir, 'tasks', 'task-3.md'), '# Task 3\n\n[[tasks/task-2]]\n')

        return tempDir
    }

    it('preserves the legacy tree-cover body when no collapse is needed', () => {
        const vaultPath = makeFixtureVault()
        const output = renderAutoView(vaultPath, {budget: 1000}).output
        const body = output.slice(output.indexOf('═══ SPINE'))

        expect(body).toBe(legacyTreeCover(vaultPath))
        expect(output).not.toContain('[collapsed:')
    })

    it('adds collapsed summary nodes and self-describing header lines when budget is tight', () => {
        const vaultPath = makeFixtureVault()
        const output = renderAutoView(vaultPath, {budget: 3}).output

        expect(output).toContain('# budget: 3 visible entities')
        expect(output).toContain('# collapse: strategy=')
        expect(output).toContain('[collapsed:')
        expect(output).toContain('format: tree-cover')
    })

    it('prints an `expand:` command for each collapsed cluster and a footer hint', () => {
        const vaultPath = makeFixtureVault()
        const output = renderAutoView(vaultPath, {budget: 3}).output

        expect(output).toMatch(/expand: vt-graph live focus /)
        expect(output).toContain('# hint: to expand a collapsed')
    })

    it('supports --budget from the CLI and rejects it on explicit render escape hatches', () => {
        const vaultPath = makeFixtureVault()

        const collapsedOutput = runViewCli([vaultPath, '--budget', '3'])
        expect(collapsedOutput).toContain('[collapsed:')

        expect(() => runViewCli([vaultPath, '--ascii', '--budget', '3']))
            .toThrow('--budget can only be used with the default auto view or --auto')
    })
})
