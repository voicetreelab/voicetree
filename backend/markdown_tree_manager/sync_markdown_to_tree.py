"""
Synchronize markdown file changes back to the tree data structure.

This module provides functionality to read markdown files and update
the corresponding nodes in the DecisionTree before UPDATE operations
are performed, ensuring manual edits are preserved.
"""

import logging
import os

from backend.markdown_tree_manager.markdown_to_tree.markdown_to_tree import (
    MarkdownToTreeConverter,
)
from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree


class MarkdownToTreeSynchronizer:
    """Synchronizes markdown file content back to tree nodes"""

    def __init__(self, decision_tree: MarkdownTree):
        """
        Initialize the synchronizer

        Args:
            decision_tree: The DecisionTree instance to sync to
        """
        self.decision_tree = decision_tree
        self.markdown_converter = MarkdownToTreeConverter()

    def sync_node_from_markdown(self, node_id: int) -> bool:
        """
        Sync a single node from its markdown file

        Args:
            node_id: The ID of the node to sync

        Returns:
            True if sync was successful, False otherwise
        """
        if node_id not in self.decision_tree.tree:
            logging.warning(f"Node {node_id} not found in tree, cannot sync")
            return False

        node = self.decision_tree.tree[node_id]

        # Get the markdown file path
        markdown_path = os.path.join(self.decision_tree.output_dir, node.filename)

        if not os.path.exists(markdown_path):
            logging.warning(f"Markdown file not found for node {node_id}: {markdown_path}")
            return False

        try:
            # Parse the markdown file
            parsed_node = self.markdown_converter._parse_markdown_file(markdown_path, node.filename)

            if not parsed_node:
                logging.warning(f"Failed to parse markdown file for node {node_id}")
                return False

            # Update the node in the tree with content from markdown
            # Only update content and summary, preserve other metadata
            if parsed_node.content != node.content or parsed_node.summary != node.summary:
                logging.info(f"Syncing node {node_id} from markdown: content or summary changed")
                # Use the tree's update method, but skip embeddings since content hasn't semantically changed
                self.decision_tree.update_node(
                    node_id=node_id,
                    content=parsed_node.content,
                    summary=parsed_node.summary,
                    update_embeddings=False  # Skip embeddings for sync operations
                )

            return True

        except Exception as e:
            logging.error(f"Error syncing node {node_id} from markdown: {e}")
            return False

    def sync_nodes_before_update(self, node_ids: set[int]) -> int:
        """
        Sync multiple nodes from their markdown files before UPDATE operations

        Args:
            node_ids: Set of node IDs to sync

        Returns:
            Number of successfully synced nodes
        """
        synced_count = 0

        for node_id in node_ids:
            if self.sync_node_from_markdown(node_id):
                synced_count += 1

        if synced_count > 0:
            logging.info(f"Successfully synced {synced_count}/{len(node_ids)} nodes from markdown")

        return synced_count

    def detect_and_remove_deleted_nodes(self) -> int:
        """
        Remove nodes whose markdown files no longer exist

        Returns:
            Number of nodes removed
        """
        removed_count = 0

        # Create a copy of the items to avoid modifying dict during iteration
        for node_id, node in list(self.decision_tree.tree.items()):
            markdown_path = os.path.join(self.decision_tree.output_dir, node.filename)
            if not os.path.exists(markdown_path):
                logging.info(f"Removing orphaned node {node_id}: {node.title}")
                if self.decision_tree.remove_node(node_id):
                    removed_count += 1

        return removed_count

    def sync_nodes_before_update_with_cleanup(self, node_ids: set[int]) -> tuple[int, int]:
        """
        Sync nodes from markdown and remove deleted nodes

        Args:
            node_ids: Set of node IDs to sync

        Returns:
            Tuple of (synced_count, removed_count)
        """
        # First sync existing nodes
        synced_count = self.sync_nodes_before_update(node_ids)

        # Then remove deleted nodes
        removed_count = self.detect_and_remove_deleted_nodes()
        if removed_count > 0:
            logging.info(f"Removed {removed_count} deleted nodes")

        return synced_count, removed_count


def sync_nodes_from_markdown(decision_tree: MarkdownTree, node_ids: set[int]) -> int:
    """
    Convenience function to sync nodes from markdown files and remove deleted nodes

    Args:
        decision_tree: The DecisionTree instance
        node_ids: Set of node IDs to sync

    Returns:
        Number of successfully synced nodes
    """
    synchronizer = MarkdownToTreeSynchronizer(decision_tree)
    synced_count = synchronizer.sync_nodes_before_update(node_ids)

    # Also remove nodes whose markdown files have been deleted
    removed_count = synchronizer.detect_and_remove_deleted_nodes()
    if removed_count > 0:
        logging.info(f"Removed {removed_count} nodes with deleted markdown files")

    return synced_count
