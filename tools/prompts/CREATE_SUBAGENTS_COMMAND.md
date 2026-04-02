# Orchestrating Subagents

**Use `decompose_subtask_dependency_graph.md` for decomposition patterns and `subtask_template.md` for subtask structure.**

## Core Process

1. **Decompose** — sketch the dependency graph (see `decompose_subtask_dependency_graph.md`)
2. **Create nodes** — use `create_graph` MCP tool with `$VOICETREE_TERMINAL_ID`
3. **Spawn agents** — use `mcp__voicetree__spawn_agent` per subtask node
4. **Wait and review** — use `mcp__voicetree__wait_for_agents`

## Decision: Delegate vs Do Yourself

**Delegate** when: task is focused, context-bounded, and independent of sibling work.
**Do yourself** when: task requires full orchestration context or combines multiple pieces of work.

Why: each agent is a bounded processor. Coupling between agents costs superlinearly — keep inter-agent dependencies minimal.

## Naming

- Assign each subagent a unique name and color
- Subtask files: `<agent_name>_subtask_name`
