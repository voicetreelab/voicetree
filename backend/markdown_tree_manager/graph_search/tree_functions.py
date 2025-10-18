"""
API for common functions on top of tree ds

e.g. get summareis
"""
import logging
from collections import defaultdict
from copy import deepcopy
from typing import Any
from typing import Optional

from rank_bm25 import BM25Okapi
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from backend.markdown_tree_manager.markdown_tree_ds import Node

# Simple hardcoded English stopwords list (most common ones)
# This replaces NLTK dependency to reduce executable size
_STOPWORDS = {
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'by', 'for', 'from',
    'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the', 'to',
    'was', 'will', 'with', 'the', 'this', 'but', 'they', 'have', 'had',
    'what', 'when', 'where', 'who', 'which', 'why', 'how', 'all', 'would',
    'there', 'their', 'or', 'if', 'can', 'may', 'could', 'should', 'would',
    'might', 'must', 'shall', 'will', 'do', 'does', 'did', 'done', 'i', 'you',
    'he', 'she', 'we', 'they', 'them', 'him', 'her', 'us', 'our', 'your',
    'my', 'his', 'her', 'its', 'their', 'our', 'mine', 'yours', 'hers', 'ours',
    'theirs', 'me', 'him', 'her', 'us', 'them', 'myself', 'yourself', 'himself',
    'herself', 'itself', 'ourselves', 'yourselves', 'themselves', 'not', 'no',
    'nor', 'so', 'just', 'only', 'very', 'too', 'also', 'now', 'then', 'here',
    'there', 'where', 'when', 'why', 'how', 'both', 'each', 'few', 'more',
    'most', 'other', 'some', 'such', 'am', 'is', 'are', 'was', 'were', 'be',
    'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did',
    'doing', 'a', 'an', 'the', 'and', 'but', 'if', 'or', 'because', 'as',
    'until', 'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against',
    'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under',
    'again', 'further', 'then', 'once'
}


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
    # Sort by string representation to handle mixed int/str node IDs
    result = []
    for node_id in sorted(selected, key=str):
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
        # Get domain-aware stopwords - use local _STOPWORDS constant
        domain_stopwords = set(_STOPWORDS)
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


def search_similar_nodes_bm25(
    decision_tree: Any,
    query: str,
    top_k: int = 10,
    already_selected: Optional[set[Any]] = None
) -> list[tuple[int, float]]:
    """
    Search for similar nodes using BM25 with scores.

    BM25 is the state-of-the-art (2024-2025) replacement for TF-IDF:
    - Term frequency saturation (prevents over-weighting repeated terms)
    - Document length normalization (fair comparison across doc sizes)
    - Better handling of rare terms

    Args:
        decision_tree: DecisionTree instance
        query: Search query string
        top_k: Number of results to return
        already_selected: Set of node IDs to exclude

    Returns:
        List of (node_id, bm25_score) tuples ordered by relevance
    """
    if already_selected is None:
        already_selected = set()

    # Get unselected nodes
    unselected_nodes = [
        (node_id, node) for node_id, node in decision_tree.tree.items()
        if node_id not in already_selected
    ]

    if not unselected_nodes:
        return []

    # Build corpus with weighted text (title 3x, summary 2x, content 1x)
    tokenized_corpus = []
    node_ids = []
    for node_id, node in unselected_nodes:
        content_snippet = node.content[:500] if node.content else ""
        # Weight title 3x, summary 2x
        weighted_text = (
            f"{node.title} {node.title} {node.title} "
            f"{node.summary} {node.summary} "
            f"{content_snippet}"
        )
        # Tokenize for BM25 (lowercase + split)
        tokens = weighted_text.lower().split()
        tokenized_corpus.append(tokens)
        node_ids.append(node_id)

    try:
        # Create BM25 index
        # k1=1.5 (term frequency saturation), b=0.75 (length normalization)
        bm25 = BM25Okapi(tokenized_corpus)

        # Tokenize query
        query_tokens = query.lower().split()

        # Get BM25 scores for all documents
        scores = bm25.get_scores(query_tokens)

        # Create (node_id, score) pairs and sort by score
        scored_results = [
            (node_ids[i], float(scores[i]))
            for i in range(len(scores))
        ]
        scored_results.sort(key=lambda x: x[1], reverse=True)

        # Filter by threshold and return top_k
        threshold = 0.1  # BM25 scores are typically higher than TF-IDF
        filtered_results = [
            (node_id, score)
            for node_id, score in scored_results
            if score > threshold
        ]

        logging.info(f"BM25 search found {len(filtered_results)} nodes above threshold")
        return filtered_results[:top_k]

    except Exception as e:
        logging.error(f"BM25 search failed: {e}")
        return []


