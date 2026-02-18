Use the `create_graph` MCP tool with `$VOICETREE_TERMINAL_ID` to add progress nodes. One call, 1+ nodes. The tool handles frontmatter, file paths, parent linking, and graph positioning automatically.

## Orchestration: Decide Before You Start
Does this task have 2+ distinct concerns or phases?

YES → Decompose and spawn:
1. Create nodes for each subtask (one node = one concern)
2. Spawn voicetree agents (`mcp__voicetree__spawn_agent`) to work in parallel
3. Wait (`mcp__voicetree__wait_for_agents`) and review their work

See `decompose_subtask_dependency_graph.md` for graph structure patterns.

NO → Proceed directly (single concern, < 30 lines, 1-2 files).

Voicetree agents over built-in subagents: users can see progress, read nodes, and intervene.

## When to Split Into Multiple Nodes
One node = one concept. Split when independently referenceable (options to compare, decisions to revisit, distinct phases). Keep together when tightly coupled.

**Split rule: If your output covers N independent concerns, create N nodes.** Quick test: "If the parent disappeared, would this content still make sense?" YES → own node. NO → keep in parent.

Create multiple nodes when:
- Multiple concerns (bug fix + refactor + new feature)
- Changes span 3+ unrelated codebase areas
- Sequential phases (research → design → implement → validate)

```
Split by concern (e.g. reviewing a diff with two unrelated change sets):
Task: Review git diff
├── Review: Collision-aware positioning refactor
└── Review: Prompt template cleanup

Split by phase + option (e.g. planning an implementation):
Task
├── High-level architecture
│   ├── Option A: Event-driven
│   └── Option B: Request-response
├── Data types
└── Pure functions
```

Wire multi-node graphs using `parents` (local ids within the same call). Nodes without `parents` attach to your task node by default.

## Scope Guidelines

| Scope | Action |
|-------|--------|
| Large/complex, user requested "tree"/"graph"/"dependency graph"/breakdown | Read `decompose_subtask_dependency_graph.md` for dependency graphs |
| Creating a technical plan | Read `prompts/SUBAGENT_PROMPT.md` for template |
| Small, one concern, <30 lines, 1-2 files | Single progress node |
| Nodes you created ARE the deliverable | Skip — progress nodes document work not visible in the graph, not node creation itself |

## Content Rules
- **Self-containment:** The node IS the deliverable. Embed all artifacts verbatim (diagrams, code, tables, mockups, analysis) — never summarize an artifact. A reader should never need to look elsewhere to understand what was produced.
- **`summary`:** Concise summary of what was accomplished. Include key details: specifications, decisions, plans, outcomes.
- **`filesChanged`:** Always include all file paths you modified.
- **`codeDiffs`:** Include exact diffs for <40 lines of changes (production files only; omit test diffs unless tests are the main task). Over 40 lines, include only key changes. Requires `complexityScore` and `complexityExplanation`.
- **`diagram`:** Mermaid diagram when relevant — prefer text when equally clear.
- **Line limit** per node (default 70). Only `summary` + `content` fields count toward the limit. If over, split into more nodes.
- **Color convention:** `green` = task completed, `blue` (default) = in-progress or planning.
- **`notes`:** Architecture impact, gotchas, tech debt, difficulties.
- **`linkedArtifacts`:** Link openspec artifacts (proposal, design, tasks) by basename.

## Fallback
If the `create_graph` MCP tool is unavailable, read `addProgressTreeManualFallback.md` for manual markdown file creation instructions.

## Pre-creation Checklist
1. `$VOICETREE_TERMINAL_ID` is set (echo it if unsure)
2. N concerns → N nodes (split by concern, not by size)
3. All artifacts embedded verbatim in `content`
4. Diffs included in `codeDiffs` for <40 lines changed (with `complexityScore`)
5. `filesChanged` populated

ALL `$VARS` (`VOICETREE_TERMINAL_ID`, `AGENT_COLOR`, `AGENT_NAME`, etc.) are environment variables already set. Check them now.
