"""
Test helpers for integration tests
"""

from typing import Any, Dict, List, Optional

from backend.text_to_graph_pipeline.agentic_workflows.agents.tree_action_decider_agent import \
    TreeActionDeciderAgent


class PipelineHelper:
    """Simple test helper for running the voice tree agent"""
    
    def __init__(self, state_file: Optional[str] = None):
        self.agent = TreeActionDeciderAgent()
        # state_file parameter kept for backward compatibility but no longer used
        
    def run(self, transcript: str, existing_nodes: str = "") -> Dict[str, Any]:
        """Run agent - workflow is now stateless"""
        result = self.agent.run(transcript, existing_nodes=existing_nodes)
        return result
    
    def get_statistics(self) -> Dict[str, Any]:
        # Workflow is now stateless, return empty stats
        return {"message": "Workflow is stateless - no statistics to report"}
    
    def clear_state(self) -> None:
        # No state to clear - workflow is now stateless
        pass


def verify_content_coverage(transcript: str, nodes_content: List[str], min_coverage_ratio: float = 0.1) -> tuple[bool, float, str]:
    """
    Verify that the nodes contain a minimum percentage of words from the transcript.
    
    Args:
        transcript: The input transcript text
        nodes_content: List of content strings from all nodes
        min_coverage_ratio: Minimum ratio of transcript words that should appear in nodes (default 0.1 = 10%)
        
    Returns:
        Tuple of (is_valid, coverage_ratio, message)
    """
    # Normalize and tokenize transcript
    transcript_words = set(word.lower().strip(".,!?;:\"'") 
                          for word in transcript.split() 
                          if len(word) > 2)  # Skip very short words
    
    # Skip common stop words
    stop_words = {'the', 'and', 'for', 'are', 'was', 'were', 'been', 'have', 'has', 'had', 
                  'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that',
                  'these', 'those', 'with', 'from', 'into', 'through', 'during', 'before',
                  'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then',
                  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'both',
                  'each', 'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own',
                  'same', 'than', 'too', 'very', 'just', 'but', 'not'}
    
    meaningful_words = transcript_words - stop_words
    
    if not meaningful_words:
        return True, 1.0, "No meaningful words in transcript to verify"
    
    # Combine all node content
    all_content = " ".join(nodes_content).lower()
    
    # Count how many transcript words appear in the nodes
    found_words = set()
    for word in meaningful_words:
        if word in all_content:
            found_words.add(word)
    
    coverage_ratio = len(found_words) / len(meaningful_words)
    
    if coverage_ratio >= min_coverage_ratio:
        return True, coverage_ratio, f"Good coverage: {coverage_ratio:.1%} of meaningful words found in nodes"
    else:
        missing_words = meaningful_words - found_words
        sample_missing = list(missing_words)[:5]  # Show first 5 missing words
        return False, coverage_ratio, f"Low coverage: only {coverage_ratio:.1%} of meaningful words found. Missing words include: {sample_missing}"