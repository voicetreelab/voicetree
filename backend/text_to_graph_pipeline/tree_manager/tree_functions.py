"""
API for common functions on top of tree ds

e.g. get summareis
"""
import json
from typing import Dict, Any, List, Set
from copy import deepcopy
import nltk
from nltk.corpus import stopwords

from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import Node

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
    if not decision_tree.tree:
        return []

    # If tree has fewer nodes than limit, return all
    if len(decision_tree.tree) <= limit:
        return [deepcopy(node) for node in decision_tree.tree.values()]
    
    # Collect root nodes
    root_nodes = []
    for node_id, node in decision_tree.tree.items():
        if node.parent_id is None:
            root_nodes.append(node_id)
    
    # Get recent nodes sorted by modification time
    all_nodes_by_recency = sorted(
        decision_tree.tree.items(),
        key=lambda x: x[1].modified_at,
        reverse=True
    )
    
    # Build selected set
    selected = set()
    
    # Include root nodes (up to 12.5% of limit)
    root_limit = min(len(root_nodes), limit // 8)
    for i in range(root_limit):
        selected.add(root_nodes[i])
    
    # Fill up to 50% more slots with recent nodes
    for node_id, node in all_nodes_by_recency:
        if len(selected) >= (5*limit) // 8:
            break
        selected.add(node_id)
    
    # Fill remaining slots based on query or branching factor
    remaining_slots = limit - len(selected)
    if remaining_slots > 0:
        if query:
            # TODO: Future optimization - use vector embeddings for semantic search
            # This would involve:
            # 1. Pre-computing embeddings for all node titles/summaries
            # 2. Computing embedding for query at runtime (~300ms)
            # 3. Finding nodes with highest cosine similarity
            # See Google Gemini embedding API: gemini-embedding-001
            
            # For now, use keyword-based search
            query_tokens = _tokenize_query(query)
            
            # Score all unselected nodes
            node_scores = []
            for node_id, node in decision_tree.tree.items():
                if node_id not in selected:
                    score = _calculate_keyword_relevance(node, query_tokens)
                    if score > 0:  # Only include nodes with some relevance
                        node_scores.append((node_id, score))
            
            # Sort by relevance and add top matches
            node_scores.sort(key=lambda x: x[1], reverse=True)
            for node_id, score in node_scores[:remaining_slots]:
                selected.add(node_id)
                if len(selected) >= limit:
                    break
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