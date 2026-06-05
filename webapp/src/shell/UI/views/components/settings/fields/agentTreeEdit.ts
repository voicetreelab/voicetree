import type {AgentConfig} from '@vt/graph-model/settings';

/** An index path into the agent tree: [2] = 3rd top-level node, [2,0] = its 1st child. */
export type AgentPath = readonly number[];

function mapAt(agents: readonly AgentConfig[], path: AgentPath, fn: (node: AgentConfig) => AgentConfig): AgentConfig[] {
    if (path.length === 0) throw new Error('agentTreeEdit: empty path');
    const [head, ...rest] = path;
    return agents.map((node: AgentConfig, index: number): AgentConfig => {
        if (index !== head) return node;
        if (rest.length === 0) return fn(node);
        return {...node, children: mapAt(node.children ?? [], rest, fn)};
    });
}

/** Shallow-merge `patch` into the node at `path`. */
export function updateAgentAt(agents: readonly AgentConfig[], path: AgentPath, patch: Partial<AgentConfig>): AgentConfig[] {
    return mapAt(agents, path, (node: AgentConfig): AgentConfig => ({...node, ...patch}));
}

/** Remove the node at `path`. */
export function removeAgentAt(agents: readonly AgentConfig[], path: AgentPath): AgentConfig[] {
    if (path.length === 0) throw new Error('agentTreeEdit: empty path');
    const index: number = path[path.length - 1];
    const parentPath: AgentPath = path.slice(0, -1);
    if (parentPath.length === 0) return agents.filter((_, i) => i !== index);
    return mapAt(agents, parentPath, (parent: AgentConfig): AgentConfig => ({
        ...parent,
        children: (parent.children ?? []).filter((_, i) => i !== index),
    }));
}

/** Append `child` to the children of the node at `parentPath` (creating the array if absent). */
export function addChildAt(agents: readonly AgentConfig[], parentPath: AgentPath, child: AgentConfig): AgentConfig[] {
    if (parentPath.length === 0) throw new Error('agentTreeEdit: use appendAgent for a top-level node');
    return mapAt(agents, parentPath, (parent: AgentConfig): AgentConfig => ({
        ...parent,
        children: [...(parent.children ?? []), child],
    }));
}

/** Append a new top-level node. */
export function appendAgent(agents: readonly AgentConfig[], node: AgentConfig): AgentConfig[] {
    return [...agents, node];
}
