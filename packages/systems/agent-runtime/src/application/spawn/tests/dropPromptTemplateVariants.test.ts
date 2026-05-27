import {describe, expect, it} from 'vitest';
import {dropPromptTemplateVariants} from '../buildTerminalEnvVars';

describe('dropPromptTemplateVariants', () => {
    it('drops AGENT_PROMPT_<variant> template keys that fed $VAR expansion', () => {
        const result = dropPromptTemplateVariants({
            AGENT_PROMPT_CORE: 'core body',
            AGENT_PROMPT_LIGHTWEIGHT: 'lite body',
            AGENT_PROMPT_PREVIOUS_BACKUP: 'backup body',
            AGENT_PROMPT: 'expanded prompt',
            FOO: 'bar',
        });

        expect(result).toEqual({
            AGENT_PROMPT: 'expanded prompt',
            FOO: 'bar',
        });
    });

    it('keeps AGENT_PROMPT and AGENT_PROMPT_FILE', () => {
        const result = dropPromptTemplateVariants({
            AGENT_PROMPT: 'expanded prompt',
            AGENT_PROMPT_FILE: '/vault/.voicetree/terminals/Aki-prompt.txt',
            AGENT_PROMPT_CORE: 'core body',
        });

        expect(result).toEqual({
            AGENT_PROMPT: 'expanded prompt',
            AGENT_PROMPT_FILE: '/vault/.voicetree/terminals/Aki-prompt.txt',
        });
    });

    it('passes through unrelated entries unchanged', () => {
        const result = dropPromptTemplateVariants({
            VOICETREE_TERMINAL_ID: 'Aki',
            DEPTH_BUDGET: '10',
            CONTEXT_NODE_PATH: '/vault/ctx.md',
        });

        expect(result).toEqual({
            VOICETREE_TERMINAL_ID: 'Aki',
            DEPTH_BUDGET: '10',
            CONTEXT_NODE_PATH: '/vault/ctx.md',
        });
    });
});
