"""
Vector search functionality for context retrieval.
Uses Gemini embeddings to find semantically similar nodes.
"""

import os
import numpy as np
from pathlib import Path
from typing import List, Dict, Tuple, Optional
import logging
import google.generativeai as genai
from dotenv import load_dotenv

# Import ChromaDB store if available
try:
    from backend.markdown_tree_manager.embeddings.chromadb_vector_store import ChromaDBVectorStore
    CHROMADB_AVAILABLE = True
    ChromaDBVectorStoreType = ChromaDBVectorStore
except ImportError:
    CHROMADB_AVAILABLE = False
    ChromaDBVectorStoreType = None  # type: ignore
    logging.info("ChromaDB not available, falling back to in-memory search")

# Load environment variables from .env file
load_dotenv()

# Enable embeddings - can be toggled via environment variable
USE_EMBEDDINGS = os.getenv("VOICETREE_USE_EMBEDDINGS", "true").lower() == "true"
# In test mode, don't use ChromaDB for hybrid search
IS_TEST_MODE = os.getenv("VOICETREE_TEST_MODE", "").lower() == "true"
USE_CHROMADB = (os.getenv("VOICETREE_USE_CHROMADB", "true").lower() == "true"
                and CHROMADB_AVAILABLE
                and not IS_TEST_MODE)

# Configure Gemini API
_gemini_configured = False

def _configure_gemini():
    """Configure Gemini API (call once)"""
    global _gemini_configured
    if not _gemini_configured:
        # Try both possible env var names
        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY or GOOGLE_API_KEY environment variable not set")
        genai.configure(api_key=api_key)
        _gemini_configured = True
        logging.info("Configured Gemini API for embeddings")

def get_node_embeddings(nodes: Dict) -> Dict[int, np.ndarray]:
    """
    Get embeddings for all nodes in the tree using Google Gemini.
    
    Args:
        nodes: Dictionary of node_id -> Node objects
        
    Returns:
        Dictionary of node_id -> embedding vector
    """
    if not USE_EMBEDDINGS or not nodes:
        return {}
    
    try:
        _configure_gemini()
        embeddings = {}
        
        # Prepare texts for batch encoding
        texts = []
        node_ids = []
        
        for node_id, node in nodes.items():
            # Combine title (3x weight), summary (2x), and content snippet
            # This weighting helps prioritize title matches
            text_parts = []
            if hasattr(node, 'title') and node.title:
                text_parts.extend([node.title] * 3)  # Weight title 3x
            if hasattr(node, 'summary') and node.summary:
                text_parts.extend([node.summary] * 2)  # Weight summary 2x
            if hasattr(node, 'content') and node.content:
                text_parts.append(node.content[:500])  # First 500 chars of content
            
            combined_text = " ".join(text_parts)
            if combined_text.strip():  # Only process non-empty nodes
                texts.append(combined_text)
                node_ids.append(node_id)
        
        if texts:
            # Use Gemini's text-embedding-004 model (768 dimensions)
            # Batch process for efficiency
            for text, node_id in zip(texts, node_ids):
                result = genai.embed_content(
                    model="models/text-embedding-004",
                    content=text,
                    task_type="retrieval_document",
                    title=f"Node {node_id}"  # Optional title for better context
                )
                embeddings[node_id] = np.array(result['embedding'])
            
            logging.info(f"Generated Gemini embeddings for {len(embeddings)} nodes")
        
        return embeddings
        
    except Exception as e:
        logging.error(f"Failed to generate Gemini embeddings: {e}")
        return {}


def find_similar_by_embedding(
    query: str,
    node_embeddings: Dict[int, np.ndarray],
    top_k: int = 10,
    threshold: float = 0.3,
    query_embedding: Optional[np.ndarray] = None
) -> List[Tuple[int, float]]:
    """
    Find nodes similar to query using embeddings.
    
    Args:
        query: Search query
        node_embeddings: Pre-computed node embeddings
        top_k: Number of results to return
        threshold: Minimum similarity threshold (lowered to 0.3 for better recall)
        query_embedding: Optional pre-computed query embedding
        
    Returns:
        List of (node_id, similarity_score) tuples
    """
    if not USE_EMBEDDINGS or not node_embeddings:
        return []
    
    # Use pre-computed query embedding if provided
    if query_embedding is None:
        if not query.strip():
            return []
        try:
            _configure_gemini()
            
            # Generate embedding for query using Gemini
            result = genai.embed_content(
                model="models/text-embedding-004",
                content=query,
                task_type="retrieval_query"  # Use query task type for search
            )
            query_embedding = np.array(result['embedding'])
        except Exception as e:
            logging.error(f"Failed to generate query embedding: {e}")
            return []
    
    try:
        # Compute cosine similarities with all node embeddings
        similarities = []
        for node_id, node_embedding in node_embeddings.items():
            # Compute cosine similarity
            similarity = np.dot(query_embedding, node_embedding) / (
                np.linalg.norm(query_embedding) * np.linalg.norm(node_embedding)
            )
            
            if similarity > threshold:
                similarities.append((node_id, float(similarity)))
        
        # Sort by similarity score (highest first)
        similarities.sort(key=lambda x: x[1], reverse=True)
        
        # Return top-k results
        results = similarities[:top_k]
        
        if results:
            logging.info(f"Found {len(results)} similar nodes using Gemini for query: '{query[:50]}...'")
        
        return results
        
    except Exception as e:
        logging.error(f"Failed to find similar nodes with Gemini: {e}")
        return []


