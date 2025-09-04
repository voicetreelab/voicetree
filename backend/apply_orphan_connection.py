#!/usr/bin/env python
"""
Apply the Connect Orphans mechanism to an existing VoiceTree.
This script loads a tree from markdown files and runs the orphan connection agent.
"""

import asyncio
import sys
from pathlib import Path
import logging

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.text_to_graph_pipeline.tree_manager.markdown_to_tree import load_markdown_tree
from backend.text_to_graph_pipeline.agentic_workflows.agents.connect_orphans_agent import (
    ConnectOrphansAgent
)
from backend.text_to_graph_pipeline.tree_manager.tree_to_markdown import TreeToMarkdownConverter
from backend.text_to_graph_pipeline.chunk_processing_pipeline.apply_tree_actions import (
    TreeActionApplier
)

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)


async def process_tree(tree_path: str, output_path: str = None):
    """
    Load a tree and apply orphan connection.
    
    Args:
        tree_path: Path to the markdown tree directory
        output_path: Optional output path for the updated tree
    """
    logger.info(f"Loading tree from: {tree_path}")
    
    # Load the existing tree (returns dict of nodes)
    tree_data = load_markdown_tree(tree_path)
    
    # Create a DecisionTree from the loaded data
    from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree
    tree = DecisionTree()
    tree.tree = tree_data
    if tree_data:
        tree.next_node_id = max(tree_data.keys()) + 1
    
    # Count initial orphans
    initial_orphans = [
        (node_id, node.title) for node_id, node in tree.tree.items()
        if node.parent_id is None
    ]

    # todo, we should ignore orphan pairis that have already been processed and
    # are not related, but we hvae to be careful here, since other new pairs
    # may still be relevant.
    
    logger.info(f"Initial tree statistics:")
    logger.info(f"  Total nodes: {len(tree.tree)}")
    logger.info(f"  Orphan nodes: {len(initial_orphans)}")
    
    if len(initial_orphans) > 1:
        logger.info(f"\nOrphan nodes found:")
        for node_id, title in initial_orphans[:10]:  # Show first 10
            logger.info(f"    {node_id}: {title}")
        if len(initial_orphans) > 10:
            logger.info(f"    ... and {len(initial_orphans) - 10} more")
    
    # Run the connect orphans agent
    logger.info("\n" + "="*60)
    logger.info("Running Connect Orphans Agent...")
    logger.info("="*60)
    
    agent = ConnectOrphansAgent()
    actions, parent_child_mapping = await agent.run(
        tree=tree,
        max_roots_to_process=20  # Process up to 20 roots at once
    )
    
    if actions:
        logger.info(f"\nAgent created {len(actions)} parent nodes:")
        for action in actions:
            logger.info(f"  • {action.new_node_name}")
            logger.info(f"    Summary: {action.summary[:100]}...")
        
        # Apply the actions to create the parent nodes
        logger.info("\nApplying actions to tree...")
        applier = TreeActionApplier(tree)
        new_node_ids = applier.apply(actions)
        logger.info(f"Created nodes with IDs: {new_node_ids}")
        
        # Now connect the orphans to their new parents
        logger.info("\nConnecting orphans to parent nodes...")
        nodes_to_update = set()
        for action in actions:
            parent_name = action.new_node_name
            # Find the newly created parent node by name
            parent_id = None
            for node_id, node in tree.tree.items():
                if node.title == parent_name and node_id in new_node_ids:
                    parent_id = node_id
                    break
            
            if parent_id and parent_name in parent_child_mapping:
                child_ids = parent_child_mapping[parent_name]
                for child_id in child_ids:
                    if child_id in tree.tree:
                        # Update the child's parent_id
                        tree.tree[child_id].parent_id = parent_id
                        # Add the child to parent's children list
                        if child_id not in tree.tree[parent_id].children:
                            tree.tree[parent_id].children.append(child_id)
                        nodes_to_update.add(child_id)
                        logger.info(f"  Connected node {child_id} to parent {parent_id} ({parent_name})")
        
        # Update the nodes_to_update set to include all modified nodes
        new_node_ids.update(nodes_to_update)
        
        # Save the updated tree if output path provided
        if output_path:
            logger.info(f"\nSaving updated tree to: {output_path}")
            Path(output_path).mkdir(parents=True, exist_ok=True)
            converter = TreeToMarkdownConverter(tree.tree)
            # Convert all nodes to markdown
            all_node_ids = list(tree.tree.keys())
            converter.convert_nodes(output_dir=output_path, nodes_to_update=all_node_ids)
            logger.info("Tree saved successfully!")
    else:
        logger.info("\nNo groupings were created.")
        logger.info("This could mean:")
        logger.info("  - Not enough orphan nodes (need at least 2)")
        logger.info("  - No obvious relationships between orphans")
        logger.info("  - LLM being conservative to avoid forced groupings")
    
    # Final statistics
    final_orphans = [
        (node_id, node.title) for node_id, node in tree.tree.items()
        if node.parent_id is None
    ]
    
    logger.info(f"\n" + "="*60)
    logger.info("Final tree statistics:")
    logger.info(f"  Total nodes: {len(tree.tree)}")
    logger.info(f"  Orphan nodes: {len(final_orphans)}")
    logger.info(f"  Change: {len(initial_orphans)} → {len(final_orphans)} orphans")
    
    return tree, actions, parent_child_mapping


async def main():
    """Main entry point"""
    # Default to the benchmarker output
    default_path = "backend/benchmarker/output_backups/user_guide_qa_audio_processing"
    
    if len(sys.argv) > 1:
        tree_path = sys.argv[1]
    else:
        tree_path = default_path
    
    if len(sys.argv) > 2:
        output_path = sys.argv[2]
    else:
        output_path = None
    
    # Check if path exists
    if not Path(tree_path).exists():
        logger.error(f"Tree path not found: {tree_path}")
        sys.exit(1)
    
    # Process the tree
    await process_tree(tree_path, output_path)


if __name__ == "__main__":
    print("\n" + "="*60)
    print("VoiceTree Orphan Connection Tool")
    print("="*60)
    print("\nUsage: python apply_orphan_connection.py [tree_path] [output_path]")
    print(f"Default tree_path: backend/benchmarker/output_backups/user_guide_qa_audio_processing")
    print("\n" + "="*60 + "\n")
    
    asyncio.run(main())