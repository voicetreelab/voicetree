import type {AgentConfig} from './types';

/**
 * A spawnable agent — the result of resolving one root→leaf path through the
 * agent tree. This is the unit that actually gets launched: a concrete command
 * plus the environment accumulated along its path.
 */
export interface ResolvedAgent {
    /** Display label of the leaf itself (the last path segment). */
    readonly name: string;
    /** Full root→leaf path of node names, e.g. ['Codex', 'Remote', 'XHigh']. */
    readonly path: readonly string[];
    /**
     * The command of the deepest node on the path that defines a non-empty
     * command. Empty only if no node on the path defines one (a misconfigured
     * leaf), which callers should treat as not spawnable.
     */
    readonly command: string;
    /** Shallow-merge of every node's `env` along the path; deeper nodes win. */
    readonly env: Readonly<Record<string, string>>;
}

const EMPTY_ENV: Readonly<Record<string, string>> = Object.freeze({});

/** A node is a (non-spawnable) category iff it has children. */
export function isAgentCategory(node: AgentConfig): boolean {
    return (node.children?.length ?? 0) > 0;
}

/** Human-readable label for a resolved path, e.g. 'Codex / Remote / XHigh'. */
export function agentPathLabel(path: readonly string[]): string {
    return path.join(' / ');
}

/**
 * Compose one tree node onto the (command, env) inherited from its ancestors.
 * This is the single source of truth for how a child "just adds parameters":
 *   - command: the node's own command wins if non-empty, else it is inherited.
 *   - env:     shallow-merge — the node's own keys override inherited ones.
 */
export function composeAgentStep(
    inherited: {readonly command: string; readonly env: Readonly<Record<string, string>>},
    node: AgentConfig,
): {readonly command: string; readonly env: Readonly<Record<string, string>>} {
    const command: string = node.command && node.command.length > 0 ? node.command : inherited.command;
    const env: Readonly<Record<string, string>> = node.env
        ? {...inherited.env, ...node.env}
        : inherited.env;
    return {command, env};
}

/**
 * Depth-first flatten of an agent tree into its spawnable leaves (nodes without
 * children), each resolved to its composed command + env, in pre-order.
 *
 * A flat list with no `children` anywhere flattens to itself (each entry is a
 * leaf resolving to its own command with empty env) — so the tree model is a
 * strict superset of a plain `{name, command}[]`.
 */
export function flattenAgentTree(agents: readonly AgentConfig[]): ResolvedAgent[] {
    const out: ResolvedAgent[] = [];
    const walk = (
        node: AgentConfig,
        inherited: {readonly command: string; readonly env: Readonly<Record<string, string>>},
        path: readonly string[],
    ): void => {
        const composed = composeAgentStep(inherited, node);
        const here: readonly string[] = [...path, node.name];
        if (isAgentCategory(node)) {
            for (const child of node.children ?? []) walk(child, composed, here);
        } else {
            out.push({name: node.name, path: here, command: composed.command, env: composed.env});
        }
    };
    for (const agent of agents) walk(agent, {command: '', env: EMPTY_ENV}, []);
    return out;
}

/**
 * Every distinct, non-empty command a leaf can resolve to — the exact set the
 * daemon validates an incoming command against. Built from {@link flattenAgentTree}
 * so a valid leaf command is never rejected.
 */
export function collectResolvableCommands(agents: readonly AgentConfig[]): Set<string> {
    return new Set(flattenAgentTree(agents).map(leaf => leaf.command).filter(command => command.length > 0));
}

/**
 * Resolve the default spawnable leaf. `defaultAgentName` is matched against the
 * full path label ('Codex / Remote / XHigh') first, then a leaf's own name, and
 * finally falls back to the first leaf in the tree.
 */
export function resolveDefaultAgent(
    agents: readonly AgentConfig[],
    defaultAgentName?: string,
): ResolvedAgent | undefined {
    const leaves: ResolvedAgent[] = flattenAgentTree(agents);
    if (defaultAgentName) {
        const byPath: ResolvedAgent | undefined = leaves.find(leaf => agentPathLabel(leaf.path) === defaultAgentName);
        if (byPath) return byPath;
        const byName: ResolvedAgent | undefined = leaves.find(leaf => leaf.name === defaultAgentName);
        if (byName) return byName;
    }
    return leaves[0];
}

/**
 * Recursively rewrite every node in the tree whose OWN command equals `oldCommand`
 * to use `newCommand`, returning a new tree (structure preserved). Used by the
 * Claude-specific toggles (first-run permission popup, Auto-run) that edit the
 * command that defines a resolved leaf, wherever it sits in the tree.
 */
export function mapAgentTreeByCommand(
    agents: readonly AgentConfig[],
    oldCommand: string,
    newCommand: string,
): readonly AgentConfig[] {
    return agents.map((node: AgentConfig): AgentConfig => {
        const rewrittenCommand: string = node.command === oldCommand ? newCommand : node.command;
        const rewrittenChildren: readonly AgentConfig[] | undefined = node.children
            ? mapAgentTreeByCommand(node.children, oldCommand, newCommand)
            : undefined;
        return {...node, command: rewrittenCommand, ...(rewrittenChildren ? {children: rewrittenChildren} : {})};
    });
}
