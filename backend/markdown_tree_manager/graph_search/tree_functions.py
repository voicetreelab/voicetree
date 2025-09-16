"""
API for common functions on top of tree ds

e.g. get summareis
"""
import logging
from typing import List
from copy import deepcopy
import nltk
from nltk.corpus import stopwords
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from backend.markdown_tree_manager.markdown_tree_ds import Node

# Download stopwords if not already present
try:
    _STOPWORDS = set(stopwords.words('english'))
except LookupError:
    nltk.download('stopwords', quiet=True)
    _STOPWORDS = set(stopwords.words('english'))


def _tokenize_query(query: str) -> set:
    """
    Simple keyword extraction from query using NLTK stopwords
    
    Args:
        query: Search query string
        
    Returns:
        Set of lowercase keywords
    """
    if not query:
        return set()
    
    # Simple tokenization: lowercase and split on whitespace
    words = query.lower().split()
    
    # Clean and filter tokens using NLTK stopwords
    tokens = set()
    for word in words:
        # Remove punctuation from edges
        cleaned = word.strip('.,!?;:"\'-()[]{}')
        if cleaned and cleaned not in _STOPWORDS and len(cleaned) > 1:
            tokens.add(cleaned)
    
    return tokens


def _calculate_keyword_relevance(node: Node, query_tokens: set) -> float:
    """
    Calculate relevance score between node and query tokens
    
    Args:
        node: Node to score
        query_tokens: Set of query keywords
        
    Returns:
        Relevance score (higher is more relevant)
    """
    if not query_tokens:
        return 0.0
    
    score = 0.0
    
    # Tokenize node title and summary
    title_tokens = _tokenize_query(node.title)
    summary_tokens = _tokenize_query(node.summary)
    
    # Score matches
    for token in query_tokens:
        if token in title_tokens:
            score += 3.0  # Title matches are most important
        if token in summary_tokens:
            score += 1.0  # Summary matches are secondary
    
    # Normalize by query length to prevent bias
    return score / len(query_tokens) if query_tokens else 0.0


def get_most_relevant_nodes(decision_tree, limit: int, query: str = None) -> List:
    """
    Select most relevant nodes when tree exceeds limit
    
    Strategy:
    1. Include root nodes (up to 25% of limit)
    2. Include recently modified nodes (up to 50% of limit)  
    3. Fill remaining slots with:
       - If query provided: nodes matching query keywords
       - Otherwise: nodes sorted by branching factor
    
    Args:
        decision_tree: DecisionTree instance
        limit: Maximum number of nodes to return
        query: Optional search query for keyword-based relevance
        
    Returns:
        List of Node objects (copies to ensure read-only)
    """
    if not decision_tree.tree:
        return []

    # If tree has fewer nodes than limit, return all
    if len(decision_tree.tree) <= limit:
        return [deepcopy(node) for node in decision_tree.tree.values()]
    
    # # Collect root nodes
    # root_nodes = []
    # for node_id, node in decision_tree.tree.items():
    #     if node.parent_id is None:
    #         root_nodes.append(node_id)
    #
    # Get recent nodes sorted by modification time
    all_nodes_by_recency = sorted(
        decision_tree.tree.items(),
        key=lambda x: x[1].modified_at,
        reverse=True
    )
    #
    # Build selected set
    selected = set()
    
    # # Include root nodes (up to 12.5% of limit)
    # root_limit = min(len(root_nodes), limit // 8)
    # for i in range(root_limit):
    #     selected.add(root_nodes[i])
    
    # Fill up to 3/8 slots with recent nodes
    for node_id, node in all_nodes_by_recency:
        if len(selected) >= (3*limit) // 8:
            break
        selected.add(node_id)
    
    # Fill remaining slots based on query
    remaining_slots = limit - len(selected)
    if remaining_slots > 0:
            nodes_related_to_query = _get_semantically_related_nodes(decision_tree, query, remaining_slots, selected)
            
            # Add the semantically related nodes to selected set
            for node_id in nodes_related_to_query:
                selected.add(node_id)
                if len(selected) >= limit:
                    break
            
            # Get node names for logging
            if nodes_related_to_query:
                node_names = [decision_tree.tree[node_id].title for node_id in nodes_related_to_query if node_id in decision_tree.tree]
                logging.info(f"Semantically related nodes are: {node_names}")

    # Return Node objects (copies) in consistent order
    result = []
    for node_id in sorted(selected):
        result.append(deepcopy(decision_tree.tree[node_id]))

    print(f"[DEBUG] Returning {len(result)} nodes from selection logic")
    return result


