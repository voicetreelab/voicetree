Goal, given a query, and a concept tree, output the relevant nodes of the concept tree, tree structure linearized.

entry point for module: retrieve_context.py

this can be also be run like a tool `python retrieve_context.py dir query`

This should: 
1. load markdown to tree ds
2. get similar nodes to query (get_most_relevant_nodes in graph_search) 
3. Traverse to those nodes from the roots of the tree, and include some of the chlidren (so overall distance 5 away from target nodes). Also include n=3 neighborhood from target node, BUT NOT any other neighborhood. 
4. then linearize this. backend/markdown_tree_manager/graph_flattening/tree_flattening.py
5. output that
