import { describe, it, expect, beforeEach } from 'vitest';
import { setWatchedFolder, getWatchedFolder, toRelativePath } from './WatchedFolderStore';

describe('WatchedFolderStore', () => {
    beforeEach(() => {
        // Reset state before each test
        setWatchedFolder(null);
    });

    describe('getWatchedFolder / setWatchedFolder', () => {
        it('should return null when not set', () => {
            expect(getWatchedFolder()).toBeNull();
        });

        it('should return the set folder', () => {
            setWatchedFolder('/Users/bob/project');
            expect(getWatchedFolder()).toBe('/Users/bob/project');
        });

        it('should allow clearing the folder', () => {
            setWatchedFolder('/Users/bob/project');
            setWatchedFolder(null);
            expect(getWatchedFolder()).toBeNull();
        });
    });

    describe('toRelativePath', () => {
        it('should return original path when watched folder is not set', () => {
            expect(toRelativePath('/Users/bob/project/foo/bar.md')).toBe('/Users/bob/project/foo/bar.md');
        });

        it('should convert absolute path to relative when within watched folder', () => {
            setWatchedFolder('/Users/bob/project');
            expect(toRelativePath('/Users/bob/project/foo/bar.md')).toBe('foo/bar.md');
        });

        it('should handle nested paths correctly', () => {
            setWatchedFolder('/Users/bob/project');
            expect(toRelativePath('/Users/bob/project/a/b/c/file.md')).toBe('a/b/c/file.md');
        });

        it('should handle files at root of watched folder', () => {
            setWatchedFolder('/Users/bob/project');
            expect(toRelativePath('/Users/bob/project/root-file.md')).toBe('root-file.md');
        });

        it('should return original path when outside watched folder', () => {
            setWatchedFolder('/Users/bob/project');
            expect(toRelativePath('/Users/other/file.md')).toBe('/Users/other/file.md');
        });

        it('should handle Windows-style backslashes', () => {
            setWatchedFolder('C:\\Users\\bob\\project');
            expect(toRelativePath('C:\\Users\\bob\\project\\foo\\bar.md')).toBe('foo/bar.md');
        });

        it('should handle mixed path separators', () => {
            setWatchedFolder('/Users/bob/project');
            expect(toRelativePath('/Users/bob/project\\foo\\bar.md')).toBe('foo/bar.md');
        });

        it('should not match partial folder names', () => {
            setWatchedFolder('/Users/bob/project');
            // /Users/bob/project-other should NOT match /Users/bob/project
            expect(toRelativePath('/Users/bob/project-other/foo.md')).toBe('/Users/bob/project-other/foo.md');
        });
    });
});
