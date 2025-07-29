#!/usr/bin/env python3
"""
Script to run clustering analysis on the animal_example test data
and regenerate markdown files with cluster tags.
"""

import asyncio
import os
from backend.text_to_graph_pipeline.tree_manager.markdown_to_tree import MarkdownToTreeConverter
from backend.text_to_graph_pipeline.agentic_workflows.clustering_workflow_driver import run_clustering_analysis
from backend.text_to_graph_pipeline.tree_manager.tree_to_markdown import TreeToMarkdownConverter


async def main():
    """Run clustering on animal example data and regenerate markdown with tags"""
    
    # Load the animal example tree
    input_dir = "/Users/bobbobby/repos/VoiceTreePoc/backend/benchmarker/output"
    output_dir = "/Users/bobbobby/repos/VoiceTreePoc/backend/benchmarker/output_clustered"
    
    print(f"Loading tree from: {input_dir}")
    converter = MarkdownToTreeConverter()
    tree = converter.load_tree_from_markdown(input_dir)
    
    print(f"Loaded {len(tree)} nodes")
    
    # Run clustering analysis
    print("Running clustering analysis...")
    await run_clustering_analysis(tree)
    
    # Count tagged nodes
    tagged_count = sum(1 for node in tree.values() if hasattr(node, 'tags') and node.tags)
    untagged_count = len(tree) - tagged_count
    
    print(f"Tagging complete: {tagged_count} tagged, {untagged_count} untagged")
    
    # Show tag distribution
    tag_counts = {}
    for node in tree.values():
        tags = getattr(node, 'tags', [])
        for tag in tags:
            tag_counts[tag] = tag_counts.get(tag, 0) + 1
    
    print("\nTag distribution (top 20):")
    for tag, count in sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)[:20]:
        print(f"  {tag}: {count} nodes")
    
    # Create output directory
    os.makedirs(output_dir, exist_ok=True)
    
    # Generate markdown files with tags
    print(f"\nGenerating markdown files with tags to: {output_dir}")
    markdown_converter = TreeToMarkdownConverter(tree)
    markdown_converter.convert_nodes(output_dir=output_dir, nodes_to_update=set(tree.keys()))
    
    print(f"✅ Complete! Check {output_dir} for markdown files with tags")


if __name__ == "__main__":
    asyncio.run(main())