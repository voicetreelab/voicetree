"""
API for common functions on top of tree ds

e.g. get summareis
"""
import json
from typing import Dict, Any, List
from copy import deepcopy

from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import Node


def get_node_summaries(decision_tree, max_nodes) -> str:
    """
    Get node summaries from decision tree
    
    Args:
        decision_tree: Decision tree object with tree attribute containing nodes
        max_nodes: Maximum number of recent nodes to include
        
    Returns:
        String with node summaries
    """
    node_summaries = []
    node_ids = decision_tree.get_recent_nodes(max_nodes)
    for node_id in node_ids:
        node = decision_tree.tree[node_id]
        if hasattr(node, 'title') and hasattr(node, 'summary'): # todo, title or name?
            node_summaries.append(f"{node.title}: {node.summary}")
    
    return "\n".join(node_summaries) if node_summaries else "No existing nodes yet"


def get_most_relevant_nodes(decision_tree, limit: int) -> List:
    """
    Select most relevant nodes when tree exceeds limit
    
    Strategy:
    1. Include root nodes (up to 25% of limit)
    2. Include recently modified nodes (up to 50% of limit)  
    3. Fill remaining slots with nodes sorted by branching factor
    
    Args:
        decision_tree: DecisionTree instance
        limit: Maximum number of nodes to return
        
    Returns:
        List of Node objects (copies to ensure read-only)
    """
    if not decision_tree.tree:
        return []
    
    # If tree has fewer nodes than limit, return all
    if len(decision_tree.tree) <= limit:
        return [deepcopy(node) for node in decision_tree.tree.values()]
    
    # Collect root nodes
    root_nodes = []
    for node_id, node in decision_tree.tree.items():
        if node.parent_id is None:
            root_nodes.append(node_id)
    
    # Get recent nodes sorted by modification time
    all_nodes_by_recency = sorted(
        decision_tree.tree.items(),
        key=lambda x: x[1].modified_at,
        reverse=True
    )
    
    # Build selected set
    selected = set()
    
    # Include root nodes (up to 25% of limit)
    root_limit = min(len(root_nodes), limit // 4)
    for i in range(root_limit):
        selected.add(root_nodes[i])
    
    # Fill up to 50% more slots with recent nodes
    for node_id, node in all_nodes_by_recency:
        if len(selected) >= (3*limit) // 4:
            break
        selected.add(node_id)
    
    # Fill remaining slots with nodes by branching factor
    remaining_slots = limit - len(selected)
    if remaining_slots > 0:
        nodes_by_branching = decision_tree.get_nodes_by_branching_factor(remaining_slots)
        for node_id in nodes_by_branching:
            if node_id not in selected:
                selected.add(node_id)
                if len(selected) >= limit:
                    break
    
    # Return Node objects (copies) in consistent order
    result = []
    for node_id in sorted(selected):
        result.append(deepcopy(decision_tree.tree[node_id]))
    
    return result


def _format_nodes_for_prompt(nodes: List[Node], tree: Dict[int, Node] = None) -> str:
    """Format nodes for LLM prompt in a consistent, readable format"""
    if not nodes:
        return "No nodes available"
    
    formatted_nodes = []
    formatted_nodes.append("===== Available Nodes =====")
    
    for node in nodes:
        node_entry = []
        node_entry.append(f"Node ID: {node.id}")
        node_entry.append(f"Title: {node.title}")
        node_entry.append(f"Summary: {node.summary}")
        
        if node.parent_id:
            node_entry.append(f"Relationship: {node.relationships[node.parent_id]} to '{tree[node.parent_id].title}'")

        formatted_nodes.append("\n".join(node_entry))
        formatted_nodes.append("-" * 40)
    
    formatted_nodes.append("==========================")
    
    return "\n".join(formatted_nodes)