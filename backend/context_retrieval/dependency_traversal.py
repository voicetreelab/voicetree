#!/usr/bin/env python3
"""
Dependency traversal module for context retrieval.
"""

import re
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Dict, List, Optional, Set

# Import load_node from markdown_to_tree module
from backend.markdown_to_tree.node_loader import load_node
from backend.markdown_to_tree.link_extraction import extract_markdown_links

# Import ContentLevel from Casey's module to ensure consistency
from backend.context_retrieval.content_filtering import ContentLevel


@dataclass
class TraversalOptions:
    """Options for controlling graph traversal."""
    include_children: bool = False
    include_parents: bool = True
    max_depth: int = 10
    include_neighborhood: bool = False
    neighborhood_radius: int = 1
    content_level: ContentLevel = ContentLevel.FULL_CONTENT


def extract_parent_links(content: str) -> List[str]:
    """
    Extract ALL markdown links as parent/dependency links.
    Extracted from tools/graph_dependency_traversal_and_accumulate_graph_content.py
    """
    # Simply use the existing extract_markdown_links function
    return extract_markdown_links(content)


def find_child_references(parent_filename: str, markdown_dir: Path, file_cache: Dict[str, str]) -> List[str]:
    """
    Find all files that reference the parent file (i.e., children are files that link to this parent).
    A child is ANY file that contains [[parent_filename]].
    """
    children = []
    
    # Remove .md extension if present for matching
    parent_name = parent_filename.replace('.md', '')
    
    # Determine the directory of the parent file
    parent_path = markdown_dir / parent_filename
    parent_dir = parent_path.parent
    
    # Only scan markdown files in the same directory as the parent file
    for md_file in parent_dir.glob('*.md'):
        if md_file.name == 'accumulated.md':  # Skip output file
            continue
            
        relative_path = str(md_file.relative_to(markdown_dir))
        
        # Skip if this is the parent file itself
        if relative_path == parent_filename:
            continue
        
        # Get content from cache or read file
        if relative_path not in file_cache:
            node_data = load_node(relative_path, markdown_dir)
            file_cache[relative_path] = node_data['content']
        content = file_cache[relative_path]
        
        # Check if this file has ANY link to our parent file
        # Match [[filename.md]] or [[filename]] patterns
        pattern = rf'\[\[{re.escape(parent_name)}(?:\.md)?\]\]'
        if re.search(pattern, content):
            children.append(relative_path)
                
    return children


def traverse_bidirectional(
    start_file: str,
    markdown_dir: Path,
    visited: Set[str],
    file_cache: Dict[str, str],
    depth: int = 0,
    max_depth: int = 10,
    direction: str = "both"
) -> List[Dict[str, str]]:
    """
    Bidirectionally traverse the graph, following both parent and child links.
    Direction can be: 'both', 'parents', 'children'
    Extracted from tools/graph_dependency_traversal_and_accumulate_graph_content.py
    """
    if start_file in visited or depth > max_depth:
        return []
    
    visited.add(start_file)
    
    # Load node using markdown_to_tree module
    if start_file not in file_cache:
        node_data = load_node(start_file, markdown_dir)
        file_cache[start_file] = node_data['content']
    else:
        # If we have cached content, still need full node data
        node_data = load_node(start_file, markdown_dir)
        
    content = node_data['content']
    
    if not content:
        return []
    
    # Create result entry with node data
    result_entry = {
        'filename': start_file,
        'content': content,
        'depth': depth,
        'title': node_data.get('title', ''),
        'node_id': node_data.get('node_id', ''),
        'summary': node_data.get('summary', '')
    }
    
    result = [result_entry]
    
    # Traverse to parents
    if direction in ['both', 'parents']:
        parent_links = extract_parent_links(content)
        
        for parent_file in parent_links:
            # First try the link as-is (absolute path from markdown_dir)
            parent_path = markdown_dir / parent_file
            
            # If not found and link doesn't have a directory, try in the same directory as current file
            if not parent_path.exists() and '/' not in parent_file:
                current_file_dir = Path(start_file).parent
                if str(current_file_dir) != '.':
                    # Try in the same directory as the current file
                    parent_file = str(current_file_dir / parent_file)
                    parent_path = markdown_dir / parent_file
            
            if parent_path.exists():
                parent_results = traverse_bidirectional(
                    parent_file, markdown_dir, visited, file_cache, 
                    depth + 1, max_depth, 'parents'  # Only go up when following parents
                )
                result.extend(parent_results)
    
    # Traverse to children
    if direction in ['both', 'children']:
        child_files = find_child_references(start_file, markdown_dir, file_cache)
        
        for child_file in child_files:
            child_results = traverse_bidirectional(
                child_file, markdown_dir, visited, file_cache,
                depth + 1, max_depth, 'children'  # Only go down when following children
            )
            result.extend(child_results)
            
    return result


