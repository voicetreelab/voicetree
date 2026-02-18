---
color: green
position:
  x: 1137
  y: -1598
isContextNode: false
---
# Generate codebase graph (run me)

### Your task is to run the following workflow

1. **Quick scan** — identify the top ~7 major modules using lightweight exploration only (glob directory listings, read a few entry points). Do NOT deep-dive into any module. The goal is just module names, root paths, and a one-line purpose each.
2. **Create a skeleton node** for each module containing only:
    - Module name and root path
    - One-line purpose
    - A distinct color per module (submodules inherit color)
3. **Spawn one voicetree agent per module**. Each agent is responsible for:
    - Deep-exploring its module (read key files, trace flows)
    - Updating its parent node with: concise purpose summary, mermaid diagram for core flow, notable gotchas or tech debt
    - Breaking the module down into up to 7 submodule child nodes

There is no need for you or the subagents to create an additional progress node, the module nodes already satisfy this requirement.

## Constraints

- **Max 7 modules** per level
- **Tree structure**: each node links only to its direct parent
- **Depth limit**: subagents do NOT spawn further agents
- **Orchestrator stays lightweight**: do not use explore subagents or read deeply into module internals — delegate that to the per-module agents
