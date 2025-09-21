#!/usr/bin/env python3
"""
Main entry point for context retrieval pipeline.
Orchestrates markdown tree loading, search, traversal, and linearization.

Usage: python retrieve_context.py <markdown_dir> <query>

Implements the pipeline specified in arch.md:
1. Load markdown to tree DS
2. Get similar nodes using get_most_relevant_nodes
3. Traverse from roots to targets (distance 5, n=3 neighborhood for targets only)
4. Linearize using tree_flattening.py
5. Output result
"""

import os
import sys
from pathlib import Path
from typing import Dict, Any, List, Set

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.markdown_tree_manager.markdown_to_tree.markdown_to_tree import load_markdown_tree
from backend.markdown_tree_manager.graph_search.tree_functions import get_most_relevant_nodes
from backend.context_retrieval.dependency_traversal import TraversalOptions, traverse_to_node, ContentLevel
from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree


def retrieve_context(markdown_dir: str, query: str) -> str:
    """
    Retrieve linearized context for a query from markdown tree.

    Follows arch.md specification:
    1. Load markdown tree
    2. Get similar nodes using get_most_relevant_nodes
    3. Traverse from roots to targets with distance constraints
    4. Linearize using tree_flattening
    5. Output result

    Args:
        markdown_dir: Path to markdown tree vault
        query: User's search query string

    Returns:
        Linearized context string for stdout
    """
    # Step 1: Load markdown to tree DS
    try:
        markdown_tree = load_markdown_tree(markdown_dir)
        # MarkdownTree is what get_most_relevant_nodes expects (was renamed from DecisionTree)
    except Exception as e:
        print(f"Error loading markdown tree from {markdown_dir}: {e}", file=sys.stderr)
        sys.exit(1)

    # Step 2: Get similar nodes using get_most_relevant_nodes (as specified in arch.md)
    try:
        # Get relevant nodes - returns Node objects
        # Note: parameter is called 'decision_tree' but accepts MarkdownTree objects
        relevant_nodes = get_most_relevant_nodes(markdown_tree, limit=12, query=query)
        if not relevant_nodes:
            print(f"No relevant nodes found for query: {query}", file=sys.stderr)
            return ""
    except Exception as e:
        print(f"Error during search: {e}", file=sys.stderr)
        sys.exit(1)

    # Convert Node objects to filenames
    relevant_filenames = []
    markdown_path = Path(markdown_dir)

    # Map node IDs to actual filenames
    md_files = {f: f for f in os.listdir(markdown_dir) if f.endswith('.md')}

    for node in relevant_nodes:
        filename = None
        node_id_str = str(node.id if hasattr(node, 'id') else node.node_id)

        # Look for file that starts with node_id
        for md_file in md_files:
            if md_file.startswith(f"{node_id_str}_"):
                filename = md_file
                break

        # Fallback to node.filename if available
        if not filename and hasattr(node, 'filename'):
            filename = node.filename
        elif not filename and hasattr(node, 'file_name'):
            filename = node.file_name

        if filename:
            relevant_filenames.append(filename)

    if not relevant_filenames:
        print(f"Could not map any nodes to filenames", file=sys.stderr)
        return ""

    # Step 3: Traverse from roots to targets with constraints
    # Collect all nodes including root-to-target paths
    all_traversed_nodes = []
    seen_files: Set[str] = set()

    for target_file in relevant_filenames:
        # Set up traversal options as per arch.md specification
        options = TraversalOptions(
            include_parents=True,  # Include path from root to target
            include_children=True,  # Include children within distance
            max_depth=5,  # Distance constraint from target
            include_neighborhood=True,  # Include neighborhood
            neighborhood_radius=3,  # n=3 neighborhood for targets only
            content_level=ContentLevel.FULL_CONTENT
        )

        # Traverse with is_target=True so only this node gets neighborhood
        try:
            nodes = traverse_to_node(target_file, markdown_path, options, is_target=True)

            # Mark target nodes and avoid duplicates
            for node in nodes:
                file_id = node.get('filename', '')
                if file_id not in seen_files:
                    node['is_search_target'] = (file_id == target_file)
                    all_traversed_nodes.append(node)
                    seen_files.add(file_id)
        except Exception as e:
            print(f"Warning: Error traversing node {target_file}: {e}", file=sys.stderr)
            continue

    # Step 4: Linearize using tree_flattening.py
    if all_traversed_nodes:
        try:
            from backend.markdown_tree_manager.graph_flattening.tree_flattening import flatten_tree
            linearized_content = flatten_tree(all_traversed_nodes)
            return linearized_content
        except Exception as e:
            print(f"Error during linearization: {e}", file=sys.stderr)
            return ""
    else:
        return ""


def main():
    """Main entry point for command-line usage."""
    # Parse command-line arguments
    if len(sys.argv) != 3:
        print("Usage: python retrieve_context.py <markdown_dir> <query>", file=sys.stderr)
        sys.exit(1)

    markdown_dir = sys.argv[1]
    query = sys.argv[2]

    # Validate markdown directory exists
    if not os.path.isdir(markdown_dir):
        print(f"Error: Directory not found: {markdown_dir}", file=sys.stderr)
        sys.exit(1)

    # Retrieve and output context
    print("=== CONTEXT OUTPUT ===")
    context = retrieve_context(markdown_dir, query)
    if context:
        print(context)
    else:
        print("No context found for the given query.")
    print("=== END CONTEXT ===")


if __name__ == "__main__":
    main()