---
color: green
position:
  x: 1137
  y: -1598
isContextNode: false
---
# Generate codebase graph (run me)

### Your task is to run the following workflow

1. **Explore** the codebase (use explore subagents)
2. **Identify** the top ~7 major modules
3. **Create a node** for each module containing:
    - Concise purpose summary
    - Mermaid diagrams for the core flow
    - Notable gotchas or tech debt
There is no need for you or the subagents to create an additional progress node, the module nodes already satisfy this requirement.
4. **Spawn voicetree agents** on each module to break it down one level further

## Constraints

- **Max 7 modules** per level
- **Tree structure**: each node links only to its direct parent
- **Depth limit**: subagents do NOT spawn further agents
