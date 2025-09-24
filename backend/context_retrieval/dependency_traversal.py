#!/usr/bin/env python3
"""
Dependency traversal module for context retrieval.
"""

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from typing import Union

from backend.types import NodeData
from backend.types import NodeDict
from backend.types import NodeList
from backend.types import NodesGrouping
from backend.types import TraversalResult

# Import ContentLevel and apply_content_filter from content_filtering module
from backend.context_retrieval.content_filtering import ContentLevel
from backend.context_retrieval.content_filtering import apply_content_filter
from backend.markdown_tree_manager.markdown_to_tree.link_extraction import (
    extract_markdown_links,
)

# Import load_node from markdown_to_tree module
from backend.markdown_tree_manager.markdown_to_tree.node_loader import load_node


@dataclass
class TraversalOptions:
    """Options for controlling graph traversal."""
    include_children: bool = False
    include_parents: bool = True
    max_depth: int = 10
    include_neighborhood: bool = False
    neighborhood_radius: int = 1
    content_level: ContentLevel = ContentLevel.FULL_CONTENT


def extract_parent_links(content: str) -> list[str]:
    """
    Extract ALL markdown links as parent/dependency links.
    Extracted from tools/graph_dependency_traversal_and_accumulate_graph_content.py
    """
    # Simply use the existing extract_markdown_links function
    return extract_markdown_links(content)


def find_child_references(parent_filename: str, markdown_dir: Path, file_cache: dict[str, str]) -> list[str]:
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
            content_key = 'content'
            content_val = node_data[content_key]
            file_cache[relative_path] = content_val if isinstance(content_val, str) else str(content_val)
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
    visited: set[str],
    file_cache: dict[str, str],
    depth: int = 0,
    max_depth: int = 10,
    direction: str = "both"
) -> NodeList:
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
        content_key = 'content'
        content_val = node_data[content_key]
        file_cache[start_file] = content_val if isinstance(content_val, str) else str(content_val)
    else:
        # If we have cached content, still need full node data
        node_data = load_node(start_file, markdown_dir)

    content_key = 'content'
    content_raw = node_data[content_key]
    content = content_raw if isinstance(content_raw, str) else str(content_raw)

    if not content:
        return []

    # Create result entry with node data
    result_entry: TraversalResult = {
        'filename': start_file,
        'content': content,
        'depth': depth,
        'title': node_data.get('title', ''),
        'node_id': node_data.get('node_id', ''),
        'summary': node_data.get('summary', '')
    }

    result: NodeList = [result_entry]

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
) -> NodeList:
    """
    Traverse up from target to root, return path in root->target order.
    """
    visited: set[str] = set()
    file_cache: dict[str, str] = {}

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
) -> NodeList:
    """
    Recursively get all children up to max_depth.
    """
    visited: set[str] = set()
    file_cache: dict[str, str] = {}

    # Get children using bidirectional traversal (children only)
    child_results = traverse_bidirectional(
        parent_file, markdown_dir, visited, file_cache,
        depth=0, max_depth=max_depth, direction='children'
    )

    # Filter out the parent node itself
    children = [r for r in child_results if r['filename'] != parent_file]

    # Children already have positive depth values from traversal
    # No need to adjust them

    return children


def get_neighborhood(
    target_file: str,
    markdown_dir: Path,
    radius: int
) -> NodeList:
    """
    Get nodes within N hops of target (siblings, cousins, etc).
    Finds nodes that share common parents or children with the target.
    """
    neighbors = []
    visited: set[str] = set()
    file_cache: dict[str, str] = {}

    # Load the target node
    target_node = load_node(target_file, markdown_dir)
    if not target_node or not target_node.get('content'):
        return []

    # Get immediate parents of target
    content_key = 'content'
    content_val = target_node[content_key]
    content_str = content_val if isinstance(content_val, str) else str(content_val)
    target_parents = extract_parent_links(content_str)

    # Get immediate children of target (not currently used in this function)
    # target_children = find_child_references(target_file, markdown_dir, file_cache)

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
                    sibling_node_data = load_node(sibling, markdown_dir)
                    sibling_node: NodeDict = dict(sibling_node_data)  # Make a copy to avoid modifying original
                    sibling_node['depth'] = 0  # Same level as target
                    sibling_node['distance_from_target'] = 1  # One hop away
                    neighbors.append(sibling_node)

    # For radius > 1, could extend to cousins, etc.
    # For now, just immediate siblings

    return neighbors




def traverse_to_node(
    target_file: str,
    markdown_dir: Path,
    options: TraversalOptions = TraversalOptions(),
    is_target: bool = False
) -> NodeList:
    """
    Main traversal function for context retrieval.
    Traverses to a node with specified options and returns list of node dictionaries.

    Args:
        target_file: The target markdown file to traverse to
        markdown_dir: Path to the markdown directory
        options: TraversalOptions controlling the traversal
        is_target: Whether this node is a target from vector search (only targets get neighborhoods)

    Returns:
        List of node dictionaries with structure:
        {
            'filename': str,
            'title': str,
            'content': str,
            'depth': int,
            'node_id': str,
            'summary': str,
            'is_target': bool (optional),
            'neighbor_of_target': bool (optional)
        }
    """
    nodes: NodeList = []

    # Get path from root to target (parents)
    if options.include_parents:
        parent_path = get_path_to_node(target_file, markdown_dir, options.max_depth)
        nodes.extend(parent_path)

    # Add target node
    target_node_data = load_node(target_file, markdown_dir)
    target_node: NodeDict = dict(target_node_data)  # Make a copy to avoid modifying original
    target_node['depth'] = 0
    if is_target:
        target_node['is_target'] = True
    nodes.append(target_node)

    # Get children if requested
    if options.include_children:
        children = get_children_recursive(target_file, markdown_dir, options.max_depth)
        nodes.extend(children)

    # Get neighborhood ONLY if requested AND this is a target node
    if options.include_neighborhood and is_target:
        neighbors = get_neighborhood(target_file, markdown_dir, options.neighborhood_radius)
        # Mark all neighbors as neighbors of target
        for neighbor in neighbors:
            neighbor['neighbor_of_target'] = True
        nodes.extend(neighbors)

    # Apply content filtering based on distance
    return apply_content_filter(nodes, options.content_level)


