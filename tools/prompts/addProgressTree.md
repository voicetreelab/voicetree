---
position:
  x: 1878.9338711568582
  y: 1136.8224658653842
isContextNode: false
---

As you make progress on the task, create detailed visual updates by adding nodes to our Markdown tree.

## Orchestration: Decide Before You Start

**Does this task have 2+ distinct concerns or phases?**

**YES →** Decompose and spawn:
1. Create nodes for each subtask (one node = one concern)
2. Spawn voicetree agents (`mcp__voicetree__spawn_agent`) to work in parallel
3. Wait (`mcp__voicetree__wait_for_agents`) and review their work

> See `decompose_subtask_dependency_graph.md` for graph structure patterns.

**NO →** Proceed directly (single concern, < 30 lines, 1-2 files).

**Why voicetree agents over built-in subagents?** Users can see progress in the graph, read nodes, and intervene. Built-in subagents are a black box.

## When to Create Multiple Linked Nodes (Prefer This)

**Core principle: One node = one concept.** If your work involves multiple distinct concepts, ideas, or options — create a graph/tree of MULITPLE nodes, one node per concept, linked together.

### Quick Split Test

**Ask: "If the parent concept disappeared, would this content still make sense?"**
- YES → It's independent. Give it its own node.
- NO → It's an attribute. Keep it in the parent.

**Split when independently referenceable**: Options you'll compare, decisions others might revisit, phases with different outcomes.

**Keep together**: Tightly coupled problem/solution pairs, context that only makes sense with its parent.

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

If creating a technical plan, additionally read `prompts/SUBAGENT_PROMPT.md` for a flexible starting template. (Ignore this if you are using openspec)

## When a Single Progress Node is Fine

Only use a single progress node when your work is:
- Small and focused on one concern
- Under ~30 lines of changes
- Affects only 1-2 related files

## When to Skip the Progress Node Entirely
Skip if the nodes you created ARE the deliverable. Progress nodes document work not otherwise visible in   
the graph (code changes, refactors)—not node creation itself.     

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

<IF files changed> 
## DIFF 

```<coding_language>
<code_diff>
```
<example_diff>
```typescript
-   badCode([]);
+   goodCode([]);
```
</example_diff>

List of all additional files changed: e.g. `file1.md`, `file2.py`, etc.. with concise summary 
</IF files changed>

<IF diagram relevant>
\```mermaid
[Include relevant diagram type:
- flowchart: for process flows
- graph: for relationships  
- sequenceDiagram: for interactions
- classDiagram: for code structure
- gitGraph: for version changes]
\```
</IF diagram relevant>

<Notes>
### NOTES
If relevant, include how this change affects the overall system architecture, dependencies, or workflow.
If relevant, include difficulties you faced in achieving this task, for example technical debt or gotchas which made it difficult.
If relevant, Include a complexity score for the area of the codebase you had to work within, with a brief explanation of what makes it complex
</Notes>

<IF YOU CREATED SPECIFICATION FILES SUCH AS OPENSPEC>
## Spec files
Link to key OpenSpec artifacts that should appear in the graph:
```
- proposal [[openspec/changes/add-auth/proposal.md]]
- design [[openspec/changes/add-auth/design.md]]
- tasks [[openspec/changes/add-auth/tasks.md]]
```
Only link files worth revisiting (proposal, design, tasks). Skip individual spec deltas unless they contain key decisions.
</IF YOU CREATED SPECIFICATION FILES SUCH AS OPENSPEC>

<CRITICAL PARENT LINK>
<optional_relationship_label> [[$TASK_NODE_PATH]]
<example> fixes circular dependency for [[windows_build_failing.md]]</example>
</CRITICAL PARENT LINK>

</MARKDOWN new node Format Template>
```

Before writing the file, ensure you have ticked off the following checklist:
1. If `$AGENT_COLOR` is unset, default to `blue` unless there is a reason for a representative color
2. Wikilink paths are relative to `$VOICETREE_VAULT_PATH`, you must ensure your file is also saved here.
3. You linked the new file to its parent using the corrent path (env var $TASK_NODE_PATH) and double brackets. The link should be exactly `[[$TASK_NODE_PATH]]` Override only when necessary. Only double brackets create graph edges, single brackets don't.
4. Meaningful specific relationship labels used, and you have ommitted relationship lable unless it's specific and meaningful.
5. Edges are minimized: Every `[[wikilink]]` creates a visible edge in the graph. Too many edges = visual clutter. Use sparingly. Think, could I have avoided multiple wikilinks, and kept the representation as a tree/DAG?

ALL mentioned $VARS are environment variables which are already set for you. Please check them now.