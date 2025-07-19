
1. Segment to atomic idea / units of thought
2. For each segment identify most relevant node, or if no relevant node, a new  node (LLM answer Q: what would a hypothetical most relevant node be called)
3. Append to that Node
-----------
4. For each modified node, run sinle_abstraction_optimsation prompt. Which attempts to solve [[backend/text_to_graph_pipeline/agentic_workflows/VoiceTree_Math.md]] with different [[backend/text_to_graph_pipeline/agentic_workflows/single_abstraction_optimiser_approach.md]] 
	1. It can return the following TreeActions: 
		1. split (break node into multiple nodes, with relationships defined between them).

Edge case for orphan nodes, group together in a temp node, which we will then run the single_abstraction_optimisation prompt on.