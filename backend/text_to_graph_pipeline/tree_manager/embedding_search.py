"""
Embedding-based semantic search for VoiceTree nodes.
This provides true semantic matching beyond TF-IDF's keyword matching.
"""

import os
import numpy as np
from typing import List, Dict, Tuple
import logging

# Placeholder for future implementation
USE_EMBEDDINGS = os.getenv("VOICETREE_USE_EMBEDDINGS", "false").lower() == "true"

def get_node_embeddings(nodes: Dict) -> Dict[int, np.ndarray]:
    """
    Get embeddings for all nodes in the tree.
    
    Args:
        nodes: Dictionary of node_id -> Node objects
        
    Returns:
        Dictionary of node_id -> embedding vector
    """
    if not USE_EMBEDDINGS:
        return {}
    
    # TODO: Implement actual embedding generation
    # Options:
    # 1. Google Gemini: gemini-embedding-001 (mentioned in comments)
    # 2. OpenAI: text-embedding-ada-002
    # 3. Sentence Transformers (local): all-MiniLM-L6-v2
    #
    # Example with sentence-transformers (runs locally, no API needed):
    # from sentence_transformers import SentenceTransformer
    # model = SentenceTransformer('all-MiniLM-L6-v2')
    # 
    # embeddings = {}
    # for node_id, node in nodes.items():
    #     text = f"{node.title} {node.summary} {node.content[:500]}"
    #     embeddings[node_id] = model.encode(text)
    # return embeddings
    
    logging.info("Embedding generation not yet implemented")
    return {}


def find_similar_by_embedding(
    query: str,
    node_embeddings: Dict[int, np.ndarray],
    top_k: int = 5,
    threshold: float = 0.5
) -> List[Tuple[int, float]]:
    """
    Find nodes similar to query using embeddings.
    
    Args:
        query: Search query
        node_embeddings: Pre-computed node embeddings
        top_k: Number of results to return
        threshold: Minimum similarity threshold
        
    Returns:
        List of (node_id, similarity_score) tuples
    """
    if not USE_EMBEDDINGS or not node_embeddings:
        return []
    
    # TODO: Implement actual similarity search
    # 1. Generate embedding for query
    # 2. Compute cosine similarity with all node embeddings
    # 3. Return top-k results above threshold
    #
    # Example:
    # query_embedding = model.encode(query)
    # similarities = []
    # for node_id, node_embedding in node_embeddings.items():
    #     similarity = cosine_similarity(query_embedding, node_embedding)
    #     if similarity > threshold:
    #         similarities.append((node_id, similarity))
    # similarities.sort(key=lambda x: x[1], reverse=True)
    # return similarities[:top_k]
    
    return []


def hybrid_search(
    query: str,
    tfidf_results: List[int],
    embedding_results: List[Tuple[int, float]],
    alpha: float = 0.5
) -> List[int]:
    """
    Combine TF-IDF and embedding results using weighted scoring.
    
    Args:
        query: Original search query
        tfidf_results: Node IDs from TF-IDF search
        embedding_results: (node_id, score) from embedding search
        alpha: Weight for embedding scores (0-1)
        
    Returns:
        Combined ranked list of node IDs
    """
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