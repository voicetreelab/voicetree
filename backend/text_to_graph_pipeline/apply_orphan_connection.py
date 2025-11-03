#!/usr/bin/env python
"""
Apply the Connect Orphans mechanism to an existing VoiceTree.
This script loads a tree from markdown files and runs the orphan connection agent.
"""

import asyncio
import logging
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.markdown_tree_manager.graph_flattening.tree_to_markdown import (
    TreeToMarkdownConverter,
)
from backend.markdown_tree_manager.markdown_to_tree.markdown_to_tree import (
    load_markdown_tree,
)
from backend.text_to_graph_pipeline.agentic_workflows.agents.connect_orphans_agent import (
    ConnectOrphansAgent,
)
from backend.text_to_graph_pipeline.chunk_processing_pipeline.apply_tree_actions import (
    TreeActionApplier,
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

    # Load the existing tree (returns MarkdownTree object)
    tree_data = load_markdown_tree(tree_path)

    # Create a DecisionTree from the loaded data
    from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree
    tree = MarkdownTree()
    tree.tree = tree_data.tree
    if tree_data.tree:
        tree.next_node_id = max(tree_data.tree.keys()) + 1

    # Count initial orphans
    initial_orphans = [
        (node_id, node.title) for node_id, node in tree.tree.items()
        if node.parent_id is None
    ]

    # todo, we should ignore orphan pairis that have already been processed and
    # are not related, but we hvae to be careful here, since other new pairs
    # may still be relevant.

    logger.info("Initial tree statistics:")
    logger.info(f"  Total nodes: {len(tree.tree)}")
    logger.info(f"  Orphan nodes: {len(initial_orphans)}")

    if len(initial_orphans) > 1:
        logger.info("\nOrphan nodes found:")
        for node_id, title in initial_orphans[:10]:  # Show first 10
            logger.info(f"    {node_id}: {title}")
        if len(initial_orphans) > 10:
            logger.info(f"    ... and {len(initial_orphans) - 10} more")

    # Run the connect orphans agent
    logger.info("\n" + "="*60)
    logger.info("Running Connect Orphans Agent...")
    logger.info("="*60)

    agent = ConnectOrphansAgent()
    actions = await agent.run(
        tree=tree,
        max_roots_to_process=20  # Process up to 20 roots at once
    )

    if actions:
        logger.info(f"\nAgent created {len(actions)} parent nodes:")
        for action in actions:
            # Type check: ConnectOrphansAgent should only return CreateAction instances
            if hasattr(action, 'new_node_name') and hasattr(action, 'summary'):
                logger.info(f"  • {action.new_node_name}")
                logger.info(f"    Summary: {action.summary[:100]}...")
            else:
                logger.warning(f"Unexpected action type: {type(action)}")

        # Apply the actions to create the parent nodes and link children
        # TreeActionApplier handles children_to_link automatically
        logger.info("\nApplying actions to tree...")
        applier = TreeActionApplier(tree)
        new_node_ids = applier.apply(actions)
        logger.info(f"Created and linked nodes with IDs: {new_node_ids}")

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

    logger.info("\n" + "="*60)
    logger.info("Final tree statistics:")
    logger.info(f"  Total nodes: {len(tree.tree)}")
    logger.info(f"  Orphan nodes: {len(final_orphans)}")
    logger.info(f"  Change: {len(initial_orphans)} → {len(final_orphans)} orphans")

    return tree, actions


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
    print("Default tree_path: backend/benchmarker/output_backups/user_guide_qa_audio_processing")
    print("\n" + "="*60 + "\n")

    asyncio.run(main())
