import {describe, it, expect} from 'vitest';
import type {AgentConfig} from './types';
import {
    type ResolvedAgent,
    composeAgentStep,
    isAgentCategory,
    flattenAgentTree,
    collectResolvableCommands,
    resolveDefaultAgent,
    agentPathLabel,
    mapAgentTreeByCommand,
} from './agentTree';

/**
 * The migrated Codex tree the feature exists to support: one EFFORT knob drives
 * both the Local branch (expanded into a `-c` flag) and the Remote branch
 * (expanded into a `CODEX_REASONING_EFFORT=` prefix the .sh launcher reads).
 */
const CODEX_TREE: readonly AgentConfig[] = [
    {name: 'Claude', command: 'claude --dangerously-skip-permissions "$AGENT_PROMPT"'},
    {
        name: 'Codex',
        command: 'codex --yolo -c "model_reasoning_effort=\\"$EFFORT\\"" "$AGENT_PROMPT"',
        children: [
            {
                name: 'Local',
                children: [
                    {name: 'Medium', env: {EFFORT: 'medium'}},
                    {name: 'XHigh', env: {EFFORT: 'xhigh'}},
                ],
            },
            {
                name: 'Remote',
                command: 'CODEX_REASONING_EFFORT="$EFFORT" bash /Users/bob/.voicetree/bin/codex-remote.sh',
                children: [
                    {name: 'Medium', env: {EFFORT: 'medium'}},
                    {name: 'XHigh', env: {EFFORT: 'xhigh'}},
                ],
            },
        ],
    },
];

const CODEX_BASE: string = 'codex --yolo -c "model_reasoning_effort=\\"$EFFORT\\"" "$AGENT_PROMPT"';
const REMOTE_BASE: string = 'CODEX_REASONING_EFFORT="$EFFORT" bash /Users/bob/.voicetree/bin/codex-remote.sh';

describe('flattenAgentTree — golden resolution of the Codex tree', () => {
    const leaves: ResolvedAgent[] = flattenAgentTree(CODEX_TREE);

    it('yields exactly the five spawnable leaves in pre-order', () => {
        expect(leaves.map(leaf => agentPathLabel(leaf.path))).toEqual([
            'Claude',
            'Codex / Local / Medium',
            'Codex / Local / XHigh',
            'Codex / Remote / Medium',
            'Codex / Remote / XHigh',
        ]);
    });

    it('Local leaves inherit the Codex base command and set only EFFORT', () => {
        const localXHigh: ResolvedAgent = leaves[2];
        expect(localXHigh.command).toBe(CODEX_BASE);
        expect(localXHigh.env).toEqual({EFFORT: 'xhigh'});
    });

    it('Remote leaves override the command and still set only EFFORT', () => {
        const remoteMedium: ResolvedAgent = leaves[3];
        expect(remoteMedium.command).toBe(REMOTE_BASE);
        expect(remoteMedium.env).toEqual({EFFORT: 'medium'});
    });

    it('Claude leaf resolves to its own command with no extra env', () => {
        expect(leaves[0].command).toBe('claude --dangerously-skip-permissions "$AGENT_PROMPT"');
        expect(leaves[0].env).toEqual({});
    });
});

