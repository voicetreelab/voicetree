"""
Pure Graph Definition for VoiceTree Workflow
This file contains only the workflow structure - no business logic
"""

from typing import Dict, List, Tuple

# Workflow stages definition
WORKFLOW_STAGES = [
    {
        "id": "segmentation",
        "name": "Transcript Segmentation",
        "description": "Break transcript into atomic idea chunks",
        "prompt": "segmentation.txt",
        "input_keys": ["transcript_text"],
        "output_key": "chunks"
    },
    {
        "id": "relationship_analysis", 
        "name": "Relationship Analysis",
        "description": "Analyze relationships between chunks and existing nodes",
        "prompt": "relationship_analysis.txt",
        "input_keys": ["existing_nodes", "chunks"],
        "output_key": "analyzed_chunks"
    },
    {
        "id": "integration_decision",
        "name": "Integration Decision", 
        "description": "Decide whether to APPEND or CREATE for each chunk",
        "prompt": "integration_decision.txt",
        "input_keys": ["analyzed_chunks"],
        "output_key": "integration_decisions"
    },
    {
        "id": "node_extraction",
        "name": "Node Extraction",
        "description": "Extract new nodes to be created",
        "prompt": "node_extraction.txt", 
        "input_keys": ["integration_decisions", "existing_nodes"],
        "output_key": "new_nodes"
    }
]

# Stage transitions (edges in the graph)
STAGE_TRANSITIONS = [
    ("segmentation", "relationship_analysis"),
    ("relationship_analysis", "integration_decision"),
    ("integration_decision", "node_extraction"),
    ("node_extraction", "END")
]

# Error handling transitions
ERROR_TRANSITIONS = {
    # Each stage can transition to END on error
    "segmentation": "END",
    "relationship_analysis": "END", 
    "integration_decision": "END",
    "node_extraction": "END"
}

# Conditional logic for stage transitions
TRANSITION_CONDITIONS = {
    "segmentation": {
        "success": "relationship_analysis",
        "no_chunks": "END",
        "error": "END"
    },
    "relationship_analysis": {
        "success": "integration_decision",
        "error": "END"
    },
    "integration_decision": {
        "success": "node_extraction",
        "no_decisions": "END",
        "error": "END"
    },
    "node_extraction": {
        "complete": "END",
        "error": "END"
    }
}

def get_workflow_definition() -> Dict:
    """
    Get the complete workflow definition as a dictionary
    
    Returns:
        Dictionary containing stages, transitions, and conditions
    """
    return {
        "stages": WORKFLOW_STAGES,
        "transitions": STAGE_TRANSITIONS,
        "error_transitions": ERROR_TRANSITIONS,
        "conditions": TRANSITION_CONDITIONS
    }

def get_stage_by_id(stage_id: str) -> Dict:
    """Get a stage definition by its ID"""
    for stage in WORKFLOW_STAGES:
        if stage["id"] == stage_id:
            return stage
    return None

def get_next_stage(current_stage: str, condition: str = "success") -> str:
    """
    Get the next stage based on current stage and condition
    
    Args:
        current_stage: Current stage ID
        condition: Condition for transition (default: "success")
        
    Returns:
        Next stage ID or "END"
    """
    if current_stage in TRANSITION_CONDITIONS:
        return TRANSITION_CONDITIONS[current_stage].get(condition, "END")
    return "END"

def visualize_workflow() -> str:
    """
    Generate a Mermaid diagram representation of the workflow
    
    Returns:
        Mermaid diagram string
    """
    mermaid = ["graph TD"]
    
    # Add nodes
    for stage in WORKFLOW_STAGES:
        mermaid.append(f'    {stage["id"]}["{stage["name"]}<br/>{stage["description"]}"]')
    
    # Add transitions
    for source, target in STAGE_TRANSITIONS:
        if target == "END":
            mermaid.append(f'    {source} --> END[("End")]')
        else:
            mermaid.append(f'    {source} --> {target}')
    
    # Add error transitions
    for source in ERROR_TRANSITIONS:
        mermaid.append(f'    {source} -.->|error| END[("End")]')
    
    return "\n".join(mermaid) 