def get_path_to_node(
    target_file: str,
    markdown_dir: Path,
    max_depth: int
) -> List[Dict[str, str]]:
    """
    Traverse up from target to root, return path in root->target order.
    """
    visited = set()
    file_cache = {}
    
    # Get parents using bidirectional traversal (parents only)
    parent_results = traverse_bidirectional(
        target_file, markdown_dir, visited, file_cache,
        depth=0, max_depth=max_depth, direction='parents'
    )
    
    # Filter out the target node itself and sort by depth (descending)
    parent_path = [r for r in parent_results if r['filename'] != target_file]
    parent_path.sort(key=lambda x: x['depth'], reverse=True)
    
    return parent_path


def get_children_recursive(
    parent_file: str,
    markdown_dir: Path,
    max_depth: int
) -> List[Dict[str, str]]:
    """
    Recursively get all children up to max_depth.
    """
    visited = set()
    file_cache = {}
    
    # Get children using bidirectional traversal (children only)
    child_results = traverse_bidirectional(
        parent_file, markdown_dir, visited, file_cache,
        depth=0, max_depth=max_depth, direction='children'
    )
    
    # Filter out the parent node itself
    children = [r for r in child_results if r['filename'] != parent_file]
    
    # Adjust depths to be negative for children (opposite of parents)
    for child in children:
        child['depth'] = -abs(child['depth']) if child['depth'] != 0 else -1
    
    return children


def get_neighborhood(
    target_file: str,
    markdown_dir: Path,
    radius: int
) -> List[Dict[str, str]]:
    """
    Get nodes within N hops of target (siblings, cousins, etc).
    Finds nodes that share common parents or children with the target.
    """
    neighbors = []
    visited = set()
    file_cache = {}
    
    # Load the target node
    target_node = load_node(target_file, markdown_dir)
    if not target_node or not target_node.get('content'):
        return []
    
    # Get immediate parents of target
    target_parents = extract_parent_links(target_node['content'])
    
    # Get immediate children of target  
    target_children = find_child_references(target_file, markdown_dir, file_cache)
    
    # For each parent, find its other children (siblings of target)
    for parent_file in target_parents:
        parent_path = markdown_dir / parent_file
        if not parent_path.exists() and '/' not in parent_file:
            # Try in same directory as target
            current_dir = Path(target_file).parent
            if str(current_dir) != '.':
                parent_file = str(current_dir / parent_file)
                parent_path = markdown_dir / parent_file
        
        if parent_path.exists():
            siblings = find_child_references(parent_file, markdown_dir, file_cache)
            for sibling in siblings:
                if sibling != target_file and sibling not in visited:
                    visited.add(sibling)
                    sibling_node = load_node(sibling, markdown_dir)
                    sibling_node['depth'] = 0  # Same level as target
                    sibling_node['distance_from_target'] = 1  # One hop away
                    neighbors.append(sibling_node)
    
    # For radius > 1, could extend to cousins, etc.
    # For now, just immediate siblings
    
    return neighbors


def apply_content_filter(
    nodes: List[Dict[str, str]],
    content_level: ContentLevel
) -> List[Dict[str, str]]:
    """
    Apply content filtering based on distance from target.
    Delegates to Casey's content_filtering module.
    """
    from backend.context_retrieval.content_filtering import apply_content_filter as casey_filter
    
    # Convert depth to distance_from_target for Casey's filter
    for node in nodes:
        if 'depth' in node and 'distance_from_target' not in node:
            node['distance_from_target'] = node['depth']
    
    return casey_filter(nodes, content_level)


def traverse_to_node(
    target_file: str,
    markdown_dir: Path,
    options: TraversalOptions = TraversalOptions()
) -> List[Dict[str, str]]:
    """
    Main traversal function for context retrieval.
    Traverses to a node with specified options and returns list of node dictionaries.
    
    Args:
        target_file: The target markdown file to traverse to
        markdown_dir: Path to the markdown directory
        options: TraversalOptions controlling the traversal
        
    Returns:
        List of node dictionaries with structure:
        {
            'filename': str,
            'title': str,
            'content': str,
            'depth': int,
            'node_id': str,
            'summary': str
        }
    """
    nodes = []
    
    # Get path from root to target (parents)
    if options.include_parents:
        parent_path = get_path_to_node(target_file, markdown_dir, options.max_depth)
        nodes.extend(parent_path)
    
    # Add target node
    target_node = load_node(target_file, markdown_dir)
    target_node['depth'] = 0
    nodes.append(target_node)
    
    # Get children if requested
    if options.include_children:
        children = get_children_recursive(target_file, markdown_dir, options.max_depth)
        nodes.extend(children)
    
    # Get neighborhood if requested
    if options.include_neighborhood:
        neighbors = get_neighborhood(target_file, markdown_dir, options.neighborhood_radius)
        nodes.extend(neighbors)
    
    # Apply content filtering based on distance
    return apply_content_filter(nodes, options.content_level)