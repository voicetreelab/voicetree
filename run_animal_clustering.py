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
    input_dir = "backend/benchmarker/output"
    output_dir = "backend/tests/animal_example_clustered"
    
    print(f"Loading tree from: {input_dir}")
    converter = MarkdownToTreeConverter()
    tree = converter.load_tree_from_markdown(input_dir)
    
    print(f"Loaded {len(tree)} nodes")
    
    # Run clustering analysis
    print("Running clustering analysis...")
    await run_clustering_analysis(tree)
    
    # Count clustered nodes
    clustered_count = sum(1 for node in tree.values() if hasattr(node, 'cluster_name') and node.cluster_name is not None)
    unclustered_count = len(tree) - clustered_count
    
    print(f"Clustering complete: {clustered_count} clustered, {unclustered_count} unclustered")
    
    # Show cluster distribution
    clusters = {}
    for node in tree.values():
        cluster = getattr(node, 'cluster_name', None)
        if cluster:
            clusters[cluster] = clusters.get(cluster, 0) + 1
    
    print("\nCluster distribution:")
    for cluster, count in clusters.items():
        print(f"  {cluster}: {count} nodes")
    
    # Create output directory
    os.makedirs(output_dir, exist_ok=True)
    
    # Generate markdown files with cluster tags
    print(f"\nGenerating markdown files with cluster tags to: {output_dir}")
    markdown_converter = TreeToMarkdownConverter(tree)
    markdown_converter.convert_nodes(output_dir=output_dir, nodes_to_update=set(tree.keys()))
    
    print(f"✅ Complete! Check {output_dir} for markdown files with cluster tags")


if __name__ == "__main__":
    asyncio.run(main())