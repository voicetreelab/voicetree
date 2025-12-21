As you make progress on the task, create detailed visual updates by adding nodes to our markdown tree using:

```bash
python3 "$VOICETREE_APP_SUPPORT"/tools/add_new_node.py "Progress Name" "<markdown content...>" [--relationship <relationship>] [--parent <file>] [--parents <file1,file2,...>]
```
**CLI Syntax:**
- `name` - Name/title of the new node
- `markdown_content` - Markdown Content for the node's markdown file
The following are optional parameters which you should not include unless necessary:
- Optional: `--relationship <type>` - Relationship type (e.g., `--relationship solves_the_problem`). Omit unless the relationship is specific and meaningful.
- Optional: `--parent <file>` - Omit. Only use to override the default parent (`$CONTEXT_NODE_PATH`) which is already set.
- Optional: `--parents <file1,file2,...>` - Comma-separated list for multiple parents (diamond dependencies). Use when a node depends on multiple other nodes completing.
- Optional: `--color <color>` - Omit. Your agent color (`$AGENT_COLOR`) is used by default.
- Optional: `--agent-name <name>` - Omit. Defaults to your agent name.

When creating nodes, your content should:

Start with a brief description of what was accomplished. Keep it highly concise.
Always include a list of all the file paths you have modified.

1. If the changes involve < 40 lines of code changes to production files. Include the exact diff in the markdown. Do not include test file diff unless that is your main task, or includes important logic.

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
</MARKDOWN new node Format Template>

This tool will automatically:
- Use your color ($AGENT_COLOR)
- Create proper node IDs and filenames
- Add correct YAML frontmatter
- Create parent-child links

If the python tool is broken, you may write the markdown file manually to the vault directory: `$OBSIDIAN_VAULT_PATH`, with a wikilink included in the body to [[$CONTEXT_NODE_PATH]]

If you have been told to decompose the task, create a dependency graph, or you are creating a plan that involves multiple phases you must read $VOICETREE_APP_SUPPORT/tools/prompts/decompose_subtask_dependency_graph.md before adding a node.