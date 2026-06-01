import { describe, it, expect } from 'vitest';
import { decideProjectConfig } from '../decideProjectConfig';

describe('decideProjectConfig', () => {
    it('uses saved config verbatim and skips persistence', () => {
        const saved = { writeFolderPath: '/project/write', allowlist: ['/project/write', '/project/notes'] } as const;

        const plan = decideProjectConfig(saved, '/project/ignored', ['/project/ignored']);

        expect(plan.config).toBe(saved);
        expect(plan.shouldPersist).toBe(false);
    });

    it('builds derived config and requests persistence when no saved config exists', () => {
        const plan = decideProjectConfig(null, '/project/new', ['/project/new', '/project/extras']);

        expect(plan.config).toEqual({
            writeFolderPath: '/project/new',
            allowlist: ['/project/new', '/project/extras'],
        });
        expect(plan.shouldPersist).toBe(true);
    });
});
