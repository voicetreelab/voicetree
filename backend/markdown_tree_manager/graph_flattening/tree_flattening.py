#!/usr/bin/env python3
"""
Tree flattening module for creating visual ASCII tree structures.
Takes a list of traversed nodes with hierarchy information and outputs
a linearized string with visual tree structure followed by ordered contents.
"""

from typing import Dict, List, Any, Optional, Set, Tuple
from collections import defaultdict


def flatten_tree(nodes: List[Dict[str, Any]]) -> str:
    """
    Convert a list of traversed nodes into a visual ASCII tree structure
    followed by ordered node contents.

    Args:
        nodes: List of node dictionaries with structure:
            {
                'filename': str,
                'title': str,
                'content': str,
                'depth': int,  # positive=parents, 0=target/neighbors, negative=children
                'is_target': bool (optional),
                'neighbor_of_target': bool (optional)
            }

    Returns:
        Linearized string with visual tree + ordered contents
    """
    if not nodes:
        return "No nodes to display."

    # Build tree structure from nodes
    tree_structure, node_map = _build_tree_structure(nodes)

    # Generate ASCII visualization
    tree_visual = _generate_ascii_tree(tree_structure, node_map)

    # Generate ordered content
    ordered_content = _generate_ordered_content(tree_structure, node_map)

    # Combine into final output
    output = []
    output.append("=== TREE STRUCTURE ===")
    output.append(tree_visual)
    output.append("")
    output.append("=== NODE CONTENTS ===")
    output.append(ordered_content)

    return "\n".join(output)


def _build_tree_structure(nodes: List[Dict[str, Any]]) -> Tuple[Dict[str, List[str]], Dict[str, Dict[str, Any]]]:
    """
    Build a tree structure from the flat list of nodes.

    Returns:
        - tree_structure: Dict mapping parent filenames to list of child filenames
        - node_map: Dict mapping filenames to node data
    """
    # Create node map for easy lookup
    node_map = {node['filename']: node for node in nodes}

    # Build parent-child relationships based on depth
    tree_structure = defaultdict(list)

    # Sort nodes by depth to establish hierarchy
    sorted_nodes = sorted(nodes, key=lambda n: n.get('depth', 0), reverse=True)

    # Build the tree structure based on depth relationships
    # Depth indicates distance from target:
    # positive = ancestors (parents, grandparents)
    # 0 = target or neighbors
    # negative = descendants (children, grandchildren)

    # Create a list to track nodes at each depth level
    depth_levels = defaultdict(list)
    for node in nodes:
        depth = node.get('depth', 0)
        depth_levels[depth].append(node['filename'])

    # Find the maximum depth (root level)
    max_depth = max(depth_levels.keys()) if depth_levels else 0

    # Build tree from top to bottom
    for depth in sorted(depth_levels.keys(), reverse=True):
        if depth > 0:
            # These are ancestor nodes
            for parent_file in depth_levels[depth]:
                # Look for children at depth-1
                child_depth = depth - 1
                if child_depth in depth_levels:
                    for child_file in depth_levels[child_depth]:
                        if child_file not in tree_structure[parent_file]:
                            tree_structure[parent_file].append(child_file)

    # Handle target nodes and their children
    for node in nodes:
        if node.get('is_target', False) or node.get('depth', 0) == 0:
            parent_file = node['filename']
            # Find its children (negative depth nodes)
            for child_node in nodes:
                child_depth = child_node.get('depth', 0)
                if child_depth < 0:
                    # Check if this is a direct child (-1) or deeper
                    if child_depth == -1:
                        if child_node['filename'] not in tree_structure[parent_file]:
                            tree_structure[parent_file].append(child_node['filename'])
                    else:
                        # Find its parent at depth+1
                        for potential_parent in nodes:
                            if potential_parent.get('depth', 0) == child_depth + 1:
                                parent_of_child = potential_parent['filename']
                                if child_node['filename'] not in tree_structure[parent_of_child]:
                                    tree_structure[parent_of_child].append(child_node['filename'])
                                break

    # Identify root nodes (highest depth)
    root_nodes = depth_levels.get(max_depth, [])

    # Store root nodes in tree structure
    tree_structure['__roots__'] = root_nodes

    return dict(tree_structure), node_map


