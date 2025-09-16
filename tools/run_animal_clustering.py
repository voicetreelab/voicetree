#!/usr/bin/env python3
"""
Script to run clustering analysis on the animal_example test data
and regenerate markdown files with cluster tags incrementally.
"""

import asyncio
import os
from typing import Dict
from backend.tree_manager.markdown_to_tree import MarkdownToTreeConverter
from backend.tree_manager.markdown_tree_ds import Node
from backend.tree_manager.graph_search.tree_functions import _format_nodes_for_prompt
from backend.text_to_graph_pipeline.agentic_workflows.agents.clustering_agent import ClusteringAgent
from backend.tree_manager.graph_flattening.tree_to_markdown import TreeToMarkdownConverter


async def save_current_progress(tree: Dict[int, Node], output_dir: str, batch_num: int, total_batches: int):
    """Save the current state of clustering to markdown files after each batch"""
    print(f"\nSaving progress after batch {batch_num}/{total_batches}...")
    
    # Count tagged nodes so far
    tagged_count = sum(1 for node in tree.values() if hasattr(node, 'tags') and node.tags)
    untagged_count = len(tree) - tagged_count
    
    print(f"Progress: {tagged_count} tagged, {untagged_count} untagged")
    
    # Generate markdown files with current tags
    markdown_converter = TreeToMarkdownConverter(tree)
    markdown_converter.convert_nodes(output_dir=output_dir, nodes_to_update=set(tree.keys()))
    
    print(f"✅ Batch {batch_num} saved to {output_dir}")


async def run_clustering_with_incremental_saves(tree: Dict[int, Node], output_dir: str):
    """Run clustering analysis with incremental saves after each batch"""
    # Extract nodes as a list
    nodes = list(tree.values())
    total_nodes = len(nodes)
    
    # Calculate target unique tags based on sqrt of total nodes
    # Use 3 * sqrt(n) for better coverage
    import math
    target_unique_tags = round(3 * math.sqrt(total_nodes))
    
    # Process nodes in batches
    batch_size = 30
    total_tagged = 0
    
    # Instantiate clustering agent once
    clustering_agent = ClusteringAgent()
    
    # Track all tags used across batches
    all_tags = set()
    
    print(f"Total nodes to tag: {total_nodes}")
    print(f"Target unique tags: {target_unique_tags} (sqrt of {total_nodes})")
    print(f"Processing in batches of {batch_size}")
    
    for i in range(0, total_nodes, batch_size):
        batch_nodes = nodes[i:i + batch_size]
        batch_num = i // batch_size + 1
        total_batches = (total_nodes + batch_size - 1) // batch_size
        
        print(f"\n{'='*60}")
        print(f"Processing batch {batch_num}/{total_batches} ({len(batch_nodes)} nodes)")
        print(f"{'='*60}")
        
        # Format batch nodes for the clustering agent
        formatted_nodes = _format_nodes_for_prompt(batch_nodes, tree)
        node_count = len(batch_nodes)
        
        # Run tagging with retry logic
        max_retries = 3
        for attempt in range(max_retries):
            try:
                print(f"Running tagging with model: gemini-2.5-flash-lite (attempt {attempt + 1}/{max_retries})")
                # Pass existing tags to maintain consistency
                existing_tags_list = sorted(list(all_tags)) if all_tags else None
                tagging_response = await clustering_agent.run(
                    formatted_nodes, 
                    node_count,
                    existing_tags=existing_tags_list,
                    target_unique_tags=target_unique_tags,
                    total_nodes=total_nodes
                )
                break  # Success, exit retry loop
            except RuntimeError as e:
                if "LLM returned invalid JSON" in str(e) and attempt < max_retries - 1:
                    print(f"⚠️ Attempt {attempt + 1} failed with invalid JSON, retrying...")
                    continue
                else:
                    raise
        
        # Update tree in place with tags attributes
        batch_tagged = 0
        for tag_assignment in tagging_response.tags:
            node_id = tag_assignment.node_id
            if node_id in tree:
                tree[node_id].tags = tag_assignment.tags
                if tag_assignment.tags:  # Node has at least one tag
                    batch_tagged += 1
                    # Track all tags used
                    all_tags.update(tag_assignment.tags)
        
        total_tagged += batch_tagged
        print(f"Batch {batch_num} complete: {batch_tagged} nodes tagged")
        print(f"Total unique tags so far: {len(all_tags)}")
        
        # Save progress after each batch
        await save_current_progress(tree, output_dir, batch_num, total_batches)
    
    print(f"\n{'='*60}")
    print(f"FINAL RESULTS")
    print(f"{'='*60}")
    print(f"Total tagging complete: {total_tagged}/{total_nodes} nodes tagged")
    
    return total_tagged


async def main():
    """Run clustering on animal example data and regenerate markdown with tags incrementally"""
    
    # Load the animal example tree
    # Simple relative paths from tools folder
    input_dir = "backend/benchmarker/output/igsm_op17_ip20_force_True_0_problem_question"
    output_dir = "../backend/benchmarker/output_clustered_hard_16"
    
    print(f"Loading tree from: {input_dir}")
    converter = MarkdownToTreeConverter()
    tree = converter.load_tree_from_markdown(input_dir)
    
    print(f"Loaded {len(tree)} nodes")
    
    # Create output directory and clean existing files
    os.makedirs(output_dir, exist_ok=True)
    
    # Remove existing markdown files in the output directory
    print(f"Cleaning existing files in: {output_dir}")
    for filename in os.listdir(output_dir):
        if filename.endswith('.md'):
            file_path = os.path.join(output_dir, filename)
            os.remove(file_path)
            print(f"  Removed: {filename}")
    print("Directory cleaned")
    
    # Run clustering analysis with incremental saves
    print("Running clustering analysis with incremental saves...")
    total_tagged = await run_clustering_with_incremental_saves(tree, output_dir)
    
    # Show tag distribution
    tag_counts = {}
    for node in tree.values():
        tags = getattr(node, 'tags', [])
        for tag in tags:
            tag_counts[tag] = tag_counts.get(tag, 0) + 1
    
    print("\nFinal tag distribution (top 20):")
    for tag, count in sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)[:20]:
        print(f"  {tag}: {count} nodes")
    
    print(f"\n✅ Complete! Check {output_dir} for markdown files with tags")


if __name__ == "__main__":
    asyncio.run(main())