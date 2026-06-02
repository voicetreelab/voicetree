import {describe, it, expect} from 'vitest';
import {appendPersonaToAgentPrompt} from './siliconValleyRoster';

const BASE: Record<string, string> = {AGENT_PROMPT: 'Do the task.'};

describe('appendPersonaToAgentPrompt', () => {
    it('splices a persona block for a roster character when mode is on', () => {
        const out = appendPersonaToAgentPrompt(BASE, 'Richard', {siliconValleyMode: true});
        expect(out.AGENT_PROMPT).toContain('Do the task.');
        expect(out.AGENT_PROMPT).toContain('<silicon_valley_persona>');
        expect(out.AGENT_PROMPT).toContain('Richard Hendricks');
        expect(out.AGENT_PROMPT).toContain('</silicon_valley_persona>');
    });

    it('treats unset mode as on (Silicon Valley is the default)', () => {
        const out = appendPersonaToAgentPrompt(BASE, 'Gilfoyle', {});
        expect(out.AGENT_PROMPT).toContain('Bertram Gilfoyle');
    });

    it('resolves the persona through a collision-suffixed name', () => {
        const out = appendPersonaToAgentPrompt(BASE, 'Richard_1', {siliconValleyMode: true});
        expect(out.AGENT_PROMPT).toContain('Richard Hendricks');
    });

    it('is a no-op when mode is explicitly off', () => {
        const out = appendPersonaToAgentPrompt(BASE, 'Richard', {siliconValleyMode: false});
        expect(out).toBe(BASE);
    });

    it('is a no-op for a neutral (non-character) name', () => {
        const out = appendPersonaToAgentPrompt(BASE, 'Ian', {siliconValleyMode: true});
        expect(out).toBe(BASE);
    });

    it('is idempotent — a second pass does not nest a second block', () => {
        const once = appendPersonaToAgentPrompt(BASE, 'Dinesh', {siliconValleyMode: true});
        const twice = appendPersonaToAgentPrompt(once, 'Dinesh', {siliconValleyMode: true});
        expect(twice).toBe(once);
        const occurrences: number = twice.AGENT_PROMPT.split('<silicon_valley_persona>').length - 1;
        expect(occurrences).toBe(1);
    });

    it('tolerates a missing AGENT_PROMPT key', () => {
        const out = appendPersonaToAgentPrompt({}, 'Monica', {siliconValleyMode: true});
        expect(out.AGENT_PROMPT).toContain('Monica Hall');
    });
});