def accumulate_content(
    nodes: NodeList,
    include_metadata: bool = True,
    separator: str = "\n\n" + "="*60 + "\n\n"
) -> str:
    """
    Convert a list of node dictionaries into flattened text content.

    Args:
        nodes: List of node dictionaries from traversal
        include_metadata: Whether to include node metadata in output
        separator: String to separate nodes in output

    Returns:
        Accumulated text content from all nodes
    """
    if not nodes:
        return ""

    accumulated_parts = []
    seen_node_ids = set()  # Track seen node IDs to avoid duplicates

    # Group nodes by their properties for organized output
    nodes_by_type: NodesGrouping = {
        'targets': [],
        'parents': [],
        'children': [],
        'neighbors': []
    }

    for node in nodes:
        # Skip if we've already seen this node - use filename as unique identifier
        # Remove .md extension if present for consistent comparison
        filename = node.get('filename', '')
        filename_str = str(filename) if filename else ''
        unique_id = filename_str.replace('.md', '') if filename_str else str(node.get('node_id', ''))

        if unique_id in seen_node_ids:
            continue
        seen_node_ids.add(unique_id)

        if node.get('is_search_target', False):
            nodes_by_type['targets'].append(node)
        else:
            depth_val = node.get('depth', 0)
            if isinstance(depth_val, (int, str)):
                try:
                    depth_int = int(depth_val) if depth_val else 0
                    if depth_int > 0:
                        nodes_by_type['parents'].append(node)
                    elif depth_int < 0:
                        nodes_by_type['children'].append(node)
                    else:
                        # Depth 0 but not target = neighbor or special case
                        nodes_by_type['neighbors'].append(node)
                except (ValueError, TypeError):
                    # If conversion fails, treat as neighbor
                    nodes_by_type['neighbors'].append(node)
            else:
                # Non-int/str depth values are treated as neighbors
                nodes_by_type['neighbors'].append(node)

    # Process each group
    for group_name, group_nodes in nodes_by_type.items():
        # Type hint for mypy - nodes_by_type values are List[NodeData]
        group_nodes = list(group_nodes)  # Ensure it's a list type

        if not group_nodes:
            continue

        if include_metadata and group_nodes:
            accumulated_parts.append(f"### {group_name.upper()} ({len(group_nodes)} nodes)")
            accumulated_parts.append("")

        # Sort by depth/relevance
        if group_name == 'parents':
            def parent_sort_key(x: NodeDict) -> int:
                depth_val = x.get('depth', 0)
                try:
                    return int(depth_val) if isinstance(depth_val, (int, str)) and depth_val else 0
                except (ValueError, TypeError):
                    return 0
            group_nodes.sort(key=parent_sort_key, reverse=True)
        elif group_name == 'children':
            def child_sort_key(x: NodeDict) -> int:
                depth_val = x.get('depth', 0)
                try:
                    return abs(int(depth_val)) if isinstance(depth_val, (int, str)) and depth_val else 0
                except (ValueError, TypeError):
                    return 0
            group_nodes.sort(key=child_sort_key)

        for node in group_nodes:
            node_parts = []

            # Add metadata header if requested
            if include_metadata:
                title = node.get('title', 'Unknown')
                node_id = node.get('node_id', '')
                filename = node.get('filename', '')
                depth = node.get('depth', 0)

                node_parts.append(f"**Node: [{node_id}] {title}**")
                # if filename:
                #     node_parts.append(f"File: {filename}")
                if group_name in ['parents', 'children']:
                    depth_int = int(depth) if isinstance(depth, (str, int)) else 0
                    node_parts.append(f"Distance from target: {abs(depth_int)}")
                node_parts.append("")

            # Add summary if available
            summary = node.get('summary', '')
            if summary:
                node_parts.append(f"Summary: {summary}")
                node_parts.append("")

            # Add content if available
            content_raw = node.get('content', '')
            content = str(content_raw) if content_raw else ''

            # todo should have relationiships at the top (connectioin to tree: <rel>)
            # todo this will be easiiest by storing relationship
            # todo we should use actual node datastruct from node.py
            if content:
                # Clean up the content - remove YAML frontmatter
                lines = content.split('\n')
                content_lines = []
                in_frontmatter = False

                for line in lines:
                    if line.strip() == '---':
                        in_frontmatter = not in_frontmatter
                        continue
                    if not in_frontmatter:
                        # Skip redundant metadata lines
                        if not (line.startswith('node_id:') or
                               line.startswith('title:') or
                               line.startswith('###')):
                            content_lines.append(line)

                cleaned_content = '\n'.join(content_lines).strip()
                if cleaned_content:
                    node_parts.append(cleaned_content)

            if node_parts:
                accumulated_parts.append('\n'.join(node_parts))

    return separator.join(accumulated_parts)
