"""
State schema for VoiceTree LangGraph workflow with validation
"""

from typing import List, Dict, Any, Optional
from typing_extensions import TypedDict


class VoiceTreeState(TypedDict):
    """State that flows through the VoiceTree processing pipeline"""
    
    # Input
    transcript_text: str
    transcript_history: str  # Historical context from previous transcripts
    existing_nodes: str  # Summary of existing nodes in the tree
    
    # Stage 1: Segmentation output
    chunks: Optional[List[Dict[str, Any]]]
    
    # Stage 2: Relationship analysis output  
    analyzed_chunks: Optional[List[Dict[str, Any]]]
    
    # Stage 3: Integration decision output
    integration_decisions: Optional[List[Dict[str, Any]]]
    
    # Stage 4: Node extraction output (final)
    new_nodes: Optional[List[str]]
    
    # Processing metadata
    incomplete_chunk_remainder: Optional[str]  # Incomplete chunk to carry forward to next execution
    
    # Metadata
    current_stage: str
    error_message: Optional[str]


def validate_state(state: dict) -> None:
    """
    Validate that all required VoiceTreeState fields are present.
    Automatically checks based on TypedDict annotations.
    """
    # Get all annotations from VoiceTreeState
    annotations = VoiceTreeState.__annotations__
    
    # Fields that are Optional[T] are not required
    required_fields = set()
    for field, field_type in annotations.items():
        # Check if it's Optional by looking at the type
        type_str = str(field_type)
        if not ('Optional[' in type_str or 'None' in type_str):
            required_fields.add(field)
    
    # Check for missing required fields
    missing_fields = required_fields - set(state.keys())
    if missing_fields:
        raise KeyError(
            f"Missing required state fields: {', '.join(sorted(missing_fields))}. "
            f"State has keys: {', '.join(sorted(state.keys()))}. "
            f"This often happens when a new field is added to VoiceTreeState but not initialized in the pipeline. "
            f"Check that all fields in VoiceTreeState are properly initialized in pipeline.py"
        )