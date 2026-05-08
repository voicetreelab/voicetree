import { describe, it, expect } from 'vitest';
import { toRelativePath } from './toRelativePath';

describe('toRelativePath', () => {
    it('returns original path when projectRoot is null', () => {
        expect(toRelativePath(null, '/some/absolute/path')).toBe('/some/absolute/path');
    });

    it('converts absolute path to relative when inside project root', () => {
        const projectRoot = '/Users/bob/my-project';
        const absolutePath = '/Users/bob/my-project/notes/file.md';
        expect(toRelativePath(projectRoot, absolutePath)).toBe('notes/file.md');
    });

    it('returns original path when not inside project root', () => {
        const projectRoot = '/Users/bob/my-project';
        const absolutePath = '/Users/alice/other-project/file.md';
        expect(toRelativePath(projectRoot, absolutePath)).toBe('/Users/alice/other-project/file.md');
    });

    it('handles Windows-style backslashes by normalizing to forward slashes', () => {
        const projectRoot = 'C:\\Users\\bob\\my-project';
        const absolutePath = 'C:\\Users\\bob\\my-project\\notes\\file.md';
        expect(toRelativePath(projectRoot, absolutePath)).toBe('notes/file.md');
    });

    it('returns original path when absolutePath equals projectRoot (no trailing slash)', () => {
        const projectRoot = '/Users/bob/my-project';
        const absolutePath = '/Users/bob/my-project';
        expect(toRelativePath(projectRoot, absolutePath)).toBe('/Users/bob/my-project');
    });

    it('handles deeply nested paths correctly', () => {
        const projectRoot = '/Users/bob/my-project';
        const absolutePath = '/Users/bob/my-project/a/b/c/d/file.md';
        expect(toRelativePath(projectRoot, absolutePath)).toBe('a/b/c/d/file.md');
    });
});
