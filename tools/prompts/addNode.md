As you make progress on the task, create detailed visual updates by adding nodes to our Markdown tree.

## When to Create Multiple Linked Nodes (Prefer This)

Create multiple progress nodes linked as a tree when ANY of these apply:

- **Multiple concerns**: You addressed different logical concerns (e.g., bug fix + refactor + new feature)
- **Multiple file areas**: Changes span 3+ unrelated areas of the codebase
- **Sequential phases**: Work had distinct phases (research → design → implementation → validation)
- **Summarizable in parts**: Your work naturally describes as "Did X, also Y, and Z"

### Example Progress Tree

```
Parent Task
    │
Progress Summary
    │
    ├── Fix auth bug
    │
    ├── Refactor utils
    │       │
    │       ├── Extract helpers
    │       │
    │       └── Add types
    │
    └── Update tests
```

Each node is self-contained and focused on ONE concern. Link child nodes to their parent with wikilinks.

## When to Use Formal Task Decomposition

If you're planning upfront and need a dependency graph with phases:
- User explicitly requested a "tree", "graph", "dependency graph", or task breakdown/decomposition
- You're planning a large and complex implementation which naturally lends itself to being broken down.

→ Read `decompose_subtask_dependency_graph.md` first.

## When to Create a Technical Plan

If creating a technical plan, read `prompts/SUBAGENT_PROMPT.md` as well for a flexible starting point. (Ignore this if you are using openspec)

## When a Single Progress Node is Fine

Only use a single progress node when your work is:
- Small and focused on one concern
- Under ~30 lines of changes
- Affects only 1-2 related files

---

## Progress Node Template

When creating progress nodes, your content should:

Start with a brief description of the current progress of your task. Keep it concise.
Always include a list of all the file paths you have modified.

1. If the changes involve < 40 lines of code changes to production files. Include the exact diff in the markdown. Do not include test file diff unless that is your main task, or includes important logic. If >40 lines of code, include only the key changes.

2. If the changes involve architectural changes, include a mermaid diagram for visual representation of the change/architecture/flow. Do not include a diagram if it's easier to explain as text.

Create the following markdown file:
```$VOICETREE_VAULT_PATH/{node_title_sluggified}.md

<MARKDOWN new node Format Template>
---
color: $AGENT_COLOR ?? blue
agent_name: $AGENT_NAME
---

# {Title}

## {Summary, concise high level description of what was accomplished}

Key details such as specifications, decisions made, plans, outcomes, etc.

<OPTIONAL if files changed> ##DIFF 
files changed: e.g. file1.md, file2.py, etc..
```<coding_language>
<code_diff>
```
<example_diff>
```typescript
-   badCode([]);
+   goodCode([]);
```
</example_diff>

</OPTIONAL>

<optional>
\```mermaid
[Include relevant diagram type:
- flowchart: for process flows
- graph: for relationships  
- sequenceDiagram: for interactions
- classDiagram: for code structure
- gitGraph: for version changes]
\```
</optional>

<OPTIONAL>
- More notes, gotchas
If relevant, include how this change affects the overall system, dependencies, or workflow.
If relevant, include difficulties you faced in achieving this task, for example technical debt which made it hard.
</OPTIONAL>

<IF YOU MODIFIED OPENSPEC FILES>
## Related Files
If you created any Openspec markdown files during this session (e.g. proposals, specs, documentation), link to them:

- <optional_relationship_label> [[path/to/created_file.md]]
This creates graph edges connecting your progress node to related artifacts.
</IF>

<CRITICAL>
- <optional_relationship_label> [[$TASK_NODE_PATH]]
</CRITICAL>

</MARKDOWN new node Format Template>
```

- If `$AGENT_COLOR` is unset, default to `blue`
- Wikilink paths are relative to `$VOICETREE_VAULT_PATH`, you must ensure your file is also saved here.
- Use `[[$TASK_NODE_PATH]]` as the default parent to link your node to. Override when necessary.
  **Important**: Use double brackets `[[link]]` for edges, not single `[link]`. Only `[[wikilinks]]` create graph edges.
- **Minimize edges.** Every `[[wikilink]]` creates a visible edge in the graph. Too many edges = visual clutter. Use sparingly.
- Optional relationship labels: `- solves build failure [[path]]` Omit unless the relationship is specific and meaningful.

ALL mentioned $VARS are environment variables which are already set for you. Please check them now.