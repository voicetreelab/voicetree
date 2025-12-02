"""
ChromaDB vector store implementation for context retrieval.
Uses ChromaDB with Google Gemini embeddings for efficient vector search.
"""

import logging
import os
from typing import Any
from typing import Optional
from typing import Union
from typing import cast

import chromadb
import chromadb.utils.embedding_functions as embedding_functions
from chromadb.config import Settings
from dotenv import load_dotenv

from backend.types import ChromaGetResult, ChromaQueryResult, VectorDocument

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ChromaDBVectorStore:
    """
    ChromaDB-based vector store for VoiceTree context retrieval.
    Provides persistent storage and efficient similarity search using Gemini embeddings.
    """

    def __init__(
        self,
        collection_name: str = "voicetree_nodes",
        persist_directory: Optional[str] = None,
        use_embeddings: bool = True
    ) -> None:
        """
        Initialize ChromaDB vector store.

        Args:
            collection_name: Name of the ChromaDB collection
            persist_directory: Directory to persist ChromaDB data (default: backend/chromadb_data)
                             If None, uses in-memory mode for tests or default location for production
            use_embeddings: Whether to use embeddings (can be disabled for testing)
        """
        self.collection_name = collection_name
        self.use_embeddings = use_embeddings

        # Check if we're in test mode - use in-memory ChromaDB for tests
        is_test_mode = os.getenv('VOICETREE_TEST_MODE', '').lower() == 'true'

        # Detect if persist_directory is a temp directory (common patterns across platforms)
        is_temp_dir = False
        if persist_directory:
            import tempfile
            temp_base = tempfile.gettempdir()  # Gets /tmp on Linux, /var/folders/... on macOS
            is_temp_dir = persist_directory.startswith(temp_base)

        # For test mode OR temp directories, use in-memory ChromaDB to avoid SQLite locking issues
        if is_test_mode or is_temp_dir:
            # Use in-memory ChromaDB for tests - eliminates file I/O and SQLite locking issues
            self.client = chromadb.Client(
                settings=Settings(
                    anonymized_telemetry=False,
                    allow_reset=True
                )
            )
            self.persist_directory = None  # No persistence
            logger.info("Initialized ChromaDB in ephemeral (in-memory) mode for tests")
        else:
            # Production mode: Use persistent storage
            # Set default persist directory if not provided
            if persist_directory is None:
                # Try to find markdown tree vault directory
                project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
                markdown_vault_path = os.path.join(project_root, "markdownTreeVault", "chromadb_data")

                # Fall back to backend location if vault not found
                if os.path.exists(os.path.join(project_root, "markdownTreeVault")):
                    persist_directory = markdown_vault_path
                else:
                    persist_directory = os.path.join(
                        os.path.dirname(os.path.dirname(__file__)),
                        "chromadb_data"
                    )

            self.persist_directory = persist_directory

            # Ensure the persist directory exists
            from pathlib import Path
            persist_path = Path(persist_directory)
            persist_path.mkdir(parents=True, exist_ok=True)

            # Initialize ChromaDB client with persistence
            self.client = chromadb.PersistentClient(
                path=persist_directory,
                settings=Settings(
                    anonymized_telemetry=False,
                    allow_reset=True,
                    is_persistent=True
                )
            )
            logger.info(f"Initialized ChromaDB with persistence at {persist_directory}")

        self.embedding_function = None


                # Chroma's DefaultEmbeddingFunction wraps an ONNX MiniLM model and auto-downloads it on first use.
        self.embedding_function = embedding_functions.DefaultEmbeddingFunction()
        logger.info("Configured Chroma DefaultEmbeddingFunction (ONNX MiniLM local embeddings)")

        # Get or create collection
        self._initialize_collection()

    def _initialize_collection(self) -> None:
        """Initialize or get the ChromaDB collection."""
        try:
            # Try to get existing collection
            if self.embedding_function:
                self.collection = self.client.get_collection(
                    name=self.collection_name,
                    embedding_function=self.embedding_function
                )
            else:
                self.collection = self.client.get_collection(name=self.collection_name)
            logger.info(f"Using existing collection: {self.collection_name}")
        except Exception:
            # Create new collection if it doesn't exist
            if self.embedding_function:
                self.collection = self.client.create_collection(
                    name=self.collection_name,
                    embedding_function=self.embedding_function,
                    metadata={"hnsw:space": "cosine"}  # Use cosine similarity
                )
            else:
                self.collection = self.client.create_collection(
                    name=self.collection_name,
                    metadata={"hnsw:space": "cosine"}
                )
            logger.info(f"Created new collection: {self.collection_name}")

    def add_nodes(self, nodes: dict[int, Any]) -> None:
        """
        Add or update nodes in the vector store.

        Args:
            nodes: Dictionary of node_id -> Node objects
        """
        if not nodes:
            return

        # Prepare batch data
        ids = []
        documents = []
        metadatas = []

        for node_id, node in nodes.items():
            # Create combined text for embedding (weighted)
            text_parts = []

            # Weight title 3x for better relevance
            if hasattr(node, 'title') and node.title:
                text_parts.extend([node.title] * 3)

            # Weight summary 2x
            if hasattr(node, 'summary') and node.summary:
                text_parts.extend([node.summary] * 2)

            # Include content snippet
            if hasattr(node, 'content') and node.content:
                text_parts.append(node.content[:500])

            combined_text = " ".join(text_parts)

            if combined_text.strip():
                ids.append(f"node_{node_id}")
                documents.append(combined_text)

                # Add metadata for filtering
                metadata = {
                    "node_id": node_id,
                    "title": getattr(node, 'title', ''),
                    "has_summary": bool(getattr(node, 'summary', None)),
                    "content_length": len(getattr(node, 'content', ''))
                }

                # Add optional metadata fields
                if hasattr(node, 'depth'):
                    metadata['depth'] = node.depth
                if hasattr(node, 'node_type'):
                    metadata['node_type'] = node.node_type
                if hasattr(node, 'created_at'):
                    metadata['created_at'] = str(node.created_at)

                metadatas.append(metadata)

        if ids:
            # Upsert nodes to ChromaDB
            self.collection.upsert(
                ids=ids,
                documents=documents,
                metadatas=metadatas
            )
            logger.info(f"Added/updated {len(ids)} nodes to ChromaDB")

    def search(
        self,
        query: str,
        top_k: int = 10,
        filter_dict: Optional[dict[str, Any]] = None,
        include_scores: bool = True
    ) -> Union[list[tuple[int, float]], list[int]]:
        """
        Search for similar nodes using vector similarity.

        Args:
            query: Search query text
            top_k: Number of results to return
            filter_dict: Optional metadata filters (e.g., {"depth": {"$lte": 3}})
            include_scores: Whether to include similarity scores

        Returns:
            List of (node_id, similarity_score) tuples if include_scores=True,
            otherwise just list of node_ids
        """
        if not self.use_embeddings or not query.strip():
            return []

        try:
            # Query the collection
            results = self.collection.query(
                query_texts=[query],
                n_results=top_k,
                where=filter_dict,
                include=['metadatas', 'distances']
            )

            results_typed = cast(ChromaQueryResult, results)
            if not results_typed['ids'] or not results_typed['ids'][0]:
                return []

            # DEBUG LOGGING: Log raw ChromaDB results
            logger.info(f"[DEBUG] Raw ChromaDB query results for '{query[:50]}...':")
            for i, (id_str, distance) in enumerate(zip(results_typed['ids'][0], results_typed['distances'][0])):
                node_id = int(id_str.replace('node_', ''))
                similarity = 1.0 - (distance / 2.0)
                logger.info(f"  {i+1}. Node {node_id}: distance={distance:.4f}, similarity={similarity:.4f}")

            # Extract node IDs and scores
            if include_scores:
                node_results_with_scores: list[tuple[int, float]] = []
                for id_str, distance in zip(results_typed['ids'][0], results_typed['distances'][0]):
                    # Extract node_id from the ID string (format: "node_123")
                    node_id = int(id_str.replace('node_', ''))

                    # Convert distance to similarity score (1 - normalized_distance)
                    # ChromaDB returns L2 distance for cosine space, so we convert
                    similarity = 1.0 - (distance / 2.0)  # Normalize to [0, 1]
                    node_results_with_scores.append((node_id, similarity))

                logger.info(f"Found {len(node_results_with_scores)} similar nodes for query: '{query[:50]}...'")
                return node_results_with_scores
            else:
                node_results_ids: list[int] = []
                for id_str, _distance in zip(results_typed['ids'][0], results_typed['distances'][0]):
                    # Extract node_id from the ID string (format: "node_123")
                    node_id = int(id_str.replace('node_', ''))
                    node_results_ids.append(node_id)

                logger.info(f"Found {len(node_results_ids)} similar nodes for query: '{query[:50]}...'")
                return node_results_ids

        except Exception as e:
            logger.error(f"Search failed: {e}")
            return []

    def get_node_by_id(self, node_id: int) -> Optional[VectorDocument]:
        """
        Retrieve a specific node's metadata by ID.

        Args:
            node_id: The node ID to retrieve

        Returns:
            Node metadata dictionary or None if not found
        """
        try:
            result = self.collection.get(
                ids=[f"node_{node_id}"],
                include=['metadatas', 'documents']
            )

            result_typed = cast(ChromaGetResult, result)
            if result_typed['ids']:
                vector_doc: VectorDocument = {
                    'metadata': result_typed['metadatas'][0],
                    'document': result_typed['documents'][0] if result_typed['documents'] else None
                }
                return vector_doc
            return None

        except Exception as e:
            logger.error(f"Failed to get node {node_id}: {e}")
            return None

    def delete_nodes(self, node_ids: list[int]) -> None:
        """
        Delete nodes from the vector store.

        Args:
            node_ids: List of node IDs to delete
        """
        if not node_ids:
            return

        ids = [f"node_{node_id}" for node_id in node_ids]
        self.collection.delete(ids=ids)
        logger.info(f"Deleted {len(ids)} nodes from ChromaDB")

    def clear_collection(self) -> None:
        """Clear all data from the collection."""
        try:
            # Delete and recreate the collection
            self.client.delete_collection(name=self.collection_name)
            self._initialize_collection()
            logger.info(f"Cleared collection: {self.collection_name}")
        except Exception as e:
            logger.error(f"Failed to clear collection: {e}")

    def get_collection_stats(self) -> dict[str, Any]:
        """
        Get statistics about the collection.

        Returns:
            Dictionary with collection statistics
        """
        try:
            count = self.collection.count()
            return {
                'name': self.collection_name,
                'count': count,
                'persist_directory': self.persist_directory,
                'embeddings_enabled': self.use_embeddings
            }
        except Exception as e:
            logger.error(f"Failed to get collection stats: {e}")
            return {}

    def get_all_node_ids(self) -> set[int]:
        """
        Get all node IDs currently stored in ChromaDB.

        Returns:
            Set of node IDs in the vector store
        """
        try:
            # Get all document IDs from the collection
            result = self.collection.get(include=[])
            if not result['ids']:
                return set()

            # Extract node IDs from the ID strings (format: "node_123")
            node_ids = set()
            for id_str in result['ids']:
                try:
                    node_id = int(id_str.replace('node_', ''))
                    node_ids.add(node_id)
                except ValueError:
                    logger.warning(f"Could not parse node ID from: {id_str}")

            return node_ids
        except Exception as e:
            logger.error(f"Failed to get all node IDs: {e}")
            return set()


# Convenience function for backward compatibility
def find_relevant_nodes_with_chroma(
    tree: dict[int, Any],
    query: str,
    top_k: int = 10,
    collection_name: str = "voicetree_nodes",
    persist_directory: Optional[str] = None
) -> list[int]:
    """
    Find the most relevant nodes using ChromaDB.
    This function provides backward compatibility with the existing API.

    Args:
        tree: Dictionary of node_id -> Node objects
        query: Search query
        top_k: Number of nodes to retrieve
        collection_name: ChromaDB collection name
        persist_directory: Directory to persist ChromaDB data

    Returns:
        List of node IDs ordered by relevance
    """
    # Initialize ChromaDB store
    store = ChromaDBVectorStore(
        collection_name=collection_name,
        persist_directory=persist_directory
    )

    # Add nodes to the store (will update existing ones)
    store.add_nodes(tree)

    # Search and return results
    results = store.search(query, top_k=top_k, include_scores=False)
    # Type guard to ensure we return List[int] when include_scores=False
    if isinstance(results, list) and (not results or isinstance(results[0], int)):
        return results  # type: ignore
    else:
        # Fallback if something went wrong
        return [r[0] if isinstance(r, tuple) else r for r in results]