def reciprocal_rank_fusion(
    *ranked_lists: list[int],
    k: int = 60
) -> list[int]:
    """
    Combine multiple ranked retrieval results using Reciprocal Rank Fusion (RRF).

    RRF is the state-of-the-art (2024-2025) method for combining heterogeneous
    retrieval results. It's scale-invariant, requires no tuning, and consistently
    outperforms weighted combinations.

    Formula: RRF_score(doc) = Σ 1/(k + rank(doc)) across all rankings

    The constant k=60 is empirically optimal across diverse datasets.

    Args:
        *ranked_lists: Variable number of ranked document ID lists
        k: RRF constant (default 60 from research)

    Returns:
        Combined ranked list of document IDs

    References:
        - "Reciprocal Rank Fusion outperforms Condorcet" (Cormack et al.)
        - Azure AI Search, OpenSearch 2.19+, Elasticsearch all use RRF
    """
    rrf_scores = defaultdict(float)

    # For each retrieval method's results
    for ranked_list in ranked_lists:
        # For each document in this ranking
        for rank, doc_id in enumerate(ranked_list, start=1):
            # Add reciprocal rank score
            rrf_scores[doc_id] += 1.0 / (rank + k)

    # Sort by combined RRF score (descending)
    sorted_docs = sorted(rrf_scores.items(), key=lambda x: x[1], reverse=True)
    return [doc_id for doc_id, score in sorted_docs]


def hybrid_search_for_relevant_nodes(
    decision_tree: Any,
    query: str,
    max_return_nodes: int = 10,
    already_selected: Optional[set[Any]] = None,
    vector_score_threshold: float = 0.5,
    bm25_score_threshold: float = 0.5
) -> list[int]:
    """
    State-of-the-art (2024-2025) hybrid search combining:
    1. Dense vector embeddings (semantic understanding)
    2. BM25 sparse retrieval (keyword matching with better normalization than TF-IDF)
    3. Reciprocal Rank Fusion (scale-invariant combination)

    This implementation follows current best practices:
    - BM25 > TF-IDF (industry standard 2024+)
    - RRF > weighted combination (no tuning needed, more robust)
    - Score thresholding (quality filtering before fusion)

    Args:
        decision_tree: DecisionTree instance with tree and search methods
        query: Search query string
        max_return_nodes: Maximum number of results to return
        already_selected: Set of node IDs to exclude from results
        vector_score_threshold: Minimum vector similarity score (0.0-1.0)
            - 0.5 is reasonable (moderate similarity required)
        bm25_score_threshold: Minimum BM25 relevance score
            - 0.5 is reasonable (basic relevance required)

    Returns:
        List of node IDs ordered by RRF score (most relevant first)

    Example:
        >>> nodes = hybrid_search_for_relevant_nodes(
        ...     tree,
        ...     "machine learning algorithms",
        ...     max_return_nodes=10
        ... )
    """
    if already_selected is None:
        already_selected = set()

    # Retrieve candidates (more than needed for quality filtering)
    retrieval_multiplier = 5
    candidate_count = max_return_nodes * retrieval_multiplier

    # 1. Dense vector search (semantic)
    vector_results_raw = []
    if hasattr(decision_tree, 'search_similar_nodes_vector'):
        try:
            vector_results_raw = decision_tree.search_similar_nodes_vector(
                query,
                top_k=candidate_count
            )
            logging.info(f"Vector search retrieved {len(vector_results_raw)} candidates")
        except Exception as e:
            logging.error(f"Vector search failed: {e}")

    # 2. BM25 sparse search (keyword)
    bm25_results_raw = search_similar_nodes_bm25(
        decision_tree,
        query,
        top_k=candidate_count,
        already_selected=already_selected
    )
    logging.info(f"BM25 search retrieved {len(bm25_results_raw)} candidates")

    # 3. Quality filtering: Only keep results above thresholds
    vector_filtered = [
        node_id for node_id, score in vector_results_raw
        if score >= vector_score_threshold and node_id not in already_selected
    ]

    bm25_filtered = [
        node_id for node_id, score in bm25_results_raw
        if score >= bm25_score_threshold
    ]

    logging.info(
        f"After filtering: {len(vector_filtered)} vector results, "
        f"{len(bm25_filtered)} BM25 results"
    )

    # 4. Reciprocal Rank Fusion: Combine the filtered rankings
    # Limit each method to max_return_nodes to keep fusion balanced
    vector_ranked = vector_filtered[:max_return_nodes]
    bm25_ranked = bm25_filtered[:max_return_nodes]

    if not vector_ranked and not bm25_ranked:
        logging.warning("No results passed quality thresholds")
        return []

    combined = reciprocal_rank_fusion(vector_ranked, bm25_ranked, k=60)

    # 5. Validate results exist in tree
    valid_results = [
        node_id for node_id in combined
        if node_id in decision_tree.tree
    ]

    # Return top N results
    final_results = valid_results[:max_return_nodes]

    logging.info(
        f"Hybrid search (RRF) returned {len(final_results)} nodes for query: '{query[:50]}...'"
    )

    return final_results


def _get_semantically_related_nodes(decision_tree: Any, query: str, remaining_slots_count: int, already_selected: set[Any]) -> list[int]:
    """
    Find semantically related nodes using state-of-the-art hybrid search.

    Uses BM25 + Vector Embeddings + RRF fusion (2024-2025 best practices).

    Args:
        decision_tree: DecisionTree instance
        query: Search query string
        remaining_slots_count: Number of nodes to return
        already_selected: Set of node IDs already selected

    Returns:
        List of node IDs ordered by RRF combined relevance score
    """
    # Use the new state-of-the-art hybrid search
    return hybrid_search_for_relevant_nodes(
        decision_tree=decision_tree,
        query=query,
        max_return_nodes=remaining_slots_count,
        already_selected=already_selected,
        vector_score_threshold=0.5,  # Moderate similarity required
        bm25_score_threshold=0.5     # Basic relevance required
    )


