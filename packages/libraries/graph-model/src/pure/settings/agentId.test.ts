import {describe, it, expect} from 'vitest';
import {
    AGENT_ID_HASH_LENGTH,
    AGENT_ID_SEPARATOR,
    agentBaseName,
    formatAgentId,
    getUniqueAgentName,
} from './types';
import {uniqueAgentName} from '../../settings';

describe('formatAgentId', () => {
    it('joins base name and hash with the separator', () => {
        expect(formatAgentId('Ayu', 'k3f')).toBe(`Ayu${AGENT_ID_SEPARATOR}k3f`);
    });
});

describe('agentBaseName', () => {
    it('strips the uniqueness hash', () => {
        expect(agentBaseName('Ayu-k3f')).toBe('Ayu');
    });

    it('round-trips with formatAgentId', () => {
        expect(agentBaseName(formatAgentId('Richard', 'z9q'))).toBe('Richard');
    });

    it('leaves a bare base name (no hash) unchanged', () => {
        expect(agentBaseName('Ayu')).toBe('Ayu');
    });

    it('strips only the trailing hash, preserving multi-token base names', () => {
        expect(agentBaseName('JianYang-7ab')).toBe('JianYang');
    });
});

describe('getUniqueAgentName', () => {
    it('appends the supplied hash to the base name', () => {
        expect(getUniqueAgentName('Sam', new Set(), () => 'q4z')).toBe('Sam-q4z');
    });

    it('regenerates until the candidate is free', () => {
        const hashes: string[] = ['aaa', 'aaa', 'ccc'];
        const taken: ReadonlySet<string> = new Set(['Sam-aaa']);
        expect(getUniqueAgentName('Sam', taken, () => hashes.shift()!)).toBe('Sam-ccc');
    });
});

describe('uniqueAgentName (random source)', () => {
    it('produces a hash of the configured length over [a-z0-9]', () => {
        const id: string = uniqueAgentName('Sam', new Set());
        const hash: string = id.slice(`Sam${AGENT_ID_SEPARATOR}`.length);
        expect(id.startsWith(`Sam${AGENT_ID_SEPARATOR}`)).toBe(true);
        expect(hash).toMatch(new RegExp(`^[a-z0-9]{${AGENT_ID_HASH_LENGTH}}$`));
    });

    it('repeated draws of one base name are distinct', () => {
        const ids: Set<string> = new Set();
        for (let index: number = 0; index < 50; index += 1) {
            ids.add(uniqueAgentName('Sam', ids));
        }
        expect(ids.size).toBe(50);
    });
});