def find_relevant_nodes_for_context(
    tree: Dict,
    query: str,
    top_k: int = 10,
    persist_directory: Optional[str] = None
) -> List[int]:
    """
    Find the most relevant nodes for a given query using vector search.
    This is the main entry point for context retrieval.

    Args:
        tree: Dictionary of node_id -> Node objects
        query: Search query
        top_k: Number of nodes to retrieve
        persist_directory: Optional ChromaDB persistence directory

    Returns:
        List of node IDs ordered by relevance
    """
    if not USE_EMBEDDINGS or not tree:
        logging.info("Vector search disabled or empty tree")
        return []

    # Always use ChromaDB for vector search (eliminates duplication)
    if CHROMADB_AVAILABLE:
        logging.info("Using ChromaDB for vector search")
        store = ChromaDBVectorStore(persist_directory=persist_directory)
        store.add_nodes(tree)
        results = store.search(query, top_k=top_k, include_scores=False)
        # include_scores=False should return List[int]
        return results if isinstance(results, list) and all(isinstance(x, int) for x in results) else []

    # ChromaDB not available - generate embeddings in memory only
    logging.warning("ChromaDB not available, using in-memory search")
    embeddings = get_node_embeddings(tree)

    if not embeddings:
        logging.warning("No embeddings available")
        return []

    # Find similar nodes using in-memory search
    results = find_similar_by_embedding(query, embeddings, top_k=top_k)

    # Extract just the node IDs
    node_ids = [node_id for node_id, _ in results]

    return node_ids


def hybrid_search(
    query: str,
    tfidf_results: List[int],
    embedding_results: List[Tuple[int, float]],
    alpha: float = 0.5,
    use_chromadb: Optional[bool] = None
) -> List[int]:
    """
    Combine TF-IDF and embedding results using weighted scoring.

    Args:
        query: Original search query
        tfidf_results: Node IDs from TF-IDF search
        embedding_results: (node_id, score) from embedding search
        alpha: Weight for embedding scores (0-1)
        use_chromadb: Whether to use ChromaDB for hybrid search

    Returns:
        Combined ranked list of node IDs
    """
    # Check if we should use ChromaDB's hybrid search
    if use_chromadb is None:
        use_chromadb = USE_CHROMADB

    if use_chromadb and CHROMADB_AVAILABLE and hasattr(ChromaDBVectorStore, 'hybrid_search'):
        store = ChromaDBVectorStoreType()
        return store.hybrid_search(query, tfidf_results, top_k=len(tfidf_results), alpha=alpha)

    # Fallback to manual combination
    if not embedding_results:
        return tfidf_results
    
    # Combine scores with weighting
    combined_scores = {}
    
    # Add TF-IDF results with decreasing scores
    for i, node_id in enumerate(tfidf_results):
        score = 1.0 - (i / len(tfidf_results))
        combined_scores[node_id] = (1 - alpha) * score
    
    # Add embedding scores
    for node_id, score in embedding_results:
        if node_id in combined_scores:
            combined_scores[node_id] += alpha * score
        else:
            combined_scores[node_id] = alpha * score
    
    # Sort by combined score
    ranked = sorted(combined_scores.items(), key=lambda x: x[1], reverse=True)
    return [node_id for node_id, _ in ranked]


# For NoLiMa-specific improvements
def extract_key_entities(text: str) -> List[str]:
    """
    Extract key entities from text that are crucial for NoLiMa questions.
    E.g., character names, locations, objects.
    
    Args:
        text: Input text
        
    Returns:
        List of key entities
    """
    # Simple heuristic: look for capitalized words (names, places)
    import re
    
    # Find capitalized words that aren't at sentence starts
    entities = re.findall(r'(?<![.!?]\s)\b[A-Z][a-z]+\b', text)
    
    # Add special patterns for NoLiMa
    # Character names often appear with actions
    character_patterns = [
        r'(\b[A-Z][a-z]+) (?:said|mentioned|saw|visited|went|has been|is|was)',
        r'(?:told|asked|showed) (\b[A-Z][a-z]+)',
    ]
    
    for pattern in character_patterns:
        matches = re.findall(pattern, text)
        entities.extend(matches)
    
    # Deduplicate while preserving order
    seen = set()
    unique_entities = []
    for entity in entities:
        if entity not in seen:
            seen.add(entity)
            unique_entities.append(entity)
    
    return unique_entities