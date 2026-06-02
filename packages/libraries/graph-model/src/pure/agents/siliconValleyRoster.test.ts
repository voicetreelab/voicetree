import {describe, it, expect} from 'vitest';
import {AGENT_NAMES, getNextAgentName, getUniqueAgentName} from '../settings/types';
import {
    SILICON_VALLEY_ROSTER,
    SILICON_VALLEY_IDS,
    baseIdFromAgentName,
    lookupPersona,
    renderPersonaSoul,
    getAgentNamePool,
    pickAgentName,
} from './siliconValleyRoster';

describe('SILICON_VALLEY_ROSTER integrity', () => {
    it('exposes 11 characters with unique ids', () => {
        expect(SILICON_VALLEY_ROSTER).toHaveLength(11);
        const ids: readonly string[] = SILICON_VALLEY_ROSTER.map(p => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('ids are single safe tokens usable as tmux session names / registry keys', () => {
        for (const persona of SILICON_VALLEY_ROSTER) {
            expect(persona.id).toMatch(/^[A-Za-z0-9]+$/);
        }
    });

    it('every character has a non-empty full name and blurb', () => {
        for (const persona of SILICON_VALLEY_ROSTER) {
            expect(persona.fullName.length).toBeGreaterThan(0);
            expect(persona.blurb.length).toBeGreaterThan(0);
        }
    });

    it('SILICON_VALLEY_IDS mirrors the roster order', () => {
        expect(SILICON_VALLEY_IDS).toEqual(SILICON_VALLEY_ROSTER.map(p => p.id));
    });
});

describe('baseIdFromAgentName', () => {
    it('returns the name unchanged when there is no collision suffix', () => {
        expect(baseIdFromAgentName('Richard')).toBe('Richard');
    });

    it('strips a single _1 collision suffix', () => {
        expect(baseIdFromAgentName('Richard_1')).toBe('Richard');
    });

    it('strips recursively appended suffixes (Richard_1_1)', () => {
        expect(baseIdFromAgentName('Richard_1_1')).toBe('Richard');
    });
});

describe('lookupPersona', () => {
    it('finds a persona by exact id', () => {
        expect(lookupPersona('Gilfoyle')?.fullName).toBe('Bertram Gilfoyle');
    });

    it('finds a persona through a collision suffix', () => {
        expect(lookupPersona('Richard_1_1')?.id).toBe('Richard');
    });

    it('returns undefined for a neutral (non-character) name', () => {
        expect(lookupPersona('Ian')).toBeUndefined();
    });

    it('is case-sensitive — lowercase ids are not roster characters', () => {
        expect(lookupPersona('richard')).toBeUndefined();
    });
});

describe('renderPersonaSoul', () => {
    it('embeds the full name and blurb', () => {
        const persona = SILICON_VALLEY_ROSTER.find(p => p.id === 'Gavin')!;
        const soul: string = renderPersonaSoul(persona);
        expect(soul).toContain('Gavin Belson');
        expect(soul).toContain(persona.blurb);
        expect(soul).toContain('Silicon Valley');
    });
});

// The "what happens when we run out of names?" case the feature was designed for.
describe('pool exhaustion and collision (the "richard_2?" question)', () => {
    it('cycles through the whole Silicon Valley pool, then wraps', () => {
        const seen: string[] = [];
        for (let i = 0; i < SILICON_VALLEY_IDS.length; i++) {
            seen.push(getNextAgentName(SILICON_VALLEY_IDS));
        }
        // One full cycle yields every character exactly once, whatever the start offset.
        expect(new Set(seen).size).toBe(SILICON_VALLEY_IDS.length);
        expect([...seen].sort()).toEqual([...SILICON_VALLEY_IDS].sort());
        // The next call necessarily repeats an already-used name — i.e. a collision
        // the registry must resolve via getUniqueAgentName.
        expect(SILICON_VALLEY_IDS).toContain(getNextAgentName(SILICON_VALLEY_IDS));
    });

    it('resolves a wrap-collision with _1 (NOT _2) and the persona still maps back', () => {
        const taken: ReadonlySet<string> = new Set(['Gilfoyle']);
        const unique: string = getUniqueAgentName('Gilfoyle', taken);
        expect(unique).toBe('Gilfoyle_1');
        // The suffixed agent still channels Gilfoyle's soul.
        expect(lookupPersona(unique)?.id).toBe('Gilfoyle');
    });

    it('resolves a double collision to _1_1, still mapping to the base persona', () => {
        const taken: ReadonlySet<string> = new Set(['Richard', 'Richard_1']);
        const unique: string = getUniqueAgentName('Richard', taken);
        expect(unique).toBe('Richard_1_1');
        expect(lookupPersona(unique)?.id).toBe('Richard');
    });
});

describe('getAgentNamePool', () => {
    it('returns the neutral pool by default (mode unset — the user must opt in)', () => {
        expect(getAgentNamePool({})).toBe(AGENT_NAMES);
    });

    it('returns the Silicon Valley pool only when mode is explicitly on', () => {
        expect(getAgentNamePool({siliconValleyMode: true})).toBe(SILICON_VALLEY_IDS);
    });

    it('returns the neutral pool when mode is explicitly off', () => {
        expect(getAgentNamePool({siliconValleyMode: false})).toBe(AGENT_NAMES);
    });
});

describe('pickAgentName', () => {
    it('draws from the Silicon Valley roster when the mode is explicitly on', () => {
        const name: string = pickAgentName({siliconValleyMode: true});
        expect(SILICON_VALLEY_IDS).toContain(name);
    });

    it('draws from the neutral pool by default (mode unset)', () => {
        const name: string = pickAgentName({});
        expect(AGENT_NAMES).toContain(name);
    });

    it('draws from the neutral pool when the mode is off', () => {
        const name: string = pickAgentName({siliconValleyMode: false});
        expect(AGENT_NAMES).toContain(name);
    });
});
