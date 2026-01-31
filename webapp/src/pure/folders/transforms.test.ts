import { describe, it, expect } from 'vitest';
import {
    toDisplayPath,
    getAvailableFolders,
    reduceFolderConfig,
    toFolderSelectorState,
} from './transforms';
import { toAbsolutePath } from './types';
import type { AbsolutePath, AvailableFolderItem, FolderAction } from './types';
import type { VaultConfig } from '@/pure/settings/types';

describe('toDisplayPath', () => {
    it('returns "." when absolutePath equals projectRoot', () => {
        const projectRoot: AbsolutePath = toAbsolutePath('/Users/bob/project');
        const absolutePath: AbsolutePath = toAbsolutePath('/Users/bob/project');
        expect(toDisplayPath(projectRoot, absolutePath)).toBe('.');
    });

    it('returns relative path for subdirectory', () => {
        const projectRoot: AbsolutePath = toAbsolutePath('/Users/bob/project');
        const absolutePath: AbsolutePath = toAbsolutePath('/Users/bob/project/notes');
        expect(toDisplayPath(projectRoot, absolutePath)).toBe('notes');
    });

    it('returns relative path for deeply nested subdirectory', () => {
        const projectRoot: AbsolutePath = toAbsolutePath('/Users/bob/project');
        const absolutePath: AbsolutePath = toAbsolutePath('/Users/bob/project/notes/daily/2024');
        expect(toDisplayPath(projectRoot, absolutePath)).toBe('notes/daily/2024');
    });

    it('handles Windows-style backslashes', () => {
        const projectRoot: AbsolutePath = toAbsolutePath('C:\\Users\\bob\\project');
        const absolutePath: AbsolutePath = toAbsolutePath('C:\\Users\\bob\\project\\notes');
        expect(toDisplayPath(projectRoot, absolutePath)).toBe('notes');
    });
});

describe('getAvailableFolders', () => {
    const projectRoot: AbsolutePath = toAbsolutePath('/Users/bob/project');

    it('filters out already loaded paths', () => {
        const loadedPaths: readonly AbsolutePath[] = [
            toAbsolutePath('/Users/bob/project/notes'),
        ];
        const allSubfolders: readonly { path: AbsolutePath; modifiedAt: number }[] = [
            { path: toAbsolutePath('/Users/bob/project/notes'), modifiedAt: 1000 },
            { path: toAbsolutePath('/Users/bob/project/drafts'), modifiedAt: 2000 },
        ];
        const result: readonly AvailableFolderItem[] = getAvailableFolders(
            projectRoot,
            loadedPaths,
            allSubfolders,
            ''
        );
        expect(result).toHaveLength(1);
        expect(result[0].absolutePath).toBe('/Users/bob/project/drafts');
    });

    it('returns max 5 when no search query', () => {
        const loadedPaths: readonly AbsolutePath[] = [];
        const allSubfolders: readonly { path: AbsolutePath; modifiedAt: number }[] = [
            { path: toAbsolutePath('/Users/bob/project/a'), modifiedAt: 1 },
            { path: toAbsolutePath('/Users/bob/project/b'), modifiedAt: 2 },
            { path: toAbsolutePath('/Users/bob/project/c'), modifiedAt: 3 },
            { path: toAbsolutePath('/Users/bob/project/d'), modifiedAt: 4 },
            { path: toAbsolutePath('/Users/bob/project/e'), modifiedAt: 5 },
            { path: toAbsolutePath('/Users/bob/project/f'), modifiedAt: 6 },
            { path: toAbsolutePath('/Users/bob/project/g'), modifiedAt: 7 },
        ];
        const result: readonly AvailableFolderItem[] = getAvailableFolders(
            projectRoot,
            loadedPaths,
            allSubfolders,
            ''
        );
        expect(result).toHaveLength(5);
    });

    it('root "/" appears first when no search query', () => {
        const loadedPaths: readonly AbsolutePath[] = [];
        const allSubfolders: readonly { path: AbsolutePath; modifiedAt: number }[] = [
            { path: toAbsolutePath('/Users/bob/project/notes'), modifiedAt: 2000 },
            { path: toAbsolutePath('/Users/bob/project'), modifiedAt: 1000 }, // project root
        ];
        const result: readonly AvailableFolderItem[] = getAvailableFolders(
            projectRoot,
            loadedPaths,
            allSubfolders,
            ''
        );
        expect(result[0].displayPath).toBe('.');
        expect(result[0].absolutePath).toBe('/Users/bob/project');
    });

    it('sorts by modifiedAt descending (most recent first)', () => {
        const loadedPaths: readonly AbsolutePath[] = [];
        const allSubfolders: readonly { path: AbsolutePath; modifiedAt: number }[] = [
            { path: toAbsolutePath('/Users/bob/project/old'), modifiedAt: 1000 },
            { path: toAbsolutePath('/Users/bob/project/new'), modifiedAt: 3000 },
            { path: toAbsolutePath('/Users/bob/project/mid'), modifiedAt: 2000 },
        ];
        const result: readonly AvailableFolderItem[] = getAvailableFolders(
            projectRoot,
            loadedPaths,
            allSubfolders,
            ''
        );
        expect(result[0].absolutePath).toBe('/Users/bob/project/new');
        expect(result[1].absolutePath).toBe('/Users/bob/project/mid');
        expect(result[2].absolutePath).toBe('/Users/bob/project/old');
    });

    it('search query filters case-insensitively', () => {
        const loadedPaths: readonly AbsolutePath[] = [];
        const allSubfolders: readonly { path: AbsolutePath; modifiedAt: number }[] = [
            { path: toAbsolutePath('/Users/bob/project/Notes'), modifiedAt: 1000 },
            { path: toAbsolutePath('/Users/bob/project/drafts'), modifiedAt: 2000 },
            { path: toAbsolutePath('/Users/bob/project/mynotes'), modifiedAt: 3000 },
        ];
        const result: readonly AvailableFolderItem[] = getAvailableFolders(
            projectRoot,
            loadedPaths,
            allSubfolders,
            'notes'
        );
        expect(result).toHaveLength(2);
        expect(result.map(f => f.displayPath)).toContain('Notes');
        expect(result.map(f => f.displayPath)).toContain('mynotes');
    });

    it('search removes the 5-item limit', () => {
        const loadedPaths: readonly AbsolutePath[] = [];
        const allSubfolders: readonly { path: AbsolutePath; modifiedAt: number }[] = Array.from(
            { length: 10 },
            (_, i) => ({
                path: toAbsolutePath(`/Users/bob/project/folder${i}`),
                modifiedAt: i,
            })
        );
        const result: readonly AvailableFolderItem[] = getAvailableFolders(
            projectRoot,
            loadedPaths,
            allSubfolders,
            'folder'
        );
        expect(result).toHaveLength(10);
    });
});

