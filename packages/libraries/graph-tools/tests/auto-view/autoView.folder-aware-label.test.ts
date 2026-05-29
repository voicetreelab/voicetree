import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import type {CollapseCluster} from '../../src/view/collapseBoundary'
import {buildClusterDisplayLabelMap, renderAutoView} from '../../src/view/autoView'

const tempDirs = new Set<string>()

afterEach(() => {
    for (const dir of tempDirs) {
        fs.rmSync(dir, {recursive: true, force: true})
    }
    tempDirs.clear()
})

describe('buildClusterDisplayLabelMap', () => {
    it('uses the folder basename for a single aligned cluster', () => {
        const labels = buildClusterDisplayLabelMap([
            makeCluster({
                id: 'projects',
                label: 'teams/projects/',
                alignedFolderPath: 'teams/projects',
            }),
        ])

        expect(labels.get('projects')).toBe('projects/')
    })

    it('keeps distinct aligned basenames as bare basename labels', () => {
        const labels = buildClusterDisplayLabelMap([
            makeCluster({id: 'archive', label: 'deep/archive/', alignedFolderPath: 'deep/archive'}),
            makeCluster({id: 'projects', label: 'teams/projects/', alignedFolderPath: 'teams/projects'}),
        ])

        expect(labels.get('archive')).toBe('archive/')
        expect(labels.get('projects')).toBe('projects/')
    })

    it('disambiguates sibling basename collisions with the minimum suffix', () => {
        const labels = buildClusterDisplayLabelMap([
            makeCluster({id: 'notes-a', label: 'a/notes/', alignedFolderPath: 'a/notes'}),
            makeCluster({id: 'notes-b', label: 'b/notes/', alignedFolderPath: 'b/notes'}),
        ])

        expect(labels.get('notes-a')).toBe('a/notes/')
        expect(labels.get('notes-b')).toBe('b/notes/')
    })

    it('extends the suffix until colliding labels become unique', () => {
        const labels = buildClusterDisplayLabelMap([
            makeCluster({id: 'notes-a', label: 'x/a/notes/', alignedFolderPath: 'x/a/notes'}),
            makeCluster({id: 'notes-b', label: 'y/a/notes/', alignedFolderPath: 'y/a/notes'}),
        ])

        expect(labels.get('notes-a')).toBe('x/a/notes/')
        expect(labels.get('notes-b')).toBe('y/a/notes/')
    })

    it('keeps non-aligned clusters on their existing label', () => {
        const labels = buildClusterDisplayLabelMap([
            makeCluster({id: 'cluster-7', label: 'Alpha Note', strategy: 'louvain'}),
        ])

        expect(labels.get('cluster-7')).toBe('Alpha Note')
    })
})

describe('renderAutoView folder-aware labels', () => {
    it('uses the basename label in the auto header for nested folder-aligned clusters', () => {
        const projectPath = createProject({
            'teams/projects/a.md': 'A\n[[teams/projects/b]]\n',
            'teams/projects/b.md': 'B\n[[teams/projects/a]]\n',
            'teams/roadmap.md': 'Roadmap\n',
        })

        const output = renderAutoView(projectPath, {budget: 2}).output

        expect(output).toContain('# cluster: ▢ projects/ [collapsed:auto 2 nodes')
        expect(output).not.toContain('# cluster: ▢ teams/projects/ [collapsed:auto 2 nodes')
    })
})

function makeCluster(overrides: Partial<CollapseCluster> = {}): CollapseCluster {
    return {
        id: 'cluster-1',
        label: 'cluster-1',
        strategy: 'louvain',
        nodeIds: ['node-a'],
        anchorFolderPath: '',
        representativeRelPath: 'node-a.md',
        internalEdgeCount: 0,
        incomingEdgeCount: 0,
        outgoingEdgeCount: 0,
        boundaryEdgeCount: 0,
        cohesion: 1,
        ...overrides,
    }
}

function createProject(files: Record<string, string>): string {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-view-folder-label-'))
    tempDirs.add(projectPath)
    for (const [relativePath, content] of Object.entries(files)) {
        const absolutePath = path.join(projectPath, relativePath)
        fs.mkdirSync(path.dirname(absolutePath), {recursive: true})
        fs.writeFileSync(absolutePath, content, 'utf8')
    }
    return projectPath
}
