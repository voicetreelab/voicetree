"""Content filtering module for coarse-to-fine context pruning."""

from enum import Enum
from typing import List, Dict, Any, Optional, Callable, Set


class ContentLevel(Enum):
    """Enum for different levels of content detail."""
    TITLES_ONLY = 1
    TITLES_AND_SUMMARIES = 2
    FULL_CONTENT = 3


def apply_content_filter(
    nodes: List[Dict[str, Any]], 
    content_level: ContentLevel
) -> List[Dict[str, Any]]:
    """
    Apply coarse-to-fine content filtering based on distance from target.
    
    Args:
        nodes: List of node dictionaries with distance_from_target or depth field
        content_level: The maximum level of content to include
        
    Returns:
        Same list with content filtered based on distance
        
    Filtering strategy:
        - Far nodes (distance > 12): titles only
        - Medium nodes (distance 6-12): titles + summaries  
        - Close nodes (distance 0-5): full content
    """
    filtered_nodes = []
    
    for node in nodes:
        # Create a copy to avoid modifying the original
        filtered_node = node.copy()
        
        # Support both distance_from_target and depth fields
        # Convert depth to distance_from_target if needed
        if 'distance_from_target' not in filtered_node and 'depth' in filtered_node:
            filtered_node['distance_from_target'] = filtered_node['depth']
        
        distance = filtered_node.get('distance_from_target', 0)
        
        # Apply content level restrictions first
        if content_level == ContentLevel.TITLES_ONLY:
            filtered_node['summary'] = None
            filtered_node['content'] = None
        elif content_level == ContentLevel.TITLES_AND_SUMMARIES:
            filtered_node['content'] = None
        # For FULL_CONTENT, apply distance-based filtering
        elif content_level == ContentLevel.FULL_CONTENT:
            if distance > 12:
                # Far nodes: titles only
                filtered_node['summary'] = None
                filtered_node['content'] = None
            elif distance > 5:
                # Medium distance: titles + summaries
                filtered_node['content'] = None
            # Close nodes (distance 0-5): keep full content
        
        filtered_nodes.append(filtered_node)
    
    return filtered_nodes


def get_neighborhood(
    target: str,
    connections: Dict[str, List[str]],
    radius: int,
    load_node_func: Optional[Callable[[str], Dict[str, Any]]] = None
) -> List[Dict[str, Any]]:
    """
    Get nodes within N hops of target using breadth-first search.
    
    Args:
        target: The target node filename
        connections: Dictionary mapping filenames to their connected nodes
        radius: Maximum distance (hops) from target to include
        load_node_func: Optional function to load node data
        
    Returns:
        List of nodes within radius, with distance_from_target field
    """
    if radius == 0:
        return []
    
    visited = set()
    queue = [(target, 0)]
    neighbors = []
    
    while queue:
        current, distance = queue.pop(0)
        
        # Skip if we've seen this node or exceeded radius
        if current in visited or distance > radius:
            continue
            
        visited.add(current)
        
        # Skip the target itself
        if current != target and distance > 0:
            if load_node_func:
                node = load_node_func(current)
            else:
                node = {'filename': current}
            
            node['distance_from_target'] = distance
            neighbors.append(node)
        
        # Add connected nodes to queue
        if current in connections:
            for connected in connections[current]:
                if connected not in visited:
                    queue.append((connected, distance + 1))
    
    return neighbors


def calculate_distance(node: Dict[str, Any], target_id: str) -> int:
    """
    Calculate or retrieve the distance from a node to the target.
    
    Args:
        node: Node dictionary
        target_id: ID or filename of the target node
        
    Returns:
        Distance from target (0 if it is the target)
    """
    # If distance is already calculated, return it
    if 'distance_from_target' in node:
        return node['distance_from_target']
    
    # If this is the target, distance is 0
    if node.get('filename') == target_id or node.get('node_id') == target_id:
        return 0
    
    # Default to using depth if available
    return node.get('depth', 0)