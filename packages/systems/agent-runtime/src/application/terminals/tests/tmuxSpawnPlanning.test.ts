import {describe, expect, it} from 'vitest';
import {
    resolveTmuxVaultPath,
    withResolvedTmuxVaultPath,
    withVoicetreeVaultPath,
} from '../tmux/tmuxSpawnPlanning';

describe('tmux spawn planning', () => {
    it('prefers the process vault path over the initial env fallback', () => {
        expect(resolveTmuxVaultPath(
            {VOICETREE_VAULT_PATH: '/process-vault'},
            {VOICETREE_VAULT_PATH: '/initial-vault'},
        )).toBe('/process-vault');
    });

    it('falls back to the initial env vault path', () => {
        expect(resolveTmuxVaultPath({}, {VOICETREE_VAULT_PATH: '/initial-vault'}))
            .toBe('/initial-vault');
    });

    it('falls back to the runtime write path when no env vault path exists', () => {
        expect(resolveTmuxVaultPath({}, {}, '/runtime-write-path'))
            .toBe('/runtime-write-path');
    });

    it('records the resolved vault path on terminal data env vars only when missing', () => {
        expect(withResolvedTmuxVaultPath({}, '/runtime-write-path')).toEqual({
            VOICETREE_VAULT_PATH: '/runtime-write-path',
        });
        expect(withResolvedTmuxVaultPath({VOICETREE_VAULT_PATH: '/initial-vault'}, '/runtime-write-path'))
            .toEqual({VOICETREE_VAULT_PATH: '/initial-vault'});
        expect(withResolvedTmuxVaultPath({}, undefined)).toBeUndefined();
    });

    it('backfills VOICETREE_VAULT_PATH and drops non-string runtime values', () => {
        const env = withVoicetreeVaultPath({
            FOO: 'bar',
            NUMBERY: 123 as unknown as string,
        }, '/vault');

        expect(env).toEqual({
            FOO: 'bar',
            VOICETREE_VAULT_PATH: '/vault',
        });
    });

    it('keeps an explicit initial vault path', () => {
        const env = withVoicetreeVaultPath({
            VOICETREE_VAULT_PATH: '/initial-vault',
            FOO: 'bar',
        }, '/process-vault');

        expect(env).toEqual({
            VOICETREE_VAULT_PATH: '/initial-vault',
            FOO: 'bar',
        });
    });
});
