Use the `create_graph` MCP tool with `$VOICETREE_TERMINAL_ID` to add nodes. One call, 1+ nodes. The tool handles frontmatter, file paths, parent linking, and graph positioning automatically.
You may also create nodes using manual filesystem .md writes, and [[to_add_edge_to_example_node_xyz]].  

**Why structure matters:** Each item at one level costs the reader superlinearly — 5 items costs more than 5x what 1 costs. This is why both splitting and merging have costs. Design law: minimize items per level + minimize dependency between items. Structure is not preference — it's computational necessity for bounded processors.

Use Voicetree agents over built-in subagents: users can see progress, read nodes, and intervene if performing mistakes or stuck. 
But if interaction from user is highly unlikely necessary, (i.e. no chance the subagent could fail at the given task), you can use your built-in subagents, or headless VT agents if you don't have.

## When & how to Split Into Multiple Nodes?

- FOR ALL TASKS

Given an argument in pseudocode, decompose it into a graph of nodes that optimally serves both human understanding and agent analysis.

Too few nodes → monolithic, no structure exposed, can't view the information at a higher level of abstraction. (There's no conceptual (boxes and arrows) view)

Too many nodes → fragmented, graph noise drowns signal, View 1 is useless. 

Nodes, but the graph struture not helpful in representing the structure of the informatioin  (e.g. 1 parent with 20 children all related, sure it's technically true, but there's a more accurate graph view that better represents the structure


/// <Example>TODO add example of a parent with many children, better restructured to be a DAG structure </Example>

How do you achieve a great mindmap structure for conveying the relevant information? 

1. Decide what's relevant (what's the situation? a handover? an explanation? a world context?). What would someone re-looking at this mindmap want to see?
2. Decide structural view of that relevant information
3. key concepts (most important to hold in attention)

potentially relevant context that you want to still save, but it's not critical, these can be considered as 'details', and added to within a nodes content, NOT be represented by the structural view (concept names + relationship edges + edge names), since that would crowd attention.

- Additionally, FOR SOFTWARE ENGINEERING
Generally, One node = one important chunk. (A chunk could be 7 moderately important related concepts, or 1 important concept, 7 important related concept can be it's own sub-graph, with its folder becoming its compound node ~ equivocal to moving N nodes under one common parent, which is a great way to re-organise because then you have only "method" in the interface to that subgraph, or inversely only one dependency, or only one connection to it amongst a larger graph (i.e. the global world model), which is key because it reduces complexity, making it more understandable), just like when architecting a codebase to decouple a component, by extracting it into a pure function (i.e. the parent/compound node) Split when independently referenceable (options to compare, decisions to revisit, distinct phases). Keep together when tightly coupled.

**Boundary test** (apply at each level):
1. **Extract?** Does naming this as a separate node reduce parent cost? Must absorb ≥2 dimensions — if extracting doesn't hide complexity, it adds a name without reducing slots (N+1 toxin).
2. **Merge?** Remove this node — does the parent get harder? If not, keep inline.
Quick test: "Could a reader act on this without the sibling nodes?" YES → own node. NO → keep in parent.

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

If the output nodes you have to create aren't strictly SWE orchestration outputs, and benefit from more flexible mindmap structures,
then please read [[]]

Wire multi-node graphs using `parents` (local ids within the same call). Nodes without `parents` attach to your task node by default. Tree structure (containment) = optional attention cost — reader can zoom in or skip. Wikilink edges = forced attention cost — reader must follow. Use tree for hierarchy; edges only for cross-references between independent chunks.

## Scope Guidelines

| Scope | Action |
|-------|--------|
| Large/complex, user requested "tree"/"graph"/"dependency graph"/breakdown | Read `decompose_subtask_dependency_graph.md` for dependency graphs |
| Creating a technical plan | Read `prompts/SUBAGENT_PROMPT.md` for template |
| Small, one concern, <30 lines, 1-2 files | Single progress node |
| Nodes you created ARE the deliverable | Skip — progress nodes document work not visible in the graph, not node creation itself |

## Content Rules
- **Self-containment:** The node IS the deliverable. Embed all artifacts verbatim (diagrams, code, tables, mockups, analysis) — never summarize an artifact. A reader should never need to look elsewhere to understand what was produced.
- **Reader-relativity:** Write for the future reader without your context. Name domain concepts explicitly — effective_cost depends on the reader's compiled subfunctions, not yours. If a term needs zooming to understand, define or link it.
- **`summary`:** Concise summary of what was accomplished. Include key details: specifications, decisions, plans, outcomes.
- **`filesChanged`:** Always include all file paths you modified.
- **`codeDiffs`:** Include exact diffs for <40 lines of changes (production files only; omit test diffs unless tests are the main task). Over 40 lines, include only key changes. Requires `complexityScore` and `complexityExplanation`.
- **`diagram`:** Mermaid diagram when relevant — prefer text when equally clear.
- **Line limit** per node (default 70). Only `summary` + `content` fields count toward the limit. If over, split into a branching tree (see examples above) — not a linear A→B→C chain.
- **Color convention:** `green` = task completed, `blue` (default) = in-progress or planning.
- **`notes`:** Architecture impact, gotchas, tech debt, difficulties.
- **`linkedArtifacts`:** Link related artifacts (proposals, design, tasks) by basename. These render as regular markdown links in `## Related`, not graph edges.

## For the next agent (non-trivial work only)

Progress nodes are knowledge, not just receipts. Before writing your node, answer these. Put answers in `learnings`.

**1. What did you try first, and why did you change approach?**
Name the rejected path. "Tried X, switched to Y because Z." If you didn't change approach, say so.

**2. If a future agent attempts this same task, what will they get wrong?**
The non-obvious pitfall. Be concrete: "Don't try X because Y" or "The docs say X but actually Y."

**3. What would a successor agent need to believe to continue your work without repeating your reasoning?**
Compress your in-context learnings in such a way that a follow-up agent can truly understand your new mental model / understanding / key findings. Not what you did — what you now hold as true about the problem space.

Skip learnings ONLY for atomic tasks (< 5 min, single file edit, no decisions).

## Fallback
If the `create_graph` MCP tool is unavailable, read `addProgressTreeManualFallback.md` for manual markdown file creation instructions.

## Pre-creation Checklist
1. `$VOICETREE_TERMINAL_ID` is set (echo it if unsure)
2. N concerns → N nodes (split by concern, not by size)
3. All artifacts embedded verbatim in `content`
4. Diffs included in `codeDiffs` for <40 lines changed (with `complexityScore`)
5. `filesChanged` populated
6. `learnings` filled for non-trivial work

ALL `$VARS` (`VOICETREE_TERMINAL_ID`, `AGENT_COLOR`, `AGENT_NAME`, etc.) are environment variables already set. Check them now.
