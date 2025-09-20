"""
ChromaDB vector store implementation for context retrieval.
Uses ChromaDB with Google Gemini embeddings for efficient vector search.
"""

import os
import logging
from typing import List, Dict, Tuple, Optional, Any, Union
import chromadb
from chromadb.config import Settings
import chromadb.utils.embedding_functions as embedding_functions
from dotenv import load_dotenv

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
    ):
        """
        Initialize ChromaDB vector store.

        Args:
            collection_name: Name of the ChromaDB collection
            persist_directory: Directory to persist ChromaDB data (default: backend/chromadb_data)
            use_embeddings: Whether to use embeddings (can be disabled for testing)
        """
        self.collection_name = collection_name
        self.use_embeddings = use_embeddings

        # Set default persist directory if not provided
        # Consolidate all ChromaDB storage to markdown tree vault location
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

        # Initialize ChromaDB client with persistence
        self.client = chromadb.PersistentClient(
            path=persist_directory,
            settings=Settings(
                anonymized_telemetry=False,
                allow_reset=True
            )
        )

        # Initialize Gemini embedding function if embeddings are enabled
        self.embedding_function = None
        if use_embeddings:
            api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
            if not api_key:
                raise ValueError("GEMINI_API_KEY or GOOGLE_API_KEY environment variable not set")

            self.embedding_function = embedding_functions.GoogleGenerativeAiEmbeddingFunction(
                api_key=api_key,
                model_name="models/text-embedding-004",
                task_type="retrieval_document"
            )
            logger.info("Initialized ChromaDB with Gemini embeddings")

        # Get or create collection
        self._initialize_collection()

    def _initialize_collection(self):
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

    def add_nodes(self, nodes: Dict[int, Any]) -> None:
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
            # Upsert nodes (add or update)
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
        filter_dict: Optional[Dict] = None,
        include_scores: bool = True
    ) -> Union[List[Tuple[int, float]], List[int]]:
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

            if not results['ids'] or not results['ids'][0]:
                return []

            # Extract node IDs and scores
            if include_scores:
                node_results_with_scores: List[Tuple[int, float]] = []
                for id_str, distance in zip(results['ids'][0], results['distances'][0]):
                    # Extract node_id from the ID string (format: "node_123")
                    node_id = int(id_str.replace('node_', ''))

                    # Convert distance to similarity score (1 - normalized_distance)
                    # ChromaDB returns L2 distance for cosine space, so we convert
                    similarity = 1.0 - (distance / 2.0)  # Normalize to [0, 1]
                    node_results_with_scores.append((node_id, similarity))

                logger.info(f"Found {len(node_results_with_scores)} similar nodes for query: '{query[:50]}...'")
                return node_results_with_scores
            else:
                node_results_ids: List[int] = []
                for id_str, distance in zip(results['ids'][0], results['distances'][0]):
                    # Extract node_id from the ID string (format: "node_123")
                    node_id = int(id_str.replace('node_', ''))
                    node_results_ids.append(node_id)

                logger.info(f"Found {len(node_results_ids)} similar nodes for query: '{query[:50]}...'")
                return node_results_ids

        except Exception as e:
            logger.error(f"Search failed: {e}")
            return []

    def get_node_by_id(self, node_id: int) -> Optional[Dict]:
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

            if result['ids']:
                return {
                    'metadata': result['metadatas'][0],
                    'document': result['documents'][0] if result['documents'] else None
                }
            return None

        except Exception as e:
            logger.error(f"Failed to get node {node_id}: {e}")
            return None

    def delete_nodes(self, node_ids: List[int]) -> None:
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

    def get_collection_stats(self) -> Dict:
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

    def hybrid_search(
        self,
        query: str,
        keyword_results: List[int],
        top_k: int = 10,
        alpha: float = 0.5
    ) -> List[int]:
        """
        Combine vector search with keyword search results.

        Args:
            query: Search query
            keyword_results: Node IDs from keyword/TF-IDF search
            top_k: Number of results to return
            alpha: Weight for vector search (0-1, higher = more vector weight)

        Returns:
            Combined ranked list of node IDs
        """
        # Get vector search results
        vector_results_raw = self.search(query, top_k=top_k * 2, include_scores=True)

        # Type guard to ensure we have tuples
        if not vector_results_raw or not isinstance(vector_results_raw[0], tuple):
            return keyword_results[:top_k]

        vector_results: List[Tuple[int, float]] = vector_results_raw  # type: ignore

        # Combine scores
        combined_scores = {}

        # Add keyword results with decreasing scores
        for i, node_id in enumerate(keyword_results):
            score = 1.0 - (i / len(keyword_results)) if keyword_results else 0
            combined_scores[node_id] = (1 - alpha) * score

        # Add vector search scores
        for node_id, similarity in vector_results:
            if node_id in combined_scores:
                combined_scores[node_id] += alpha * similarity
            else:
                combined_scores[node_id] = alpha * similarity

        # Sort by combined score and return top-k
        ranked = sorted(combined_scores.items(), key=lambda x: x[1], reverse=True)
        return [node_id for node_id, _ in ranked[:top_k]]


# Convenience function for backward compatibility
def find_relevant_nodes_with_chroma(
    tree: Dict,
    query: str,
    top_k: int = 10,
    collection_name: str = "voicetree_nodes",
    persist_directory: Optional[str] = None
) -> List[int]:
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