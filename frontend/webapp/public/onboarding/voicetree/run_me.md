---
color: green
position:
  x: 1066.797573497235
  y: -1658.6428998501397
isContextNode: false
---
# Run me (generates task tree)

Your task is to produce a small task dependency tree of nodes representing the actions (tasks) the user should attempt for a comprehensive onboarding to voicetree.

## Example Output Format (Diamond Dependency Tree)

```md
# Voice Input Into Nodes & Terminals
Select any node or terminal, then speak - your voice goes directly into it.

How it works:
- Click a node to select it, then hold record - transcription appears as a chip on the node
- Focus a terminal, hold record - your speech becomes terminal input
- No need to type everything - dictate commands, edits, or new content

This lets you talk to agents naturally while they're running.

- [[getting_started.md]]
```

```md
# Works Amazingly With OpenSpec
VoiceTree pairs perfectly with OpenSpec for AI-assisted development.

Just tell your agent: "Please create an OpenSpec change proposal for this feature" - the markdown files will appear in the graph.

- [[getting_started.md]]
```

```md
# Create Linked Nodes
Now that you've created some nodes, link them together manually.

How to link:
1. Hover a node and click the "+" button to add a child
2. Or type `[[other_node.md]]` in any node's content to create an edge
3. Cmd+drag to select multiple nodes, then link them

Tip: Wikilinks autocomplete - start typing `[[` and suggestions appear.

- [[try_voice_input.md]]
```

```md
# Create Custom Agents
Add your own agents via the settings file. Any CLI command can become an agent.

How to add:
1. Open settings (floating menu on right, or ~/Library/Application Support/VoiceTree/settings.json)
2. Add an entry to the `agents` array with name and command
3. New agents automatically appear in the horizontal menu dropdown

Example agent entry:
{ "name": "my-agent", "command": "claude --model sonnet" }

The first agent in the array is the default (triggered by Cmd+Enter).

Parents:
- [[create_linked_nodes.md]]
- [[try_text_input.md]]
```

Run this task completely using a haiku subagent, don't do anything yourself.