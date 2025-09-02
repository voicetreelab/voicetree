# Connect Orphan Nodes Prompt

You are analyzing orphan nodes (nodes without parents) in a knowledge tree. Your task is to identify which orphans could be grouped under a synthetic parent node to connect and clarify the tree structure.


## Input: Orphan Nodes + their children for context

{{roots_context}}

## Your Task

For each pair or group of orphan nodes, ask yourself:
1. How are these nodes related? Be a detective - the relationship may be transitive (through an intermediate concept). What are the concept nodes actually about? Is there a connection between them? Try explain how they may be connected.
2. Try finish this sentence: 1. node_A and node_B are related since...

This relationiship could be: 
    - similar types of abstractions. (node_A and node_B are both ___.)
    - related semantically / contextually (node_A is related to a larger plan that will unlock node_B) this will often be transitive, not direct.

2. What would be the name and description of a synthetic parent node which could connect node_A -> synthetic_parent <- node_B
- what would be the names of the relationships to the child nodes to the parent? i.e node_A <relatioinship_to> synthetic_parent
