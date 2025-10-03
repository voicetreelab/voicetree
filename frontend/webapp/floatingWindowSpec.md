This is the actual spec I want:                                                       


We want to start simple, any floating window ALWAYS is attached to a node.

I.e. any floatingWindow, can be added to cytoscape with one command. e.g. .addFloatingWindow()


- moves perfectly with that node position updates.
- zooms with graph, staying fixed in graph space.
- any other graph interactions (pans, etc.) also make the floatingWindow move so it's fixed in graph
  space
- can have edges to other nodes in the graph

under the hood this can be supported with a cytoscape node that it has a two way anchor to. 