def _get_semantically_related_nodes(decision_tree, query: str, remaining_slots_count: int, already_selected: set) -> List[int]:
    """
    Find semantically related nodes using TF-IDF scoring

    Args:
        decision_tree: DecisionTree instance
        query: Search query string
        remaining_slots_count: Number of nodes to return
        already_selected: Set of node IDs already selected

    Returns:
        List of node IDs ordered by relevance
    """
    # TODO: Future optimization - use vector embeddings for semantic search
    # This would involve:
    # 1. Pre-computing embeddings for all node titles/summaries
    # 2. Computing embedding for query at runtime (~300ms)
    # 3. Finding nodes with highest cosine similarity
    # See Google Gemini embedding API: gemini-embedding-001
    #
    # TF-IDF Limitations (why we need embeddings):
    # 1. Natural language with common words in titles:
    #    Query: "Our team needs better planning" -> picks "Team Building" over "Project Planning"
    #    because "team" in title overwhelms semantic meaning
    # 2. Synonyms and related concepts:
    #    Query: "AI and deep neural networks" -> misses "Machine Learning Basics"
    #    because TF-IDF doesn't know AI = Machine Learning
    # 3. Context-dependent ambiguous terms:
    #    Query: "make application run faster" -> weak matches
    #    because can't understand "faster" + "performance" = optimization

    selected_nodes = []

    # Use TF-IDF for better relevance scoring
    unselected_nodes = [(node_id, node) for node_id, node in decision_tree.tree.items()
                        if node_id not in already_selected]

    if not unselected_nodes:
        return selected_nodes
    
    # Build corpus with weighted text (title 3x, summary 2x, content 1x)
    corpus = []
    node_ids = []
    for node_id, node in unselected_nodes:
        # Weight title 3x, summary 2x, first 500 chars of content 1x
        content_snippet = node.content[:500] if node.content else ""
        weighted_text = f"{node.title} {node.title} {node.title} {node.summary} {node.summary} {content_snippet}"
        corpus.append(weighted_text)
        node_ids.append(node_id)

    # Create TF-IDF matrix
    try:
        # Get domain-aware stopwords (NLTK + domain-specific)
        domain_stopwords = stopwords.words('english')


        vectorizer = TfidfVectorizer(
            stop_words=domain_stopwords,  # Use domain-aware stopwords
            min_df=1,
            ngram_range=(1, 2)  # Include bigrams for better phrase matching
        )
        tfidf_matrix = vectorizer.fit_transform(corpus)

        # Transform query and compute similarities
        query_vector = vectorizer.transform([query])
        similarities = cosine_similarity(query_vector, tfidf_matrix).flatten()

        # Get nodes with similarity > threshold
        threshold = 0.01  # Increased from 0.01 to reduce false positives
        ranked_indices = np.argsort(similarities)[::-1]

        for idx in ranked_indices:
            if similarities[idx] > threshold:
                selected_nodes.append(node_ids[idx])
                if len(selected_nodes) >= remaining_slots_count:
                    break
            else:
                # Since indices are sorted by similarity, we can break early
                break

    except Exception as e:
        # Fallback to keyword search if TF-IDF fails
        print(f"[WARNING] TF-IDF failed, falling back to keyword search: {e}")
        query_tokens = _tokenize_query(query)

        # Score all unselected nodes
        node_scores = []
        for node_id, node in unselected_nodes:
            score = _calculate_keyword_relevance(node, query_tokens)
            if score > 0:  # Only include nodes with some relevance
                node_scores.append((node_id, score))

        # Sort by relevance and add top matches
        node_scores.sort(key=lambda x: x[1], reverse=True)
        for node_id, score in node_scores[:remaining_slots_count]:
            selected_nodes.append(node_id)
    
    return selected_nodes


