import {describe, expect, it} from 'vitest';
import type {TerminalId} from '../terminal-registry/types';
import {
    buildTmuxEnv,
    resolveHeadfulPromptInjection,
    resolvePromptFileWrite,
    resolveTmuxProjectPath,
    withResolvedTmuxProjectPath,
    withVoicetreeProjectPath,
} from '../tmux/tmuxSpawnPlanning';

const terminalId: TerminalId = 'Aki' as TerminalId;

describe('tmux spawn planning', () => {
    it('prefers terminal env project path over inherited process env', () => {
        expect(resolveTmuxProjectPath(
            {VOICETREE_PROJECT_PATH: '/process-vault'},
            {VOICETREE_PROJECT_PATH: '/initial-vault'},
        )).toBe('/initial-vault');
    });

    it('falls back to the initial env project path', () => {
        expect(resolveTmuxProjectPath({}, {VOICETREE_PROJECT_PATH: '/initial-vault'}))
            .toBe('/initial-vault');
    });

    it('falls back to the runtime project root when no env project path exists', () => {
        expect(resolveTmuxProjectPath({}, {}, '/runtime-project-root'))
            .toBe('/runtime-project-root');
    });

    it('falls back to the runtime project root before inherited process env', () => {
        expect(resolveTmuxProjectPath({VOICETREE_PROJECT_PATH: '/process-vault'}, {}, '/runtime-project-root'))
            .toBe('/runtime-project-root');
    });

    it('falls back to inherited process env only when no runtime project path exists', () => {
        expect(resolveTmuxProjectPath({VOICETREE_PROJECT_PATH: '/process-vault'}, {}))
            .toBe('/process-vault');
    });

    it('records the resolved project path on terminal data env vars only when missing', () => {
        expect(withResolvedTmuxProjectPath({}, '/runtime-project-root')).toEqual({
            VOICETREE_PROJECT_PATH: '/runtime-project-root',
        });
        expect(withResolvedTmuxProjectPath({VOICETREE_PROJECT_PATH: '/initial-vault'}, '/runtime-project-root'))
            .toEqual({VOICETREE_PROJECT_PATH: '/initial-vault'});
        expect(withResolvedTmuxProjectPath({}, undefined)).toBeUndefined();
    });

    it('backfills VOICETREE_PROJECT_PATH and drops non-string runtime values', () => {
        const env = withVoicetreeProjectPath({
            FOO: 'bar',
            NUMBERY: 123 as unknown as string,
        }, '/vault');

        expect(env).toEqual({
            FOO: 'bar',
            VOICETREE_PROJECT_PATH: '/vault',
        });
    });

    it('keeps an explicit initial project path', () => {
        const env = withVoicetreeProjectPath({
            VOICETREE_PROJECT_PATH: '/initial-vault',
            FOO: 'bar',
        }, '/process-vault');

        expect(env).toEqual({
            VOICETREE_PROJECT_PATH: '/initial-vault',
            FOO: 'bar',
        });
    });

    it('plans a prompt file write only when both project path and prompt exist', () => {
        expect(resolvePromptFileWrite('/vault', terminalId, 'task body')).toEqual({
            projectRoot: '/vault',
            terminalId,
            prompt: 'task body',
        });
        expect(resolvePromptFileWrite(undefined, terminalId, 'task body')).toBeNull();
        expect(resolvePromptFileWrite('/vault', terminalId, undefined)).toBeNull();
    });

    it('buildTmuxEnv adds AGENT_PROMPT_FILE alongside AGENT_PROMPT and backfills project path', () => {
        const env = buildTmuxEnv({
            AGENT_PROMPT: 'large prompt',
            FOO: 'bar',
        }, '/vault', '/vault/.voicetree/terminals/Aki-prompt.txt');

        expect(env).toEqual({
            AGENT_PROMPT: 'large prompt',
            FOO: 'bar',
            AGENT_PROMPT_FILE: '/vault/.voicetree/terminals/Aki-prompt.txt',
            VOICETREE_PROJECT_PATH: '/vault',
        });
    });

    it('buildTmuxEnv keeps an explicit initial project path and drops non-string runtime values', () => {
        const env = buildTmuxEnv({
            VOICETREE_PROJECT_PATH: '/initial-vault',
            NUMBERY: 123 as unknown as string,
        }, '/process-vault', null);

        expect(env).toEqual({
            VOICETREE_PROJECT_PATH: '/initial-vault',
        });
    });

    it('plans headful prompt injection whenever there is an initial command', () => {
        expect(resolveHeadfulPromptInjection(terminalId, 'codex "$AGENT_PROMPT"'))
            .toEqual({terminalId, command: 'codex "$AGENT_PROMPT"'});
        expect(resolveHeadfulPromptInjection(terminalId, undefined)).toBeNull();
    });
});
