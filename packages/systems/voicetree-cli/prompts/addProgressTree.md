Use the `vt graph create` CLI with `$VOICETREE_TERMINAL_ID` exported in your environment to add progress nodes. Write each node as a markdown file under `$VOICETREE_VAULT_PATH`, then run `vt graph create <path>` (one or more positional `.md` paths per call). The CLI handles frontmatter normalization, parent linking from `[[wikilinks]]` in the body, and graph positioning automatically.

## Orchestration: Decide Before You Start
Does this task have 2+ distinct concerns or phases?

YES → Decompose and spawn:
1. Create nodes for each subtask (one node = one concern)
2. Spawn voicetree agents (`vt agent spawn`) to work in parallel
3. Wait (`vt agent wait`) and review their work

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

Wire multi-node graphs by including `[[parent-basename]]` wikilinks in each child node's body. The CLI's filesystem authoring builds parent edges from those wikilinks. Nodes without any wikilinks attach to your task node by default.

## Scope Guidelines

| Scope | Action |
|-------|--------|
| Large/complex, user requested "tree"/"graph"/"dependency graph"/breakdown | Read `decompose_subtask_dependency_graph.md` for dependency graphs |
| Creating a technical plan | Read `prompts/SUBAGENT_PROMPT.md` for template |
| Small, one concern, <30 lines, 1-2 files | Single progress node |
| Nodes you created ARE the deliverable | Skip — progress nodes document work not visible in the graph, not node creation itself |

## Content Rules
- **Self-containment:** The node IS the deliverable. Embed all artifacts verbatim (diagrams, code, tables, mockups, analysis) — never summarize an artifact. A reader should never need to look elsewhere to understand what was produced.
- **Title (`# H1`):** Concise one-line description of what was accomplished.
- **`## Summary`:** Brief recap of key details: specifications, decisions, plans, outcomes.
- **`## Files Changed`:** Always include all file paths you modified.
- **`## DIFF`:** Include exact diffs for <40 lines of changes (production files only; omit test diffs unless tests are the main task). Over 40 lines, include only key changes.
- **`## Diagram`:** Mermaid diagram when relevant — prefer text when equally clear.
- **Line limit** per node (default 70). If over, split into a branching tree (see examples above) — not a linear A→B→C chain.
- **Color convention:** `green` for completed work, `blue` (default) for in-progress or planning. Set via frontmatter `color: green` or the CLI's `--color green` flag.
- **`## NOTES`:** Architecture impact, gotchas, tech debt, difficulties.
- **Link openspec artifacts** (proposal, design, tasks) in a `## Related` section by basename, e.g. `- [proposal](proposal.md)`.

## CLI invocation

Write the node markdown to `$VOICETREE_VAULT_PATH/<title-sluggified>.md`, then:

```bash
vt graph create "$VOICETREE_VAULT_PATH/<title-sluggified>.md"
```

For multiple nodes in one tree, write each file with its `[[parent-basename]]` wikilinks, then pass all paths in one call:

```bash
vt graph create \
  "$VOICETREE_VAULT_PATH/root.md" \
  "$VOICETREE_VAULT_PATH/child-a.md" \
  "$VOICETREE_VAULT_PATH/child-b.md"
```

Add `--validate-only` to dry-run (parses + schema-gates without writing). Add `--color green` to default unspecified nodes to green.

### Schema gate (folder-note dispatch)

If you are writing into a subfolder that has a folder note declaring `## Type: <kind>` (the public-VT walk-up resolver finds it), the CLI runs a schema validator before writing. On rejection it exits non-zero with structured JSON on stderr. Read the violations, correct the failing H2 sections in your body, and re-run the same command. The gate is silent when no upstream Type is declared — no impact on create, no `skipped` status in the report.

## Pre-creation Checklist
1. `$VOICETREE_TERMINAL_ID` is set (echo it if unsure).
2. N concerns → N files. Split by concern, not by size.
3. All artifacts embedded verbatim in the body.
4. Diffs included in `## DIFF` for <40 lines changed.
5. `## Files Changed` populated.
6. `[[parent-basename]]` wikilinks set on each child node.

ALL `$VARS` (`VOICETREE_TERMINAL_ID`, `AGENT_COLOR`, `AGENT_NAME`, `VOICETREE_VAULT_PATH`, etc.) are environment variables already set. Check them now.
