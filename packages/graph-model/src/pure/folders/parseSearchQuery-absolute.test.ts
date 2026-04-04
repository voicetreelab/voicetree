import { describe, it, expect } from 'vitest';
import { parseSearchQuery } from './transforms';
import type { ParsedQuery } from './transforms';

describe('parseSearchQuery — absolute path support', () => {
    it('detects absolute path and preserves leading slash', () => {
        const result: ParsedQuery = parseSearchQuery('/Users/bob/docs');
        expect(result.isAbsolute).toBe(true);
        expect(result.basePath).toBe('/Users/bob');
        expect(result.filterText).toBe('docs');
        expect(result.endsWithSlash).toBe(false);
    });

    it('detects absolute path ending with slash', () => {
        const result: ParsedQuery = parseSearchQuery('/Users/bob/docs/');
        expect(result.isAbsolute).toBe(true);
        expect(result.basePath).toBe('/Users/bob/docs');
        expect(result.filterText).toBe('');
        expect(result.endsWithSlash).toBe(true);
    });

    it('detects short absolute path /docs', () => {
        // "/docs" → lastSlash at 0, basePath="" → null, filterText="docs"
        const result: ParsedQuery = parseSearchQuery('/docs');
        expect(result.isAbsolute).toBe(true);
        expect(result.basePath).toBeNull();
        expect(result.filterText).toBe('docs');
    });

    it('relative paths are not absolute', () => {
        const result: ParsedQuery = parseSearchQuery('docs/api');
        expect(result.isAbsolute).toBe(false);
        expect(result.basePath).toBe('docs');
        expect(result.filterText).toBe('api');
    });

    it('empty string is not absolute', () => {
        const result: ParsedQuery = parseSearchQuery('');
        expect(result.isAbsolute).toBe(false);
    });

    it('deep absolute path splits correctly', () => {
        const result: ParsedQuery = parseSearchQuery('/Users/bobbobby/repos/knowledge/VT-Theory/viability/');
        expect(result.isAbsolute).toBe(true);
        expect(result.basePath).toBe('/Users/bobbobby/repos/knowledge/VT-Theory/viability');
        expect(result.filterText).toBe('');
        expect(result.endsWithSlash).toBe(true);
    });

    it('absolute path with partial filter text', () => {
        const result: ParsedQuery = parseSearchQuery('/Users/bobbobby/repos/knowledge/VT-');
        expect(result.isAbsolute).toBe(true);
        expect(result.basePath).toBe('/Users/bobbobby/repos/knowledge');
        expect(result.filterText).toBe('VT-');
    });
});
