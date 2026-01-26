---
color: green
position:
  x: 1160.0130773638646
  y: -1582.361462834373
isContextNode: false
---
# Generate codebase graph (run me)

Your task is to create a knowledge graph made out of Markdown nodes which represents this codebase at a high level. Each node should have a concise summary of the module's main purpose, and a sentence or two of gotchas or tech debt you found. You can use explore subagents to help you with exploring codebase.

The graph should be mostly a tree, so no more than one edge per node linking to its parent.

Limit to a maximum of 7 modules at any given level.  

For each module you create, spawn a voicetree agent to run this exact same workflow on the given module to break it down further into a subgraph of submodules. Do not recurse more than one level deep. Subagents should not recurse further.

**IMPORTANT:** When creating child nodes, link them ONLY to their direct parent node. Do NOT create links back to the grandparent or ancestor nodes - this creates transitive edges that clutter the graph.



