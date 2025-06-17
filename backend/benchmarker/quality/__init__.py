"""
VoiceTree Quality Scoring API
Clean interface for workflow quality assessment
"""

from .scorer import WorkflowStageQualityScorer, WorkflowQualityAssessment
from .parser import DebugLogParser

__all__ = [
    'WorkflowStageQualityScorer',
    'WorkflowQualityAssessment', 
    'DebugLogParser',
    'assess_workflow_quality'
]

def assess_workflow_quality(debug_logs_dir: str = "backend/agentic_workflows/debug_logs") -> WorkflowQualityAssessment:
    """
    Single atomic function to assess workflow quality
    
    Args:
        debug_logs_dir: Directory containing debug logs
        
    Returns:
        Complete quality assessment
    """
    # Parse debug logs
    parser = DebugLogParser(debug_logs_dir)
    parsed_data = parser.parse_all_logs()
    
    # Score workflow stages
    scorer = WorkflowStageQualityScorer()
    stage_scores = {}
    
    if "transcript" in parsed_data and "segmentation" in parsed_data:
        stage_scores["segmentation"] = scorer.score_segmentation(
            parsed_data["transcript"]["transcript_text"],
            parsed_data["segmentation"]["chunks"]
        )
    
    if "relationship_analysis" in parsed_data:
        stage_scores["relationship_analysis"] = scorer.score_relationship_analysis(
            parsed_data["relationship_analysis"]["input_chunks"],
            parsed_data["relationship_analysis"]["relationships"],
            parsed_data["relationship_analysis"]["existing_nodes"]
        )
    
    if "integration_decision" in parsed_data and "decisions" in parsed_data["integration_decision"]:
        stage_scores["integration_decision"] = scorer.score_integration_decision(
            parsed_data["relationship_analysis"]["relationships"] if "relationship_analysis" in parsed_data else [],
            parsed_data["integration_decision"]["decisions"]
        )
    
    if "node_extraction" in parsed_data and "new_nodes" in parsed_data["node_extraction"]:
        stage_scores["node_extraction"] = scorer.score_node_extraction(
            parsed_data["integration_decision"]["decisions"] if "integration_decision" in parsed_data and "decisions" in parsed_data["integration_decision"] else [],
            parsed_data["node_extraction"]["new_nodes"]
        )
    
    # Create complete assessment
    return scorer.create_workflow_assessment(stage_scores) 