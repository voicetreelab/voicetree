#!/usr/bin/env python3
"""
Quick script to analyze the tree structure of a markdown fixture.
"""
from backend.markdown_tree_manager.markdown_to_tree.markdown_to_tree import load_markdown_tree
from backend.markdown_tree_manager.graph_flattening.tree_flattening import visualize_markdown_tree


def analyze_tree(markdown_dir: str):
    """Load and analyze tree structure."""
    print(f"\n{'='*80}")
    print(f"Analyzing: {markdown_dir}")
    print(f"{'='*80}\n")

    # Load the tree
    tree = load_markdown_tree(markdown_dir)

    # Print basic stats
    print(f"Total nodes: {len(tree.tree)}")

    # Analyze connectivity
    roots = []
    orphans = []
    internal = []

    for node_id, node in tree.tree.items():
        has_parent = node.parent_id is not None
        has_children = len(node.children) > 0

        if not has_parent and not has_children:
            orphans.append(node)
        elif not has_parent and has_children:
            roots.append(node)
        else:
            internal.append(node)

    print(f"Root nodes (no parent, has children): {len(roots)}")
    print(f"Orphan nodes (no parent, no children): {len(orphans)}")
    print(f"Internal nodes (has parent): {len(internal)}")
    print(f"Total components: {len(roots) + len(orphans)}")

    # Show root nodes
    print(f"\n{'='*80}")
    print("ROOT NODES (Detailed):")
    print(f"{'='*80}")
    for node in roots:
        print(f"  - {node.title}")
        print(f"    ID: {node.id}")
        print(f"    Filename: {node.filename}")
        print(f"    Parent ID: {node.parent_id}")
        print(f"    Children IDs: {node.children}")
        print()

    # Generate tree visualization using tree_flattening module
    print(f"\n{'='*80}")
    print("TREE VISUALIZATION:")
    print(f"{'='*80}\n")

    visualization = visualize_markdown_tree(tree)
    print(visualization)

    # Print orphans separately
    if orphans:
        print("\nORPHAN NODES:")
        for orphan in orphans:
            print(orphan.title)


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        fixture_dir = sys.argv[1]
    else:
        fixture_dir = "/Users/bobbobby/repos/VoiceTree/frontend/webapp/tests/fixtures/example_real_large/2025-09-30"

    analyze_tree(fixture_dir)
