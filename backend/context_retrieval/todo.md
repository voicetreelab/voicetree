
- need to come up with a fairly good way of flattening tree + multiple traversals paths

This could look like:

- Always include roots
  - Have big picture, overview nodes / roots. (Orphan connection, take important context)
- Path to target. (? which direction ?)
- ***emph on target nodes (? or unnecessary and lead to over emphasis)
- OKAY: 
  - Cheap LLM gets tree structure, query, initial traversals to 10% 
  - Is told to generate search queries. (Prompt based, you are a search agent)


Todo:

- create more example questions from QA dataset. What's accuracy? What's reduction?


- define our tree structure invariants. How hierarchical is it? What is its structure? Why?

- need to implement query Qn+1 logic.

- Need to improve core algo for tree creation. Nodes too fragmented. (Optimizer? Segmentation?)


- 