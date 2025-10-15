"""
Embedding manager for automatic synchronization of embeddings with tree modifications.
"""

import logging
from pathlib import Path
from typing import TYPE_CHECKING
from typing import Any
from typing import List
from typing import Optional
from typing import Set

from backend.markdown_tree_manager.embeddings.chromadb_vector_store import (
    ChromaDBVectorStore,
)

if TYPE_CHECKING:
    from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree

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
        self.vector_store: Optional[ChromaDBVectorStore] = None

        if self.enabled:
            # Default to tree's output directory + embeddings
            if persist_directory is None:
                persist_directory = str(Path(tree.output_dir) / "chromadb_data")

            self.vector_store = ChromaDBVectorStore(
                collection_name=collection_name,
                persist_directory=persist_directory,
                use_embeddings=True
            )
            logger.info(f"EmbeddingManager initialized with {self.vector_store.get_collection_stats().get('count', 0)} nodes with ChromaDB at {persist_directory}")
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

        # Get nodes from tree (using internal access since we're a friend class)
        nodes_to_update = {}
        for node_id in node_ids:
            if node_id in self.tree.tree:
                nodes_to_update[node_id] = self.tree.tree[node_id]

        if nodes_to_update:
            self.vector_store.add_nodes(nodes_to_update)
            logger.info(f"Updated embeddings for {len(nodes_to_update)} nodes: {list(nodes_to_update.keys())}")

    def delete_embeddings(self, node_ids: Set[int]) -> None:
        """
        Delete embeddings for specific nodes.

        Args:
            node_ids: Set of node IDs to delete embeddings for
        """
        if not self.enabled or not self.vector_store or not node_ids:
            return

        self.vector_store.delete_nodes(list(node_ids))
        logger.info(f"Deleted embeddings for nodes: {node_ids}")

    def sync_all_embeddings(self) -> None:
        """
        Synchronize all embeddings with current tree state.
        Useful for initial setup or recovery.
        """
        if not self.enabled or not self.vector_store:
            return

        # Get all nodes from tree
        all_nodes = self.tree.tree.copy()

        if all_nodes:
            self.vector_store.add_nodes(all_nodes)
            logger.info(f"Synced all {len(all_nodes)} nodes to embeddings")
        else:
            logger.warning("No nodes to sync to embeddings")

    def search(
        self,
        query: str,
        top_k: int = 10,
        filter_dict: Optional[dict[str, Any]] = None
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

        results = self.vector_store.search(
            query=query,
            top_k=top_k,
            filter_dict=filter_dict,
            include_scores=False
        )
        # Ensure we return List[int] as expected by type annotation
        # include_scores=False should always return List[int], but MyPy can't infer this
        if isinstance(results, list):
            if all(isinstance(x, int) for x in results):
                return results
            elif all(isinstance(x, tuple) for x in results):
                # Extract just the ids from tuples (shouldn't happen with include_scores=False)
                return [x[0] for x in results if isinstance(x, tuple) and len(x) >= 1]
        return []

    def get_stats(self) -> dict[str, Any]:
        """
        Get statistics about the embeddings.

        Returns:
            Dictionary with embedding statistics
        """
        if not self.enabled or not self.vector_store:
            return {"enabled": False, "count": 0}

        stats = self.vector_store.get_collection_stats()
        stats["enabled"] = True
        return stats

    def clear_all_embeddings(self) -> None:
        """Clear all embeddings from the vector store."""
        if not self.enabled or not self.vector_store:
            return

        self.vector_store.clear_collection()
        logger.info("Cleared all embeddings")

    def enable(self) -> None:
        """Enable embeddings and initialize vector store if needed."""
        if not self.enabled:
            self.enabled = True
            if not self.vector_store:
                # Reinitialize vector store instead of calling __init__
                from pathlib import Path
                persist_directory = str(Path(self.tree.output_dir) / "chromadb_data")
                self.vector_store = ChromaDBVectorStore(
                    collection_name=self.collection_name,
                    persist_directory=persist_directory,
                    use_embeddings=True
                )
                logger.info(f"Re-initialized EmbeddingManager with ChromaDB at {persist_directory}")

    def disable(self) -> None:
        """Disable embeddings without destroying the vector store."""
        self.enabled = False
        logger.info("Embeddings disabled")
