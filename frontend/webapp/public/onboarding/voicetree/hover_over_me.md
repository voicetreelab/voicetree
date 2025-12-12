---
position:
  x: 1224.0497467419023
  y: -1415.7337281886587
isContextNode: false
---
# Hover Over Me

Above me you will see all the actions you can perform on a node. The two most important are adding a child node, and running a node.

Hovering on a node opens its floating editor.

It supports all *standard* markdown plus:

**code blocks:**
```typescript
while (true) {
  const x : string = "Hello World!"
  ...
}
```
**mermaid diagram blocks:**
```mermaid
flowchart LR
      A((Voice)) --> B((Tree))
```

You can add edges to other nodes by adding a wikilink with double square brackets to another nodes path like so: [[[to_the_other_nodes_relative_or_absolute_path.md]]]


Some other features:
[[command_palette.md]]
[[other_features.md]]
[[run_me.md]]