"""
API for common functions on top of tree ds

e.g. get summareis
"""
from typing import Dict, Any


def get_node_summaries(decision_tree) -> str:
    """
    Get node summaries from decision tree
    
    Args:
        decision_tree: Decision tree object with tree attribute containing nodes
        
    Returns:
        String with node summaries
    """
    node_summaries = []
    for node in decision_tree.tree.values():
        if hasattr(node, 'title') and hasattr(node, 'summary'): # todo, title or name?
            node_summaries.append(f"{node.title}: {node.summary}")
    
    return "\n".join(node_summaries) if node_summaries else "No existing nodes"