describe('reduceFolderConfig', () => {
    const projectRoot: AbsolutePath = toAbsolutePath('/Users/bob/project');

    it('RESET_WRITE_TO_ROOT sets write to root', () => {
        const config: VaultConfig = {
            writePath: '/Users/bob/project/notes',
            readPaths: ['/Users/bob/project/drafts'],
        };
        const action: FolderAction = { type: 'RESET_WRITE_TO_ROOT' };
        const result: VaultConfig = reduceFolderConfig(config, action, projectRoot);
        expect(result.writePath).toBe('/Users/bob/project');
    });

    it('SET_AS_WRITE swaps write and read (old write becomes read)', () => {
        const config: VaultConfig = {
            writePath: '/Users/bob/project/notes',
            readPaths: [],
        };
        const action: FolderAction = {
            type: 'SET_AS_WRITE',
            path: toAbsolutePath('/Users/bob/project/drafts'),
        };
        const result: VaultConfig = reduceFolderConfig(config, action, projectRoot);
        expect(result.writePath).toBe('/Users/bob/project/drafts');
        expect(result.readPaths).toContain('/Users/bob/project/notes');
    });

    it('SET_AS_WRITE does not add old write to read if same as new write', () => {
        const config: VaultConfig = {
            writePath: '/Users/bob/project/notes',
            readPaths: [],
        };
        const action: FolderAction = {
            type: 'SET_AS_WRITE',
            path: toAbsolutePath('/Users/bob/project/notes'),
        };
        const result: VaultConfig = reduceFolderConfig(config, action, projectRoot);
        expect(result.writePath).toBe('/Users/bob/project/notes');
        expect(result.readPaths).toHaveLength(0);
    });

    it('SET_AS_WRITE removes the path from readPaths if it was there', () => {
        const config: VaultConfig = {
            writePath: '/Users/bob/project/notes',
            readPaths: ['/Users/bob/project/drafts', '/Users/bob/project/archive'],
        };
        const action: FolderAction = {
            type: 'SET_AS_WRITE',
            path: toAbsolutePath('/Users/bob/project/drafts'),
        };
        const result: VaultConfig = reduceFolderConfig(config, action, projectRoot);
        expect(result.writePath).toBe('/Users/bob/project/drafts');
        expect(result.readPaths).toContain('/Users/bob/project/notes');
        expect(result.readPaths).toContain('/Users/bob/project/archive');
        expect(result.readPaths).not.toContain('/Users/bob/project/drafts');
    });

    it('ADD_AS_READ adds to read folders', () => {
        const config: VaultConfig = {
            writePath: '/Users/bob/project/notes',
            readPaths: [],
        };
        const action: FolderAction = {
            type: 'ADD_AS_READ',
            path: toAbsolutePath('/Users/bob/project/drafts'),
        };
        const result: VaultConfig = reduceFolderConfig(config, action, projectRoot);
        expect(result.readPaths).toContain('/Users/bob/project/drafts');
    });

    it('ADD_AS_READ does not add duplicates', () => {
        const config: VaultConfig = {
            writePath: '/Users/bob/project/notes',
            readPaths: ['/Users/bob/project/drafts'],
        };
        const action: FolderAction = {
            type: 'ADD_AS_READ',
            path: toAbsolutePath('/Users/bob/project/drafts'),
        };
        const result: VaultConfig = reduceFolderConfig(config, action, projectRoot);
        expect(result.readPaths.filter(p => p === '/Users/bob/project/drafts')).toHaveLength(1);
    });

    it('REMOVE_READ_FOLDER removes correctly', () => {
        const config: VaultConfig = {
            writePath: '/Users/bob/project/notes',
            readPaths: ['/Users/bob/project/drafts', '/Users/bob/project/archive'],
        };
        const action: FolderAction = {
            type: 'REMOVE_READ_FOLDER',
            path: toAbsolutePath('/Users/bob/project/drafts'),
        };
        const result: VaultConfig = reduceFolderConfig(config, action, projectRoot);
        expect(result.readPaths).not.toContain('/Users/bob/project/drafts');
        expect(result.readPaths).toContain('/Users/bob/project/archive');
    });

    it('returns same config for unhandled action types', () => {
        const config: VaultConfig = {
            writePath: '/Users/bob/project/notes',
            readPaths: [],
        };
        const action: FolderAction = { type: 'TOGGLE_DROPDOWN' };
        const result: VaultConfig = reduceFolderConfig(config, action, projectRoot);
        expect(result).toEqual(config);
    });
});

