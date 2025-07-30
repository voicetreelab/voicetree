"""
API for common functions on top of tree ds

e.g. get summareis
"""
import json
import logging
from typing import Dict, Any, List, Set
from copy import deepcopy
import nltk
from nltk.corpus import stopwords
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
import re

from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import Node
from backend.text_to_graph_pipeline.tree_manager.domain_stopwords import get_domain_aware_stopwords

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


def _extract_parameters(text: str) -> List[str]:
    """
    Extract mathematical parameters from text.
    Parameters are patterns like:
    - "average number of newborn children per adult [animal] in [location]"
    - "number of adult [animal] in [location]"
    - "total number of adult animals in [location]"
    
    Returns normalized parameter strings for matching.
    """
    parameters = []
    text_lower = text.lower()
    
    # Pattern 1: "average number of newborn children per adult X in Y"
    pattern1 = r"average number of newborn children per adult (\w+(?:\s+\w+)*) in (\w+(?:\s+\w+)*)"
    matches1 = re.findall(pattern1, text_lower)
    for animal, location in matches1:
        param = f"avg_newborn_{animal.replace(' ', '_')}_{location.replace(' ', '_')}"
        parameters.append(param)
    
    # Pattern 2: "number of adult X in Y"
    pattern2 = r"number of adult (\w+(?:\s+\w+)*) in (\w+(?:\s+\w+)*)"
    matches2 = re.findall(pattern2, text_lower)
    for animal, location in matches2:
        param = f"adult_{animal.replace(' ', '_')}_{location.replace(' ', '_')}"
        parameters.append(param)
    
    # Pattern 3: "total number of adult animals in X"
    pattern3 = r"total number of adult animals in (\w+(?:\s+\w+)*)"
    matches3 = re.findall(pattern3, text_lower)
    for location in matches3:
        param = f"total_adults_{location.replace(' ', '_')}"
        parameters.append(param)
    
    return parameters


def _extract_defined_parameter(node_text: str) -> str:
    """
    Extract what parameter a node defines (left side of equals).
    Returns the normalized parameter name or empty string.
    """
    if "equals" not in node_text.lower():
        return ""
    
    # Get the part before "equals"
    defining_part = node_text.lower().split("equals")[0].strip()
    
    # Extract the parameter being defined
    params = _extract_parameters(defining_part)
    return params[0] if params else ""


def _extract_defined_parameters_from_metadata(node_content: str) -> List[str]:
    """
    Extract parameters defined by a node from its _Defines:_ metadata section.
    
    Args:
        node_content: The full content of the node
        
    Returns:
        List of parameters this node defines, or empty list if no metadata
    """
    if not node_content or "_Defines:" not in node_content:
        return []
    
    defines = []
    lines = node_content.split('\n')
    in_defines_section = False
    
    for line in lines:
        line = line.strip()
        
        # Start of Defines section
        if line == "_Defines:":
            in_defines_section = True
            continue
            
        # End of Defines section (next metadata section or links)
        if in_defines_section and (line.startswith("_") or line == "_Links:"):
            break
            
        # Extract defined items
        if in_defines_section and line.startswith("- "):
            param = line[2:].strip()
            if param:
                defines.append(param)
    
    return defines


def _extract_needed_parameters_from_metadata(node_content: str) -> List[str]:
    """
    Extract parameters needed by a node from its _Still_Requires:_ metadata section.
    
    Args:
        node_content: The full content of the node
        
    Returns:
        List of parameters this node still requires, or empty list if no metadata
    """
    if not node_content or "_Still_Requires:" not in node_content:
        return []
    
    requires = []
    lines = node_content.split('\n')
    in_requires_section = False
    
    for line in lines:
        line = line.strip()
        
        # Start of Still_Requires section
        if line == "_Still_Requires:":
            in_requires_section = True
            continue
            
        # End of Still_Requires section (next metadata section or links)
        if in_requires_section and (line.startswith("_") or line == "_Links:"):
            break
            
        # Extract required items
        if in_requires_section and line.startswith("- "):
            param = line[2:].strip()
            if param:
                requires.append(param)
    
    return requires


def _extract_needed_parameters(query: str) -> List[str]:
    """
    Extract what parameters are needed from a query (right side of equals).
    Returns list of normalized parameter names.
    """
    if "equals" not in query.lower():
        # If no equals, extract all parameters mentioned
        return _extract_parameters(query)
    
    # Get the part after "equals" 
    expression_part = query.lower().split("equals", 1)[1].strip()
    
    # Extract all parameters from the expression
    return _extract_parameters(expression_part)


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


