The task will be given after these initial instructions.

As you make progress on the task, create visual updates by adding nodes to our markdown tree using the `add_new_node.py` tool.

## Usage:
```bash
python3 add_new_node.py <parent_file> "<name>" "<content>" <relationship> [--color <color>]
```

### Arguments:
- `parent_file`: Path to parent markdown file (e.g., `yc_demo/3_1_Agent_Module.md`)
- `name`: Node title (use quotes if multiple words)
- `content`: Node description (use quotes)
- `relationship`: Link type (e.g., `is_a_component_of`, `is_a_feature_of`, `implements`)
- `--color`: Optional node color (default: blue, options: red, green, yellow, etc.)

### Agent Color:
This agent session has been assigned the color: **$AGENT_COLOR**
Please use this color when creating nodes with add_new_node.py by adding `--color $AGENT_COLOR` to your commands.

### Examples:
```bash
# Create a component node with this agent's color
python3 add_new_node.py yc_demo/3_1_Agent_Module.md "Task Manager" "Manages task queues" is_a_component_of --color $AGENT_COLOR

# Create a feature node with a specific color
python3 add_new_node.py yc_demo/3_1_Agent_Module.md "Error Handler" "Handles exceptions" is_a_feature_of --color red

# For complex content (mermaid diagrams, code blocks with special characters):
# Write to temp file first, then use $(cat) to avoid shell parsing issues
echo "complex content here" > /tmp/content.md && python3 add_new_node.py parent.md "Title" "$(cat /tmp/content.md)" relationship --color $AGENT_COLOR
```

### Important Note:
When adding nodes with complex content (mermaid diagrams, multi-line code blocks, or content with shell metacharacters like `{}`, `|`, `>`, `?`), the direct command may fail due to shell parsing issues. In such cases:

1. Write the content to a temporary file first
2. Use `$(cat /tmp/file)` to pass the content as a parameter
3. This avoids bash interpreting special characters in the content

The file you've been opened from is $OBSIDIAN_SOURCE_NOTE: @$OBSIDIAN_SOURCE_NOTE

As you complete todo items, grow the tree, by creating new nodes either at this file, or at your other newly created nodes.

Please now wait for the user to tell you the specific task.

