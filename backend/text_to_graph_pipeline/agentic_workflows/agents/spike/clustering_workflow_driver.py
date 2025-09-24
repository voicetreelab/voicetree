# """
# Clustering workflow driver that orchestrates the complete clustering analysis pipeline.
#
# Takes a tree DS and updates it in place with tags attributes.
# """
#
# import math
# from typing import Dict
# from backend.markdown_tree_manager.markdown_tree_ds import Node
# from backend.markdown_tree_manager.tree_functions import _format_nodes_for_prompt
# from backend.text_to_graph_pipeline.agentic_workflows.agents.spike.clustering_agent import ClusteringAgent
#
#
# async def run_clustering_analysis(tree: Dict[int, Node]) -> None:
#     """
#     Orchestrates the complete clustering analysis pipeline.
#
#     Updates tree in place by adding tags attribute to each node.
#
#     Args:
#         tree: Dictionary mapping node IDs to Node objects
#     """
#     # Extract nodes as a list
#     nodes = list(tree.values())
#     total_nodes = len(nodes)
#
#     # Calculate target number of unique tags for the entire tree
#     # Using sqrt instead of ln for better tag diversity
#     target_unique_tags = max(1, round(math.sqrt(total_nodes))) if total_nodes > 1 else 1
#
#     # Process nodes in batches
#     batch_size = 100
#     total_tagged = 0
#
#     # Track all tags used across batches for consistency
#     all_existing_tags = set()
#
#     # Instantiate clustering agent once
#     clustering_agent = ClusteringAgent()
#
#     print(f"Total nodes to tag: {total_nodes}")
#     print(f"Target unique tags (sqrt of total): {target_unique_tags}")
#     print(f"Processing in batches of {batch_size}")
#
#     for i in range(0, total_nodes, batch_size):
#         batch_nodes = nodes[i:i + batch_size]
#         batch_num = i // batch_size + 1
#         total_batches = (total_nodes + batch_size - 1) // batch_size
#
#         print(f"\nProcessing batch {batch_num}/{total_batches} ({len(batch_nodes)} nodes)")
#
#         # Format batch nodes for the clustering agent
#         formatted_nodes = _format_nodes_for_prompt(batch_nodes, tree)
#
#         # Calculate node count for this batch
#         node_count = len(batch_nodes)
#
#         # Run clustering with retry logic
#         max_retries = 3
#         for attempt in range(max_retries):
#             try:
#                 print(f"Running clustering (attempt {attempt + 1}/{max_retries})")
#                 # Pass existing tags and target count for entire tree
#                 tagging_response = await clustering_agent.run(
#                     formatted_nodes,
#                     node_count,
#                     existing_tags=list(all_existing_tags) if all_existing_tags else None,
#                     target_unique_tags=target_unique_tags,
#                     total_nodes=total_nodes
#                 )
#                 break  # Success, exit retry loop
#             except RuntimeError as e:
#                 if "LLM returned invalid JSON" in str(e) and attempt < max_retries - 1:
#                     print(f"⚠️ Attempt {attempt + 1} failed with invalid JSON, retrying...")
#                     continue
#                 else:
#                     raise
#
#         # Update tree in place with tags attributes and accumulate tags
#         batch_tagged = 0
#         for tag_assignment in tagging_response.tags:
#             node_id = tag_assignment.node_id
#             if node_id in tree:
#                 tree[node_id].tags = tag_assignment.tags
#                 if tag_assignment.tags:  # Node has at least one tag
#                     batch_tagged += 1
#                     # Add tags to the set of all existing tags
#                     all_existing_tags.update(tag_assignment.tags)
#
#         total_tagged += batch_tagged
#         print(f"Batch {batch_num} complete: {batch_tagged} nodes tagged")
#         print(f"Total unique tags so far: {len(all_existing_tags)}")
#
#     print(f"\nTotal tagging complete: {total_tagged}/{total_nodes} nodes tagged")
#     print(f"Total unique tags created: {len(all_existing_tags)}")
