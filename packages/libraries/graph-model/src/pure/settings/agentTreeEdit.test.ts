import {describe, it, expect} from 'vitest';
import type {AgentConfig} from './types';
import {updateAgentAt, removeAgentAt, addChildAt, appendAgent} from './agentTreeEdit';

const TREE: readonly AgentConfig[] = [
    {name: 'Claude', command: 'claude'},
    {name: 'Codex', command: 'codex', children: [
        {name: 'Local', children: [{name: 'Medium', env: {EFFORT: 'medium'}}]},
    ]},
];

describe('agentTreeEdit', () => {
    it('updateAgentAt patches a nested node without disturbing siblings', () => {
        const out = updateAgentAt(TREE, [1, 0, 0], {env: {EFFORT: 'xhigh'}});
        expect(out[1].children?.[0].children?.[0].env).toEqual({EFFORT: 'xhigh'});
        expect(out[0]).toEqual(TREE[0]); // sibling untouched
    });

    it('removeAgentAt removes a top-level node', () => {
        expect(removeAgentAt(TREE, [0]).map(n => n.name)).toEqual(['Codex']);
    });

    it('removeAgentAt removes a deeply nested node', () => {
        const out = removeAgentAt(TREE, [1, 0, 0]);
        expect(out[1].children?.[0].children).toEqual([]);
    });

    it('addChildAt appends a child to a nested node', () => {
        const out = addChildAt(TREE, [1, 0], {name: 'XHigh', env: {EFFORT: 'xhigh'}});
        expect(out[1].children?.[0].children?.map(c => c.name)).toEqual(['Medium', 'XHigh']);
    });

    it('appendAgent adds a new top-level node', () => {
        expect(appendAgent(TREE, {name: 'Gemini', command: 'gemini'}).map(n => n.name))
            .toEqual(['Claude', 'Codex', 'Gemini']);
    });

    it('edits are immutable (input tree is not mutated)', () => {
        const snapshot = JSON.stringify(TREE);
        updateAgentAt(TREE, [1, 0, 0], {env: {EFFORT: 'xhigh'}});
        removeAgentAt(TREE, [0]);
        addChildAt(TREE, [1, 0], {name: 'X', command: 'x'});
        expect(JSON.stringify(TREE)).toBe(snapshot);
    });
});
