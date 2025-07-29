"""
Clustering workflow driver that orchestrates the complete clustering analysis pipeline.

Takes a tree DS and updates it in place with cluster_name attributes.
"""

from typing import Dict
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import Node
from backend.text_to_graph_pipeline.tree_manager.tree_functions import _format_nodes_for_prompt
from backend.text_to_graph_pipeline.agentic_workflows.agents.clustering_agent import ClusteringAgent


async def run_clustering_analysis(tree: Dict[int, Node]) -> None:
    """
    Orchestrates the complete clustering analysis pipeline.
    
    Updates tree in place by adding cluster_name attribute to each node.
    
    Args:
        tree: Dictionary mapping node IDs to Node objects
    """
    # Extract nodes as a list
    nodes = list(tree.values())
    
    # Format nodes for the clustering agent
    formatted_nodes = _format_nodes_for_prompt(nodes, tree)
    
    # Calculate node count
    node_count = len(nodes)
    
    # Instantiate and run clustering agent
    clustering_agent = ClusteringAgent()
    clustering_response = await clustering_agent.run(formatted_nodes, node_count)
    
    # Update tree in place with cluster_name attributes
    for cluster_assignment in clustering_response.clusters:
        node_id = cluster_assignment.node_id
        if node_id in tree:
            tree[node_id].cluster_name = cluster_assignment.cluster_name