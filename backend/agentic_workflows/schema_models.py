"""
Pydantic models for VoiceTree agentic workflow structured output
"""

from typing import List, Optional, Literal
from pydantic import BaseModel, Field


class ChunkModel(BaseModel):
    """Model for segmentation stage output"""
    name: str = Field(description="Concise name for the chunk (1-5 words)")
    text: str = Field(description="The actual text content of the chunk")
    is_complete: bool = Field(description="Whether this chunk represents a complete thought")


class SegmentationResponse(BaseModel):
    """Response model for segmentation stage"""
    chunks: List[ChunkModel] = Field(description="List of segmented chunks")


class RelationshipAnalysis(BaseModel):
    """Model for relationship analysis stage output"""
    name: str = Field(description="Name of the chunk being analyzed")
    text: str = Field(description="Text content of the chunk")
    reasoning: str = Field(description="Step-by-step analysis for the relationship")
    relevant_node_name: str = Field(description="Name of most relevant existing node or 'NO_RELEVANT_NODE'")
    relationship: Optional[str] = Field(description="Brief relationship description or null")


class RelationshipResponse(BaseModel):
    """Response model for relationship analysis stage"""
    analyzed_chunks: List[RelationshipAnalysis] = Field(description="Analysis results for each chunk")


class IntegrationDecision(BaseModel):
    """Model for integration decision stage output"""
    name: str = Field(description="Name of the chunk")
    text: str = Field(description="Text content of the chunk")
    action: Literal["CREATE", "APPEND"] = Field(description="Whether to create new node or append to existing")
    target_node: Optional[str] = Field(description="Target node for the action")
    new_node_name: Optional[str] = Field(description="Name for new node if action is CREATE")
    new_node_summary: Optional[str] = Field(description="Summary for new node if action is CREATE")
    relationship_for_edge: Optional[str] = Field(description="Relationship description for new edges")
    content: str = Field(description="Content to add to the node")


class IntegrationResponse(BaseModel):
    """Response model for integration decision stage"""
    integration_decisions: List[IntegrationDecision] = Field(description="Integration decisions for each chunk")


class NodeExtractionResponse(BaseModel):
    """Response model for node extraction stage"""
    new_nodes: List[str] = Field(description="List of new node names to create") 