def _generate_ascii_tree(tree_structure: Dict[str, List[str]],
                         node_map: Dict[str, Dict[str, Any]]) -> str:
    """
    Generate ASCII tree visualization for the entire tree.
    """
    lines = []
    visited = set()

    def add_node(filename: str, prefix: str = "", is_last: bool = True, is_root: bool = False) -> None:
        """Recursively add nodes to the tree visualization."""
        if filename in visited:
            return
        visited.add(filename)

        node = node_map.get(filename, {})
        title = node.get('title', filename)

        # Add special markers
        if node.get('is_target', False):
            title += " [*]"
        elif node.get('neighbor_of_target', False):
            title += " (neighbor)"

        # Add the current node with proper tree characters
        if is_root:
            # Root node - no prefix
            lines.append(title)
        elif prefix == "":
            # First level children need tree chars
            connector = "└── " if is_last else "├── "
            lines.append(connector + title)
        else:
            # Deeper levels
            connector = "└── " if is_last else "├── "
            lines.append(prefix + connector + title)

        # Get children of this node
        children = tree_structure.get(filename, [])

        # Process each child
        for i, child_file in enumerate(children):
            is_last_child = (i == len(children) - 1)

            if is_root:
                # Children of root - no prefix yet
                add_node(child_file, "", is_last_child, False)
            elif prefix == "":
                # Children of first level
                extension = "    " if is_last else "│   "
                add_node(child_file, extension, is_last_child, False)
            else:
                # Deeper levels
                extension = "    " if is_last else "│   "
                child_prefix = prefix + extension
                add_node(child_file, child_prefix, is_last_child, False)

    # Start with root nodes
    roots = tree_structure.get('__roots__', [])
    for i, root in enumerate(roots):
        is_last_root = (i == len(roots) - 1)
        add_node(root, "", is_last_root, is_root=True)

    return "\n".join(lines)


def _generate_ordered_content(tree_structure: Dict[str, List[str]],
                              node_map: Dict[str, Dict[str, Any]]) -> str:
    """
    Generate ordered content following tree traversal order.
    """
    lines = []
    visited = set()
    node_counter = 1

    def traverse_and_output(filename: str) -> None:
        nonlocal node_counter

        if filename in visited or filename == '_ROOT_':
            return

        visited.add(filename)
        node = node_map.get(filename, {})

        # Output node content
        title = node.get('title', filename)
        if node.get('is_target', False):
            title += " [*]"
        elif node.get('neighbor_of_target', False):
            title += " (neighbor)"

        lines.append(f"[{node_counter}] {title}")

        # Extract and clean content
        content = node.get('content', '')
        if content:
            # Remove YAML frontmatter
            content_lines = content.split('\n')
            cleaned_lines = []
            in_frontmatter = False

            for line in content_lines:
                if line.strip() == '---':
                    in_frontmatter = not in_frontmatter
                    continue
                if not in_frontmatter:
                    cleaned_lines.append(line)

            cleaned_content = '\n'.join(cleaned_lines).strip()
            if cleaned_content:
                lines.append(f"Content: {cleaned_content}")
        else:
            lines.append("Content: (empty)")

        lines.append("")  # Empty line between nodes
        node_counter += 1

        # Traverse children
        children = tree_structure.get(filename, [])
        for child in children:
            traverse_and_output(child)

    # Start traversal from roots
    roots = tree_structure.get('__roots__', [])
    for root in roots:
        if root == '_ROOT_':
            # Process virtual root's children
            children = tree_structure.get(root, [])
            for child in children:
                traverse_and_output(child)
        else:
            traverse_and_output(root)

    return "\n".join(lines)
