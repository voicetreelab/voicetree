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

    it('falls back to the runtime project root when no env vault path exists', () => {
        expect(resolveTmuxVaultPath({}, {}, '/runtime-project-root'))
            .toBe('/runtime-project-root');
    });

    it('records the resolved vault path on terminal data env vars only when missing', () => {
        expect(withResolvedTmuxVaultPath({}, '/runtime-project-root')).toEqual({
            VOICETREE_VAULT_PATH: '/runtime-project-root',
        });
        expect(withResolvedTmuxVaultPath({VOICETREE_VAULT_PATH: '/initial-vault'}, '/runtime-project-root'))
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
