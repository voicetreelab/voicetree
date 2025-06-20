"""
State schema for VoiceTree LangGraph workflow
"""

from typing import List, Dict, Any, Optional
from typing_extensions import TypedDict


class VoiceTreeState(TypedDict):
    """State that flows through the VoiceTree processing pipeline"""
    
    # Input
    transcript_text: str
    existing_nodes: str  # Summary of existing nodes in the tree
    incomplete_chunk_buffer: Optional[str]  # Buffer for incomplete chunks from previous execution
    
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