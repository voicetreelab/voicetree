"""
API for common functions on top of tree ds

e.g. get summareis
"""
import logging
from copy import deepcopy
from typing import Any
from typing import Optional

import nltk
from nltk.corpus import stopwords
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from backend.markdown_tree_manager.markdown_tree_ds import Node

# Download stopwords if not already present
try:
    _STOPWORDS = set(stopwords.words('english'))
except LookupError:
    nltk.download('stopwords', quiet=True)
    _STOPWORDS = set(stopwords.words('english'))


def _tokenize_query(query: str) -> set[str]:
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


def _calculate_keyword_relevance(node: Node, query_tokens: set[str]) -> float:
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


def get_most_relevant_nodes(decision_tree: Any, limit: int, query: Optional[str] = None) -> list[Node]:
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
    selected: set[Any] = set()

    # # Include root nodes (up to 12.5% of limit)
    # root_limit = min(len(root_nodes), limit // 8)
    # for i in range(root_limit):
    #     selected.add(root_nodes[i])

    # Fill up to 3/8 slots with recent nodes
    for node_id, _node in all_nodes_by_recency:
        if len(selected) >= (3*limit) // 8:
            break
        selected.add(node_id)

    # Fill remaining slots based on query
    remaining_slots = limit - len(selected)
    if remaining_slots > 0:
            if query:
                nodes_related_to_query = _get_semantically_related_nodes(decision_tree, query, remaining_slots, selected)
            else:
                nodes_related_to_query = []

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
        # Only add nodes that actually exist in the tree
        if node_id in decision_tree.tree:
            result.append(deepcopy(decision_tree.tree[node_id]))
        else:
            logging.warning(f"Node ID {node_id} not found in decision tree, skipping")

    print(f"[DEBUG] Returning {len(result)} nodes from selection logic")
    return result


def search_similar_nodes_tfidf(decision_tree: Any, query: str, top_k: int = 10, already_selected: Optional[set[Any]] = None) -> list[tuple[int, float]]:
    """
    Search for similar nodes using TF-IDF with scores.

    Args:
        decision_tree: DecisionTree instance
        query: Search query string
        top_k: Number of results to return
        already_selected: Set of node IDs to exclude

    Returns:
        List of (node_id, tfidf_score) tuples ordered by relevance
    """
    if already_selected is None:
        already_selected = set()

    # Get unselected nodes
    unselected_nodes = [(node_id, node) for node_id, node in decision_tree.tree.items()
                        if node_id not in already_selected]

    if not unselected_nodes:
        return []

    # Build corpus with weighted text (title 3x, summary 2x, content 1x)
    corpus = []
    node_ids = []
    for node_id, node in unselected_nodes:
        content_snippet = node.content[:500] if node.content else ""
        weighted_text = f"{node.title} {node.title} {node.title} {node.summary} {node.summary} {content_snippet}"
        corpus.append(weighted_text)
        node_ids.append(node_id)

    try:
        # Get domain-aware stopwords
        domain_stopwords = set(stopwords.words('english'))
        mathematical_stopwords = {
            'average', 'number', 'adult', 'children', 'newborn', 'per', 'total',
            'equals', 'sum', 'calculation', 'count', 'population', 'quantity'
        }
        domain_stopwords.update(mathematical_stopwords)

        vectorizer = TfidfVectorizer(
            stop_words=list(domain_stopwords),
            min_df=1,
            ngram_range=(1, 2)
        )
        tfidf_matrix = vectorizer.fit_transform(corpus)
        query_vector = vectorizer.transform([query])
        similarities = cosine_similarity(query_vector, tfidf_matrix).flatten()

        # Create (node_id, score) pairs and sort by score
        scored_results = [(node_ids[i], float(similarities[i])) for i in range(len(similarities))]
        scored_results.sort(key=lambda x: x[1], reverse=True)

        # Filter by threshold and return top_k
        threshold = 0.01
        filtered_results = [(node_id, score) for node_id, score in scored_results if score > threshold]
        return filtered_results[:top_k]

    except Exception as e:
        logging.error(f"TF-IDF search failed: {e}")
        return []


def _get_semantically_related_nodes(decision_tree: Any, query: str, remaining_slots_count: int, already_selected: set[Any]) -> list[int]:
    """
    Find semantically related nodes using combined TF-IDF and vector search

    Args:
        decision_tree: DecisionTree instance
        query: Search query string
        remaining_slots_count: Number of nodes to return
        already_selected: Set of node IDs already selected

    Returns:
        List of node IDs ordered by combined relevance score
    """
    combined_scores = {}

    # Get vector search results with scores
    vector_results = []
    if hasattr(decision_tree, 'search_similar_nodes_vector'):
        try:
            vector_results = decision_tree.search_similar_nodes_vector(query, top_k=remaining_slots_count * 2)
            logging.info(f"Vector search found {len(vector_results)} candidates")
        except Exception as e:
            logging.error(f"VECTOR SEARCH FAILURE: {e}")

    # Get TF-IDF results with scores
    tfidf_results = search_similar_nodes_tfidf(decision_tree, query, top_k=remaining_slots_count * 2, already_selected=already_selected)
    logging.info(f"TF-IDF search found {len(tfidf_results)} candidates")

    # Combine scores with simple weighting
    VECTOR_WEIGHT = 0.7
    TFIDF_WEIGHT = 0.3

    # Add vector scores
    for node_id, score in vector_results:
        if node_id not in already_selected:
            combined_scores[node_id] = VECTOR_WEIGHT * score

    # Add TF-IDF scores
    for node_id, score in tfidf_results:
        if node_id not in already_selected:
            if node_id in combined_scores:
                combined_scores[node_id] += TFIDF_WEIGHT * score
            else:
                combined_scores[node_id] = TFIDF_WEIGHT * score

    # Sort by combined score and return top results
    sorted_results = sorted(combined_scores.items(), key=lambda x: x[1], reverse=True)

    # Filter to only include node IDs that exist in the tree
    result_node_ids = []
    for node_id, _score in sorted_results:
        if node_id in decision_tree.tree:
            result_node_ids.append(node_id)
            if len(result_node_ids) >= remaining_slots_count:
                break
        else:
            logging.warning(f"Node ID {node_id} from search results not found in tree, skipping")

    if result_node_ids:
        logging.info(f"Hybrid search returned {len(result_node_ids)} nodes (vector_weight={VECTOR_WEIGHT}, tfidf_weight={TFIDF_WEIGHT})")

    return result_node_ids


