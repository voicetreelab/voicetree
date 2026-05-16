import {describe, expect, it} from 'vitest';
import type {TerminalId} from '../terminal-registry/types';
import {
    buildTmuxEnv,
    resolveHeadfulPromptInjection,
    resolvePromptFileWrite,
    resolveTmuxVaultPath,
    withResolvedTmuxVaultPath,
} from '../tmuxSpawnPlanning';

const terminalId = 'Aki' as TerminalId;

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

    it('plans a prompt file write only when both vault path and prompt exist', () => {
        expect(resolvePromptFileWrite('/vault', terminalId, 'task body')).toEqual({
            vaultPath: '/vault',
            terminalId,
            prompt: 'task body',
        });
        expect(resolvePromptFileWrite(undefined, terminalId, 'task body')).toBeNull();
        expect(resolvePromptFileWrite('/vault', terminalId, undefined)).toBeNull();
    });

    it('filters AGENT_PROMPT, sets the empty override, adds prompt file, and backfills vault path', () => {
        const env = buildTmuxEnv({
            AGENT_PROMPT: 'large prompt',
            FOO: 'bar',
        }, '/vault', '/vault/.voicetree/terminals/Aki-prompt.txt');

        expect(env).toEqual({
            FOO: 'bar',
            AGENT_PROMPT: '',
            AGENT_PROMPT_FILE: '/vault/.voicetree/terminals/Aki-prompt.txt',
            VOICETREE_VAULT_PATH: '/vault',
        });
    });

    it('keeps an explicit initial vault path and drops non-string runtime values', () => {
        const env = buildTmuxEnv({
            VOICETREE_VAULT_PATH: '/initial-vault',
            NUMBERY: 123 as unknown as string,
        }, '/process-vault', null);

        expect(env).toEqual({
            VOICETREE_VAULT_PATH: '/initial-vault',
            AGENT_PROMPT: '',
        });
    });

    it('plans headful prompt injection only when there is a prompt file and command', () => {
        expect(resolveHeadfulPromptInjection(terminalId, 'codex "$AGENT_PROMPT"', '/prompt.txt'))
            .toEqual({terminalId, command: 'codex "$AGENT_PROMPT"', promptFilePath: '/prompt.txt'});
        expect(resolveHeadfulPromptInjection(terminalId, undefined, '/prompt.txt')).toBeNull();
        expect(resolveHeadfulPromptInjection(terminalId, 'codex "$AGENT_PROMPT"', null)).toBeNull();
    });
});
