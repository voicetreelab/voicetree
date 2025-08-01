The task will be given after these initial instructions.

As you make progress on the task, create visual updates by adding nodes to our markdown tree using the `add_new_node.py` tool.

## Usage:
```bash
python add_new_node.py <parent_file> "<name>" "<content>" <relationship> [--color <color>]
```

### Arguments:
- `parent_file`: Path to parent markdown file (e.g., `yc_demo/3_1_Agent_Module.md`)
- `name`: Node title (use quotes if multiple words)
- `content`: Node description (use quotes)
- `relationship`: Link type (e.g., `is_a_component_of`, `is_a_feature_of`, `implements`)
- `--color`: Optional node color (default: blue, options: red, green, yellow, etc.)

### Examples:[demo_prompt_wait.md](../demo_prompt_wait.md)
```bash
# Create a blue component node
python add_new_node.py yc_demo/3_1_Agent_Module.md "Task Manager" "Manages task queues" is_a_component_of

# Create a red feature node
python add_new_node.py yc_demo/3_1_Agent_Module.md "Error Handler" "Handles exceptions" is_a_feature_of --color red
```

The file you've been opened from is $OBSIDIAN_SOURCE_NOTE: @$OBSIDIAN_SOURCE_NOTE

As you complete todo items, grow the tree, by creating new nodes either at this file, or at your other newly created nodes.

Please now wait for the user to tell you the specific task.