def get_node_summaries(decision_tree, max_nodes) -> str:
    """
    Get node summaries from decision tree
    
    Args:
        decision_tree: Decision tree object with tree attribute containing nodes
        max_nodes: Maximum number of recent nodes to include
        
    Returns:
        String with node summaries
    """
    node_summaries = []
    node_ids = decision_tree.get_recent_nodes(max_nodes)
    for node_id in node_ids:
        node = decision_tree.tree[node_id]
        if hasattr(node, 'title') and hasattr(node, 'summary'): # todo, title or name?
            node_summaries.append(f"{node.title}: {node.summary}")
    
    return "\n".join(node_summaries) if node_summaries else "No existing nodes yet"


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
    # if not decision_tree.tree:
    #     return []
    #
    # # If tree has fewer nodes than limit, return all
    # if len(decision_tree.tree) <= limit:
    #     return [deepcopy(node) for node in decision_tree.tree.values()]
    #
    # # Collect root nodes
    # root_nodes = []
    # for node_id, node in decision_tree.tree.items():
    #     if node.parent_id is None:
    #         root_nodes.append(node_id)
    #
    # # Get recent nodes sorted by modification time
    # all_nodes_by_recency = sorted(
    #     decision_tree.tree.items(),
    #     key=lambda x: x[1].modified_at,
    #     reverse=True
    # )
    #
    # # Build selected set
    # selected = set()
    #
    # # Include root nodes (up to 12.5% of limit)
    # root_limit = min(len(root_nodes), limit // 8)
    # for i in range(root_limit):
    #     selected.add(root_nodes[i])
    #
    # # Fill up to 50% more slots with recent nodes
    # for node_id, node in all_nodes_by_recency:
    #     if len(selected) >= (5*limit) // 8:
    #         break
    #     selected.add(node_id)
    
    # Fill remaining slots based on query or branching factor
    selected = set()
    remaining_slots = limit
    if remaining_slots > 0:
        if query:
            nodes_related_to_query = get_semantically_related_nodes(decision_tree, query, remaining_slots, selected)
            
            # Add the semantically related nodes to selected set
            for node_id in nodes_related_to_query:
                selected.add(node_id)
                if len(selected) >= limit:
                    break
            
            # Get node names for logging
            if nodes_related_to_query:
                node_names = [decision_tree.tree[node_id].title for node_id in nodes_related_to_query if node_id in decision_tree.tree]
                logging.info(f"Semantically related nodes are: {node_names}")
        else:
            # No query provided, use original branching factor approach
            nodes_by_branching = decision_tree.get_nodes_by_branching_factor(remaining_slots)
            for node_id in nodes_by_branching:
                if node_id not in selected:
                    selected.add(node_id)
                    if len(selected) >= limit:
                        break

    # Return Node objects (copies) in consistent order
    result = []
    for node_id in sorted(selected):
        result.append(deepcopy(decision_tree.tree[node_id]))

    print(f"[DEBUG] Returning {len(result)} nodes from selection logic")
    return result


