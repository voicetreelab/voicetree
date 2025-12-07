As you make progress on the task, create detailed visual updates by adding nodes to our markdown tree using:

```bash
python3 "$VOICETREE_APP_SUPPORT"/tools/add_new_node.py "Progress Name" "<markdown content...>" [relationship] [--parent <parent_file_path>]
```
**CLI Syntax:**
- `name` - Name/title of the new node
- `markdown_content` - Markdown Content for the node's markdown file
- Optional: `relationship` - Optional. Relationship type (e.g., `solves_the_problem`). Omit unless the relationship is speciific and meaningful.
- Optional: `--parent <file>` - Omit. Only use to override the default parent (`$CONTEXT_NODE_PATH`)

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