describe('toFolderSelectorState', () => {
    const projectRoot: AbsolutePath = toAbsolutePath('/Users/bob/project');

    it('converts raw data to UI state object', () => {
        const writeFolder: AbsolutePath = toAbsolutePath('/Users/bob/project/notes');
        const readFolders: readonly AbsolutePath[] = [
            toAbsolutePath('/Users/bob/project/drafts'),
        ];
        const availableFolders: readonly AvailableFolderItem[] = [
            {
                absolutePath: toAbsolutePath('/Users/bob/project/archive'),
                displayPath: 'archive',
                modifiedAt: 1000,
            },
        ];
        const searchQuery = '';
        const isOpen = true;

        const result = toFolderSelectorState(
            projectRoot,
            writeFolder,
            readFolders,
            availableFolders,
            searchQuery,
            isOpen
        );

        expect(result.projectRoot).toBe('/Users/bob/project');
        expect(result.writeFolder?.absolutePath).toBe('/Users/bob/project/notes');
        expect(result.writeFolder?.displayPath).toBe('notes');
        expect(result.readFolders).toHaveLength(1);
        expect(result.readFolders[0].absolutePath).toBe('/Users/bob/project/drafts');
        expect(result.readFolders[0].displayPath).toBe('drafts');
        expect(result.availableFolders).toEqual(availableFolders);
        expect(result.searchQuery).toBe('');
        expect(result.isOpen).toBe(true);
        expect(result.isLoading).toBe(false);
        expect(result.error).toBeNull();
    });

    it('handles project root as write folder (displayPath should be ".")', () => {
        const writeFolder: AbsolutePath = toAbsolutePath('/Users/bob/project');
        const readFolders: readonly AbsolutePath[] = [];
        const availableFolders: readonly AvailableFolderItem[] = [];

        const result = toFolderSelectorState(
            projectRoot,
            writeFolder,
            readFolders,
            availableFolders,
            '',
            false
        );

        expect(result.writeFolder?.displayPath).toBe('.');
    });
});