def get_semantically_related_nodes(decision_tree, query: str, remaining_slots_count: int, already_selected: set) -> List[int]:
    """
    Find semantically related nodes using dependency-aware search with TF-IDF fallback

    Args:
        decision_tree: DecisionTree instance
        query: Search query string
        remaining_slots_count: Number of nodes to return
        already_selected: Set of node IDs already selected

    Returns:
        List of node IDs ordered by relevance
    """
    selected_nodes = []
    original_limit = remaining_slots_count
    
    # Get unselected nodes
    unselected_nodes = [(node_id, node) for node_id, node in decision_tree.tree.items()
                        if node_id not in already_selected]

    if not unselected_nodes:
        return selected_nodes
    
    # STEP 1: Dependency-aware search for equation queries
    if "equals" in query.lower():
        # Extract needed parameters from query
        needed_params = _extract_needed_parameters(query)
        
        if needed_params:
            logging.info(f"Dependency-aware search: Looking for nodes that define {needed_params}")
            
            # Find nodes that define the needed parameters
            dependency_matches = []
            for node_id, node in unselected_nodes:
                # First try to extract from metadata if content is available
                defined_params = []
                if hasattr(node, 'content') and node.content:
                    # Try metadata extraction first
                    defined_params = _extract_defined_parameters_from_metadata(node.content)
                    
                    # If no metadata, fall back to equation parsing
                    if not defined_params:
                        defined_param = _extract_defined_parameter(node.content)
                        if defined_param:
                            defined_params = [defined_param]
                else:
                    # No content, try title+summary
                    node_text = f"{node.title} {node.summary}"
                    defined_param = _extract_defined_parameter(node_text)
                    if defined_param:
                        defined_params = [defined_param]
                
                # Check if any defined parameters match what we need
                for defined_param in defined_params:
                    if defined_param in needed_params:
                        dependency_matches.append(node_id)
                        logging.info(f"Node {node_id} defines needed parameter: {defined_param}")
                        break  # Only add node once
            
            # Add dependency matches first (these are highest priority)
            for node_id in dependency_matches:
                selected_nodes.append(node_id)
                if len(selected_nodes) >= remaining_slots_count:
                    return selected_nodes
            
            # Update remaining slots
            remaining_slots_count -= len(dependency_matches)
            
            # Remove already selected nodes from unselected list
            unselected_nodes = [(nid, n) for nid, n in unselected_nodes if nid not in dependency_matches]
    
    # Deduplicate query to avoid term frequency bias
    # Convert to lowercase and split, then use set to remove duplicates, then rejoin
    query_words = query.lower().split()
    deduplicated_query = ' '.join(dict.fromkeys(query_words))  # dict.fromkeys preserves order
    
    # STEP 2: TF-IDF search for remaining slots
    if remaining_slots_count > 0 and unselected_nodes:
        # Build corpus with weighted text (title 3x more important than summary)
        corpus = []
        node_ids = []
        for node_id, node in unselected_nodes:
            # Weight title 3x more than summary
            weighted_text = f"{node.title} {node.title} {node.title} {node.summary}"
            corpus.append(weighted_text)
            node_ids.append(node_id)

        # Create TF-IDF matrix
        try:
            # Get domain-aware stopwords (NLTK + domain-specific)
            domain_stopwords = list(get_domain_aware_stopwords(include_nltk=True))
            
            # Create custom vectorizer with increased n-gram weight
            from sklearn.feature_extraction.text import TfidfVectorizer as SklearnTfidfVectorizer
            
            # First, get unigram and bigram/trigram vectors separately
            unigram_vectorizer = SklearnTfidfVectorizer(
                stop_words=domain_stopwords,
                min_df=1,
                ngram_range=(1, 1)
            )
            
            ngram_vectorizer = SklearnTfidfVectorizer(
                stop_words=domain_stopwords,
                min_df=1,
                ngram_range=(2, 3)  # Bigrams and trigrams
            )
            
            # Fit and transform separately
            unigram_matrix = unigram_vectorizer.fit_transform(corpus)
            ngram_matrix = ngram_vectorizer.fit_transform(corpus)
            
            # Transform deduplicated query
            unigram_query = unigram_vectorizer.transform([deduplicated_query])
            ngram_query = ngram_vectorizer.transform([deduplicated_query])
            
            # Compute similarities with different weights
            unigram_similarities = cosine_similarity(unigram_query, unigram_matrix).flatten()
            ngram_similarities = cosine_similarity(ngram_query, ngram_matrix).flatten()
            
            # Combine similarities: boost n-gram matches
            similarities = unigram_similarities + (2.0 * ngram_similarities)  # 2x weight for phrases

            # Get nodes with similarity > threshold
            threshold = 0.01
            ranked_indices = np.argsort(similarities)[::-1]

            for idx in ranked_indices:
                if similarities[idx] > threshold:
                    selected_nodes.append(node_ids[idx])
                    if len(selected_nodes) >= original_limit:
                        break
                else:
                    # Since indices are sorted by similarity, we can break early
                    break

        except Exception as e:
            # Fallback to keyword search if TF-IDF fails
            print(f"[WARNING] TF-IDF failed, falling back to keyword search: {e}")
            query_tokens = _tokenize_query(deduplicated_query)  # Use deduplicated query

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


def _format_nodes_for_prompt(nodes: List[Node], tree: Dict[int, Node] = None) -> str:
    """Format nodes for LLM prompt in a consistent, readable format"""
    if not nodes:
        return "No nodes available"
    
    formatted_nodes = []
    formatted_nodes.append("===== Available Nodes =====")
    
    for node in nodes:
        node_entry = []
        node_entry.append(f"Node ID: {node.id}")
        node_entry.append(f"Title: {node.title}")
        node_entry.append(f"Summary: {node.summary}")
        
        if node.parent_id:
            node_entry.append(f"Relationship: {node.relationships[node.parent_id]} ('{tree[node.parent_id].title})'")

        formatted_nodes.append("\n".join(node_entry))
        formatted_nodes.append("-" * 40)
    
    formatted_nodes.append("==========================")
    
    return "\n".join(formatted_nodes)