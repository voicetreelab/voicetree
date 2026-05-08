import { describe, it, expect } from 'vitest';
import { buildFolderTree } from './transforms';
import type { DirectoryEntry } from './transforms';
import { toAbsolutePath } from './types';
import type { AbsolutePath, FileTreeNode, FolderTreeNode } from './types';

function isFolderNode(node: { readonly name: string }): node is FolderTreeNode {
    return 'children' in node;
}

describe('buildFolderTree', () => {
    const root: AbsolutePath = toAbsolutePath('/project');

    it('sorts directories before files', () => {
        const entry: DirectoryEntry = {
            absolutePath: root,
            name: 'project',
            isDirectory: true,
            children: [
                { absolutePath: toAbsolutePath('/project/file.md'), name: 'file.md', isDirectory: false },
                { absolutePath: toAbsolutePath('/project/alpha'), name: 'alpha', isDirectory: true, children: [] },
            ],
        };
        const result: FolderTreeNode = buildFolderTree(entry, new Set(), null, new Set());
        expect(result.children[0].name).toBe('alpha');
        expect(result.children[1].name).toBe('file.md');
    });

    it('sorts directories alphabetically', () => {
        const entry: DirectoryEntry = {
            absolutePath: root,
            name: 'project',
            isDirectory: true,
            children: [
                { absolutePath: toAbsolutePath('/project/charlie'), name: 'charlie', isDirectory: true, children: [] },
                { absolutePath: toAbsolutePath('/project/alpha'), name: 'alpha', isDirectory: true, children: [] },
                { absolutePath: toAbsolutePath('/project/bravo'), name: 'bravo', isDirectory: true, children: [] },
            ],
        };
        const result: FolderTreeNode = buildFolderTree(entry, new Set(), null, new Set());
        expect(result.children.map(c => c.name)).toEqual(['alpha', 'bravo', 'charlie']);
    });

    it('sorts loaded directories before non-loaded directories', () => {
        const loadedPaths: ReadonlySet<string> = new Set(['/project/todo', '/project/workflows']);
        const entry: DirectoryEntry = {
            absolutePath: root,
            name: 'project',
            isDirectory: true,
            children: [
                { absolutePath: toAbsolutePath('/project/backend'), name: 'backend', isDirectory: true, children: [] },
                { absolutePath: toAbsolutePath('/project/todo'), name: 'todo', isDirectory: true, children: [] },
                { absolutePath: toAbsolutePath('/project/cloud'), name: 'cloud', isDirectory: true, children: [] },
                { absolutePath: toAbsolutePath('/project/workflows'), name: 'workflows', isDirectory: true, children: [] },
            ],
        };
        const result: FolderTreeNode = buildFolderTree(entry, loadedPaths, null, new Set());
        const names: readonly string[] = result.children.map(c => c.name);
        // Loaded folders first (alphabetical), then non-loaded (alphabetical)
        expect(names).toEqual(['todo', 'workflows', 'backend', 'cloud']);
    });

    it('loaded directories appear before non-loaded but after no other loaded', () => {
        const loadedPaths: ReadonlySet<string> = new Set(['/project/zebra']);
        const entry: DirectoryEntry = {
            absolutePath: root,
            name: 'project',
            isDirectory: true,
            children: [
                { absolutePath: toAbsolutePath('/project/alpha'), name: 'alpha', isDirectory: true, children: [] },
                { absolutePath: toAbsolutePath('/project/zebra'), name: 'zebra', isDirectory: true, children: [] },
            ],
        };
        const result: FolderTreeNode = buildFolderTree(entry, loadedPaths, null, new Set());
        // zebra is loaded so it comes first despite being alphabetically last
        expect(result.children[0].name).toBe('zebra');
        expect(result.children[1].name).toBe('alpha');
    });

    it('sets loadState and isWriteTarget correctly', () => {
        const loadedPaths: ReadonlySet<string> = new Set(['/project', '/project/notes']);
        const writePath: AbsolutePath = toAbsolutePath('/project/notes');
        const entry: DirectoryEntry = {
            absolutePath: root,
            name: 'project',
            isDirectory: true,
            children: [
                { absolutePath: toAbsolutePath('/project/notes'), name: 'notes', isDirectory: true, children: [] },
                { absolutePath: toAbsolutePath('/project/other'), name: 'other', isDirectory: true, children: [] },
            ],
        };
        const result: FolderTreeNode = buildFolderTree(entry, loadedPaths, writePath, new Set());
        expect(result.loadState).toBe('loaded');
        expect(result.isWriteTarget).toBe(false);
        const notes: FolderTreeNode = result.children[0] as FolderTreeNode;
        expect(isFolderNode(notes)).toBe(true);
        expect(notes.loadState).toBe('loaded');
        expect(notes.isWriteTarget).toBe(true);
    });

    it('marks files as isInGraph when in graphFilePaths', () => {
        const graphPaths: ReadonlySet<string> = new Set(['/project/readme.md']);
        const entry: DirectoryEntry = {
            absolutePath: root,
            name: 'project',
            isDirectory: true,
            children: [
                { absolutePath: toAbsolutePath('/project/readme.md'), name: 'readme.md', isDirectory: false },
                { absolutePath: toAbsolutePath('/project/other.md'), name: 'other.md', isDirectory: false },
            ],
        };
        const result: FolderTreeNode = buildFolderTree(entry, new Set(), null, graphPaths);
        const readme: FolderTreeNode | FileTreeNode = result.children.find(c => c.name === 'readme.md')!;
        const other: FolderTreeNode | FileTreeNode = result.children.find(c => c.name === 'other.md')!;
        expect('isInGraph' in readme && readme.isInGraph).toBe(true);
        expect('isInGraph' in other && other.isInGraph).toBe(false);
    });
});