describe('flattenAgentTree — robustness invariants (must hold for any tree)', () => {
    it('never emits a category node as a leaf', () => {
        for (const leaf of flattenAgentTree(CODEX_TREE)) {
            expect(leaf.name).not.toBe('Codex');
            expect(leaf.name).not.toBe('Local');
            expect(leaf.name).not.toBe('Remote');
        }
    });

    it('command = the deepest path node that defines a non-empty command', () => {
        const tree: readonly AgentConfig[] = [
            {name: 'a', command: 'A', children: [
                {name: 'b', children: [             // inherits A
                    {name: 'inherit'},              // -> A
                    {name: 'override', command: 'B'}, // -> B
                ]},
            ]},
        ];
        const byPath: Record<string, string> = Object.fromEntries(
            flattenAgentTree(tree).map(l => [agentPathLabel(l.path), l.command]),
        );
        expect(byPath['a / b / inherit']).toBe('A');
        expect(byPath['a / b / override']).toBe('B');
    });

    it('env shallow-merges down the path with deeper-wins precedence', () => {
        const tree: readonly AgentConfig[] = [
            {name: 'root', command: 'cmd', env: {SHARED: 'root', ONLY_ROOT: 'r'}, children: [
                {name: 'leaf', env: {SHARED: 'leaf', ONLY_LEAF: 'l'}},
            ]},
        ];
        expect(flattenAgentTree(tree)[0].env).toEqual({SHARED: 'leaf', ONLY_ROOT: 'r', ONLY_LEAF: 'l'});
    });

    it('a flat legacy list flattens to itself (superset property)', () => {
        const flat: readonly AgentConfig[] = [
            {name: 'Gemini', command: 'gemini -i "$AGENT_PROMPT"'},
            {name: 'Codex', command: 'codex --yolo "$AGENT_PROMPT"'},
        ];
        expect(flattenAgentTree(flat)).toEqual([
            {name: 'Gemini', path: ['Gemini'], command: 'gemini -i "$AGENT_PROMPT"', env: {}},
            {name: 'Codex', path: ['Codex'], command: 'codex --yolo "$AGENT_PROMPT"', env: {}},
        ]);
    });
});

describe('collectResolvableCommands — the daemon validation set', () => {
    it('contains every leaf command so a valid leaf is never rejected', () => {
        const commands: Set<string> = collectResolvableCommands(CODEX_TREE);
        for (const leaf of flattenAgentTree(CODEX_TREE)) {
            expect(commands.has(leaf.command)).toBe(true);
        }
    });

    it('collapses leaves that share a base command (Local Medium/XHigh)', () => {
        // Both Local leaves resolve to CODEX_BASE; they differ only by env.
        expect(collectResolvableCommands(CODEX_TREE).has(CODEX_BASE)).toBe(true);
    });
});

describe('resolveDefaultAgent', () => {
    it('matches the full path label first', () => {
        expect(resolveDefaultAgent(CODEX_TREE, 'Codex / Remote / XHigh')?.command).toBe(REMOTE_BASE);
        expect(resolveDefaultAgent(CODEX_TREE, 'Codex / Remote / XHigh')?.env).toEqual({EFFORT: 'xhigh'});
    });

    it('falls back to a leaf name match, then to the first leaf', () => {
        expect(resolveDefaultAgent(CODEX_TREE, 'Claude')?.name).toBe('Claude');
        expect(resolveDefaultAgent(CODEX_TREE, 'does-not-exist')?.name).toBe('Claude');
        expect(resolveDefaultAgent(CODEX_TREE)?.name).toBe('Claude');
    });
});

describe('isAgentCategory', () => {
    it('is true only for nodes with children', () => {
        expect(isAgentCategory({name: 'Codex', command: 'x', children: [{name: 'L', command: 'y'}]})).toBe(true);
        expect(isAgentCategory({name: 'leaf', command: 'y'})).toBe(false);
        expect(isAgentCategory({name: 'empty', command: 'y', children: []})).toBe(false);
    });
});

describe('mapAgentTreeByCommand — recursive command rewrite (Claude toggles)', () => {
    it('rewrites a matching command at any depth, preserving structure', () => {
        const tree: readonly AgentConfig[] = [
            {name: 'Claude', command: 'claude X'},
            {name: 'Group', command: 'claude X', children: [{name: 'nested', command: 'claude X'}]},
            {name: 'Other', command: 'gemini'},
        ];
        const out = mapAgentTreeByCommand(tree, 'claude X', 'claude X --auto');
        expect(out[0].command).toBe('claude X --auto');
        expect(out[1].command).toBe('claude X --auto');
        expect(out[1].children?.[0].command).toBe('claude X --auto');
        expect(out[2].command).toBe('gemini'); // untouched
    });
});
