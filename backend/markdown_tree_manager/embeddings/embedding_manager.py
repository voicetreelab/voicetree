"""
Embedding manager for automatic synchronization of embeddings with tree modifications.
"""

import logging
from typing import Set, Dict, Optional, List, TYPE_CHECKING
from pathlib import Path

from .chromadb_vector_store import ChromaDBVectorStore

if TYPE_CHECKING:
    from ..markdown_tree_ds import MarkdownTree, Node

logger = logging.getLogger(__name__)


class EmbeddingManager:
    """
    Manages embeddings for the MarkdownTree.
    Automatically updates embeddings when nodes are modified.
    """

    def __init__(
        self,
        tree: 'MarkdownTree',
        collection_name: str = "voicetree_nodes",
        persist_directory: Optional[str] = None,
        enabled: bool = True
    ):
        """
        Initialize the EmbeddingManager.

        Args:
            tree: Reference to the MarkdownTree
            collection_name: Name for the ChromaDB collection
            persist_directory: Directory for ChromaDB persistence
            enabled: Whether embeddings are enabled
        """
        self.tree = tree
        self.enabled = enabled
        self.collection_name = collection_name

        if self.enabled:
            try:
                # Default to tree's output directory + embeddings
                if persist_directory is None:
                    persist_directory = str(Path(tree.output_dir) / "chromadb_data")

                self.vector_store = ChromaDBVectorStore(
                    collection_name=collection_name,
                    persist_directory=persist_directory,
                    use_embeddings=True
                )
                logger.info(f"EmbeddingManager initialized with ChromaDB at {persist_directory}")
            except Exception as e:
                logger.error(f"Failed to initialize ChromaDB: {e}")
                self.enabled = False
                self.vector_store = None
        else:
            self.vector_store = None
            logger.info("EmbeddingManager initialized but disabled")

    def update_embeddings(self, node_ids: Set[int]) -> None:
        """
        Update embeddings for specific nodes.

        Args:
            node_ids: Set of node IDs to update embeddings for
        """
        if not self.enabled or not self.vector_store or not node_ids:
            return

        try:
            # Get nodes from tree (using internal access since we're a friend class)
            nodes_to_update = {}
            for node_id in node_ids:
                if node_id in self.tree._tree:
                    nodes_to_update[node_id] = self.tree._tree[node_id]

            if nodes_to_update:
                self.vector_store.add_nodes(nodes_to_update)
                logger.info(f"Updated embeddings for {len(nodes_to_update)} nodes: {list(nodes_to_update.keys())}")

        except Exception as e:
            logger.error(f"Failed to update embeddings for nodes {node_ids}: {e}")

    def delete_embeddings(self, node_ids: Set[int]) -> None:
        """
        Delete embeddings for specific nodes.

        Args:
            node_ids: Set of node IDs to delete embeddings for
        """
        if not self.enabled or not self.vector_store or not node_ids:
            return

        try:
            self.vector_store.delete_nodes(list(node_ids))
            logger.info(f"Deleted embeddings for nodes: {node_ids}")
        except Exception as e:
            logger.error(f"Failed to delete embeddings for nodes {node_ids}: {e}")

    def sync_all_embeddings(self) -> None:
        """
        Synchronize all embeddings with current tree state.
        Useful for initial setup or recovery.
        """
        if not self.enabled or not self.vector_store:
            return

        try:
            # Get all nodes from tree
            all_nodes = self.tree._tree.copy()

            if all_nodes:
                self.vector_store.add_nodes(all_nodes)
                logger.info(f"Synced all {len(all_nodes)} nodes to embeddings")
            else:
                logger.warning("No nodes to sync to embeddings")

        except Exception as e:
            logger.error(f"Failed to sync all embeddings: {e}")

    def search(
        self,
        query: str,
        top_k: int = 10,
        filter_dict: Optional[Dict] = None
    ) -> List[int]:
        """
        Search for similar nodes using vector similarity.

        Args:
            query: Search query text
            top_k: Number of results to return
            filter_dict: Optional metadata filters

        Returns:
            List of node IDs ordered by relevance
        """
        if not self.enabled or not self.vector_store:
            logger.warning("Embeddings not enabled, cannot perform search")
            return []

        try:
            results = self.vector_store.search(
                query=query,
                top_k=top_k,
                filter_dict=filter_dict,
                include_scores=False
            )
            return results

        except Exception as e:
            logger.error(f"Search failed: {e}")
            return []

    def get_stats(self) -> Dict:
        """
        Get statistics about the embeddings.

        Returns:
            Dictionary with embedding statistics
        """
        if not self.enabled or not self.vector_store:
            return {"enabled": False, "count": 0}

        try:
            stats = self.vector_store.get_collection_stats()
            stats["enabled"] = True
            return stats
        except Exception as e:
            logger.error(f"Failed to get embedding stats: {e}")
            return {"enabled": True, "error": str(e)}

    def clear_all_embeddings(self) -> None:
        """Clear all embeddings from the vector store."""
        if not self.enabled or not self.vector_store:
            return

        try:
            self.vector_store.clear_collection()
            logger.info("Cleared all embeddings")
        except Exception as e:
            logger.error(f"Failed to clear embeddings: {e}")

    def enable(self) -> None:
        """Enable embeddings and initialize vector store if needed."""
        if not self.enabled:
            self.enabled = True
            if not self.vector_store:
                self.__init__(self.tree, self.collection_name)

    def disable(self) -> None:
        """Disable embeddings without destroying the vector store."""
        self.enabled = False
        logger.info("Embeddings disabled")