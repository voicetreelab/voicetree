import { describe, it, expect } from 'vitest';
import { decideVaultConfig } from '../decideVaultConfig';

describe('decideVaultConfig', () => {
    it('uses saved config verbatim and skips persistence', () => {
        const saved = { writeFolderPath: '/vault/write', allowlist: ['/vault/write', '/vault/notes'] } as const;

        const plan = decideVaultConfig(saved, '/vault/ignored', ['/vault/ignored']);

        expect(plan.config).toBe(saved);
        expect(plan.shouldPersist).toBe(false);
    });

    it('builds derived config and requests persistence when no saved config exists', () => {
        const plan = decideVaultConfig(null, '/vault/new', ['/vault/new', '/vault/extras']);

        expect(plan.config).toEqual({
            writeFolderPath: '/vault/new',
            allowlist: ['/vault/new', '/vault/extras'],
        });
        expect(plan.shouldPersist).toBe(true);
    });
});
