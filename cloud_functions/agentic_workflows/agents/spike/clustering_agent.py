# """
# ClusteringAgent - Analyzes and clusters VoiceTree nodes by semantic similarity
# """
#
# import math
# from typing import List, Union, Dict, Any, Optional
# from langgraph.graph import END
#
# from ..core.agent import Agent
# from ..core.state import ClusteringAgentState
# from ..models import TagResponse
#
#
# class ClusteringAgent(Agent):
#     """Agent that clusters nodes by semantic similarity of titles and summaries"""
#
#     def __init__(self):
#         super().__init__("ClusteringAgent", ClusteringAgentState)
#         self._setup_workflow()
#
#     def _setup_workflow(self):
#         """Single prompt workflow"""
#         self.add_prompt_node(
#             "clustering",
#             TagResponse,
#             model_name="gemini-2.5-flash"
#         )
#         self.add_dataflow("clustering", END)
#
#     async def run(self, formatted_nodes: str, node_count: int,
#                   existing_tags: Optional[List[str]] = None,
#                   target_unique_tags: Optional[int] = None,
#                   total_nodes: Optional[int] = None) -> TagResponse:
#         """Analyze and assign tags to nodes by semantic similarity
#
#         Args:
#             formatted_nodes: Output from _format_nodes_for_prompt()
#             node_count: Number of nodes in this batch
#             existing_tags: List of tags already used in previous batches
#             target_unique_tags: Target number of unique tags for entire tree
#             total_nodes: Total number of nodes in entire tree
#
#         Returns:
#             TagResponse with multi-tag assignments
#         """
#
#         # Use provided target or calculate from batch size
#         if target_unique_tags is None:
#             # Fallback to old behavior if not provided
#             target_clusters = max(1, round(math.log(node_count))) if node_count > 1 else 1
#         else:
#             target_clusters = target_unique_tags
#
#         # Create initial state
#         initial_state: ClusteringAgentState = {
#             "formatted_nodes": formatted_nodes,
#             "node_count": node_count,
#             "target_clusters": target_clusters,
#             "existing_tags": existing_tags,
#             # Agent response field
#             "clustering_response": None
#         }
#
#         # Run workflow
#         app = self.compile()
#         result = await app.ainvoke(initial_state)
#
#         # Extract clustering response
#         clustering_response = result.get("clustering_response") if result else None
#         if clustering_response:
#             return clustering_response
#
#         # Fallback empty response
#         return TagResponse(tags=[])
