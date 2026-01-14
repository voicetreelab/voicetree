As you make progress on the task, create detailed visual updates by adding nodes to our markdown tree.

**Create a new markdown file** at:
```
$VOICETREE_VAULT_PATH/slugified({node_title}).md
```

Where `slugified()` converts to lowercase, replaces spaces with underscores, removes special characters.

**File template:**
```markdown
---
color: $AGENT_COLOR ?? blue
agent_name: $AGENT_NAME
---
# {node_title}

{markdown_content}

- <optional_relationship_to> [[{relative_path_to_parent}]] (multiple parent links OK when necessary, e.g. diamond dependencies))
```

- If `$AGENT_COLOR` is unset, default to `blue`
- Wikilink paths are relative to `$VOICETREE_VAULT_PATH`
- Use `$CONTEXT_NODE_PATH` as the default parent to link your node to
- For multiple parents: use `Parents:` header with multiple `- [[path]]` entries
- Optional relationship labels: `- solves_the_problem [[path]]`


What type of node to create:
1. Create multiple linked nodes if:
    - User explicitly requested a "tree", "graph", "dependency graph", or task breakdown/decomposition
    - You're planning a large and complex implementation which naturally lends itself to being broken down.

If either applies you must now read `decompose_subtask_dependency_graph.md` first.

2. Otherwise, for straightforward plans, create a planning node, read `prompts/SUBAGENT_PROMPT.md` for a rough starting point but make modifications/simplifications to suit the task.

3. Otherwise, create a single progress node using the template below:

When creating progress nodes, your content should:

Start with a brief description of what was accomplished. Keep it highly concise.
Always include a list of all the file paths you have modified.

1. If the changes involve < 40 lines of code changes to production files. Include the exact diff in the markdown. Do not include test file diff unless that is your main task, or includes important logic. If >40 lines of code, include only the key changes.

2. If the changes involve architectural changes, include a mermaid diagram for visual representation of the change/architecture/flow. Do not include a diagram if it's easier to explain as text.

<MARKDOWN new node Format Template>

##Summary, concise high level description of what was accomplished


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
- Important notes, gotchas
If relevant, include how this change affects the overall system, dependencies, or workflow.
If relevant, include difficulties you faced in accomplishing this task, tech debt which made it hard.
</OPTIONAL>

<OPTIONAL but ENCOURAGED>
## Related Files
If you created any other markdown files during this session (e.g. OpenSpec proposals, specs, documentation), link to them:
- [[path/to/created_file.md]] - brief description
This creates graph edges connecting your progress node to related artifacts.
</OPTIONAL but ENCOURAGED>
</MARKDOWN new node Format Template>

**Important**: Use double brackets `[[link]]` for edges, not single `[link]`. Only `[[wikilinks]]` create graph edges.

