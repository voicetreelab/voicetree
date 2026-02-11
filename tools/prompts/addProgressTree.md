As you make progress on the task, create detailed visual updates by adding nodes to our Markdown tree.

## Orchestration: Decide Before You Start
Does this task have 2+ distinct concerns or phases?

YES → Decompose and spawn:
1. Create nodes for each subtask (one node = one concern)
2. Spawn voicetree agents (`mcp__voicetree__spawn_agent`) to work in parallel
3. Wait (`mcp__voicetree__wait_for_agents`) and review their work

See `decompose_subtask_dependency_graph.md` for graph structure patterns.

NO → Proceed directly (single concern, < 30 lines, 1-2 files).

Voicetree agents over built-in subagents: users can see progress, read nodes, and intervene.

## When to Create Multiple Linked Nodes (Prefer This)
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

Each node: self-contained, focused on ONE concern, linked to parent with wikilinks.

## Scope Guidelines

| Scope | Action |
|-------|--------|
| Large/complex, user requested "tree"/"graph"/"dependency graph"/breakdown | Read `decompose_subtask_dependency_graph.md` for dependency graphs |
| Creating a technical plan | Read `prompts/SUBAGENT_PROMPT.md` for template |
| Small, one concern, <30 lines, 1-2 files | Single progress node |
| Nodes you created ARE the deliverable | Skip — progress nodes document work not visible in the graph, not node creation itself |

## Progress Node Format
Create at: `$VOICETREE_VAULT_PATH/{node_title_sluggified}.md`

Always include a list of all file paths you have modified.
Include exact diff if <40 lines changed (production files only; omit test diffs unless tests are the main task). Over 40 lines, include only key changes.

```markdown
---
color: $AGENT_COLOR ?? blue
agent_name: $AGENT_NAME
---

# {Title}

## {Concise summary of progress / what was accomplished}

Key details: specifications, decisions, plans, outcomes.

## Files Changed (always include)

## DIFF (if files changed)

\```<language>
- old
+ new
\```

Additional files changed: `file1.md`, `file2.py` — with concise summaries.

## Diagram (if relevant — prefer text when equally clear)

\```mermaid
[flowchart | graph | sequenceDiagram | classDiagram | gitGraph]
\```

### NOTES (if relevant)
- System architecture impact, dependencies, workflow effects
- Difficulties, technical debt, gotchas
- Complexity score for the area worked in

## Spec files (if created openspec/similar)
Link key artifacts: proposal, design, tasks — skip individual deltas unless they contain key decisions.

REQUIRED: {relationship_label} [[$TASK_NODE_PATH]]
```

## Pre-write Checklist
1. `$AGENT_COLOR` unset → default `blue`
2. Wikilink paths are relative to `$VOICETREE_VAULT_PATH`
3. Parent linked via `[[$TASK_NODE_PATH]]` (only override when necessary). Only `[[double brackets]]` create graph edges — single brackets don't.
4. Relationship labels: specific and meaningful, or omitted
5. Minimize `[[wikilinks]]` — each creates a visible edge. Keep as tree/DAG.

ALL `$VARS` are environment variables already set. Check them now.
