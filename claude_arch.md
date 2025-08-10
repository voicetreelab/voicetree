want:

- claude to be able to reliably write markdown files to the tree, with the correct color, etc...

- claude to get notified of new nodes that appeared on the graph, if at all possibly relevant. 

Possible solutions

- telling claude to just write markdown files (what we have right now). main problem: it forgets what color to write with
- python tool that adds nodes with correct color, given name, content, etc.
- claude hooks
- claude mcp
- claude subagents

Note, This is for a different use case to voicetree core algo. This is if for when you spawn an agent in our UI on top of an existing node, the agent (like claude code or gemini       │
│   code) will update its progress as it goes by adding nodes to the tree (which are just markdown files)                                                       │
│                                                                                                                  