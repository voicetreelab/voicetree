#!/usr/bin/env python3
"""
Tree flattening module for creating visual ASCII tree structures.
Takes a list of traversed nodes with hierarchy information and outputs
a linearized string with visual tree structure followed by ordered contents.
"""

from collections import defaultdict
from typing import Any, TypedDict


class FlatNode(TypedDict):
    """TypedDict for flattened node structure."""
    filename: str
    title: str
    content: str
    depth: int
    is_target: bool
    neighbor_of_target: bool


# Dict key constants to avoid string literal violations
FILENAME_KEY = 'filename'
TITLE_KEY = 'title'
CONTENT_KEY = 'content'
DEPTH_KEY = 'depth'
IS_TARGET_KEY = 'is_target'
NEIGHBOR_KEY = 'neighbor_of_target'
ROOTS_KEY = '__roots__'
VIRTUAL_ROOT_KEY = '_ROOT_'


def flatten_tree(nodes: list[dict[str, Any]]) -> str:
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


def _build_tree_structure(nodes: list[dict[str, Any]]) -> tuple[dict[str, list[str]], dict[str, dict[str, Any]]]:
    """
    Build a tree structure from the flat list of nodes.

    Returns:
        - tree_structure: Dict mapping parent filenames to list of child filenames
        - node_map: Dict mapping filenames to node data
    """
    # Create node map for easy lookup
    node_map = {node[FILENAME_KEY]: node for node in nodes}

    # Build parent-child relationships based on depth
    tree_structure: defaultdict[str, list[str]] = defaultdict(list)

    # Sort nodes by depth to establish hierarchy
    _ = sorted(nodes, key=lambda n: n.get(DEPTH_KEY, 0), reverse=True)

    # Build the tree structure based on depth relationships
    # Depth indicates distance from target:
    # positive = ancestors (parents, grandparents)
    # 0 = target or neighbors
    # negative = descendants (children, grandchildren)

    # Create a list to track nodes at each depth level
    depth_levels: defaultdict[int, list[str]] = defaultdict(list)
    for node in nodes:
        depth = node.get(DEPTH_KEY, 0)
        depth_levels[depth].append(node[FILENAME_KEY])

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
        if node.get(IS_TARGET_KEY, False) or node.get(DEPTH_KEY, 0) == 0:
            parent_file = node[FILENAME_KEY]
            # Find its children (negative depth nodes)
            for child_node in nodes:
                child_depth = child_node.get(DEPTH_KEY, 0)
                if child_depth < 0:
                    # Check if this is a direct child (-1) or deeper
                    if child_depth == -1:
                        if child_node[FILENAME_KEY] not in tree_structure[parent_file]:
                            tree_structure[parent_file].append(child_node[FILENAME_KEY])
                    else:
                        # Find its parent at depth+1
                        for potential_parent in nodes:
                            if potential_parent.get(DEPTH_KEY, 0) == child_depth + 1:
                                parent_of_child = potential_parent[FILENAME_KEY]
                                if child_node[FILENAME_KEY] not in tree_structure[parent_of_child]:
                                    tree_structure[parent_of_child].append(child_node[FILENAME_KEY])
                                break

    # Identify root nodes (highest depth)
    root_nodes = depth_levels.get(max_depth, [])

    # Store root nodes in tree structure
    tree_structure[ROOTS_KEY] = root_nodes

    return dict(tree_structure), node_map


def _generate_ascii_tree(tree_structure: dict[str, list[str]],
                         node_map: dict[str, dict[str, Any]]) -> str:
    """
    Generate ASCII tree visualization for the entire tree.
    """
    lines: list[str] = []
    visited: set[str] = set()

    def print_tree(filename: str, prefix: str = "", is_last: bool = True, is_root: bool = True) -> None:
        """Recursively print tree structure."""
        if filename in visited:
            return
        visited.add(filename)

        node = node_map.get(filename, {})
        title = node.get(TITLE_KEY, filename)

        # Add special markers
        if node.get(IS_TARGET_KEY, False):
            title += " [*]"
        elif node.get(NEIGHBOR_KEY, False):
            title += " (neighbor)"

        # Print current node
        if is_root:
            lines.append(title)
        else:
            connector = "└── " if is_last else "├── "
            lines.append(prefix + connector + title)

        # Print children
        children = tree_structure.get(filename, [])
        for i, child_file in enumerate(children):
            is_last_child = (i == len(children) - 1)
            if is_root:
                child_prefix = ""
            else:
                extension = "    " if is_last else "│   "
                child_prefix = prefix + extension
            print_tree(child_file, child_prefix, is_last_child, False)

    # Start with root nodes
    roots = tree_structure.get(ROOTS_KEY, [])
    for root in roots:
        print_tree(root)

    return "\n".join(lines)


def _generate_ordered_content(tree_structure: dict[str, list[str]],
                              node_map: dict[str, dict[str, Any]]) -> str:
    """
    Generate ordered content following tree traversal order.
    """
    lines: list[str] = []
    visited: set[str] = set()
    node_counter = 1

    def traverse_and_output(filename: str) -> None:
        nonlocal node_counter

        if filename in visited or filename == VIRTUAL_ROOT_KEY:
            return

        visited.add(filename)
        node = node_map.get(filename, {})

        # Output node content
        title = node.get(TITLE_KEY, filename)
        if node.get(IS_TARGET_KEY, False):
            title += " [*]"
        elif node.get(NEIGHBOR_KEY, False):
            title += " (neighbor)"

        lines.append(f"[{node_counter}] {title}")

        # Extract and clean content
        content = node.get(CONTENT_KEY, '')
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
    roots = tree_structure.get(ROOTS_KEY, [])
    for root in roots:
        if root == VIRTUAL_ROOT_KEY:
            # Process virtual root's children
            children = tree_structure.get(root, [])
            for child in children:
                traverse_and_output(child)
        else:
            traverse_and_output(root)

    return "\n".join(lines)


def visualize_markdown_tree(tree: Any) -> str:
    """
    Visualize a MarkdownTree as ASCII tree structure.

    Args:
        tree: MarkdownTree object with tree.tree dict[int, Node]

    Returns:
        ASCII tree visualization string
    """
    # Build tree structure from MarkdownTree
    tree_structure: dict[str, list[str]] = {}
    node_map: dict[str, dict[str, Any]] = {}

    # Find root nodes (nodes with no parent)
    roots = []

    for node_id, node in tree.tree.items():
        filename = node.filename

        # Add to node map
        node_map[filename] = {
            FILENAME_KEY: filename,
            TITLE_KEY: node.title,
            CONTENT_KEY: node.content,
        }

        # Build parent-child relationships
        if node.children:
            tree_structure[filename] = [tree.tree[child_id].filename for child_id in node.children if child_id in tree.tree]

        # Track roots
        if node.parent_id is None:
            roots.append(filename)

    # Store roots
    tree_structure[ROOTS_KEY] = roots

    return _generate_ascii_tree(tree_structure, node_map)
