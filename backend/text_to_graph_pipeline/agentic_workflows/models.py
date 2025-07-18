"""
Pydantic models for VoiceTree agentic workflow structured output
"""

from typing import List, Optional, Literal, Union
from pydantic import BaseModel, Field


class BaseTreeAction(BaseModel):
    """Base class for all tree actions"""
    action: str = Field(description="Action type")


class ChunkModel(BaseModel):
    """Model for segmentation stage output"""
    reasoning: str = Field(description="Analysis of why this is segmented as a distinct chunk and completeness assessment")
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
    reasoning: str = Field(description="Analysis that led to the integration decision")
    action: Literal["CREATE", "APPEND"] = Field(description="Whether to create new node or append to existing")
    # Legacy name-based fields (deprecated)
    target_node: Optional[str] = Field(default=None, description="Target node name (deprecated, use target_node_id)")
    # New ID-based fields
    target_node_id: Optional[int] = Field(default=None, description="Target node ID for APPEND action")
    parent_node_id: Optional[int] = Field(default=None, description="Parent node ID for CREATE action (-1 for root)")
    new_node_name: Optional[str] = Field(default=None, description="Name for new node if action is CREATE")
    new_node_summary: Optional[str] = Field(default=None, description="Summary for new node if action is CREATE")
    relationship_for_edge: Optional[str] = Field(default=None, description="Relationship description for new edges")
    content: str = Field(description="Content to add to the node")


class IntegrationResponse(BaseModel):
    """Response model for integration decision stage"""
    integration_decisions: List[IntegrationDecision] = Field(description="Integration decisions for each chunk")


class NodeSummary(BaseModel):
    """Summary information about a node for neighbor context"""
    id: int = Field(description="Node ID")
    name: str = Field(description="Node name")
    summary: str = Field(description="Node summary")
    relationship: str = Field(description="Relationship to the target node (parent/sibling/child)")


class UpdateAction(BaseTreeAction):
    """Model for UPDATE tree action"""
    action: Literal["UPDATE"] = Field(description="Action type")
    node_id: int = Field(description="ID of node to update")
    new_content: str = Field(description="New content to replace existing content")
    new_summary: str = Field(description="New summary to replace existing summary")


class CreateAction(BaseTreeAction):
    """Model for CREATE action in optimization context"""
    action: Literal["CREATE"] = Field(description="Action type")
    # Legacy name-based field (deprecated)
    target_node_name: Optional[str] = Field(default=None, description="Name of parent node (deprecated, use parent_node_id)")
    # New ID-based field
    parent_node_id: Optional[int] = Field(default=None, description="ID of parent node (-1 for root)")
    new_node_name: str = Field(description="Name for the new node")
    content: str = Field(description="Content for the new node")
    summary: str = Field(description="Summary for the new node")
    relationship: str = Field(description="Relationship to parent (e.g., 'subtask of')")


class OptimizationDecision(BaseModel):
    """Model for single abstraction optimization output"""
    reasoning: str = Field(description="Analysis that led to the optimization decision")
    actions: List[Union[UpdateAction, CreateAction]] = Field(
        description="List of actions to take (can be empty if no optimization needed)",
        default_factory=list
    )


class OptimizationResponse(BaseModel):
    """Response model for single abstraction optimization stage"""
    optimization_decision: OptimizationDecision = Field(description="The optimization decision")


class TargetNodeIdentification(BaseModel):
    """Model for identifying target node for a segment"""
    text: str = Field(description="Text content of the segment")
    reasoning: str = Field(description="Analysis for choosing the target node")
    target_node_id: int = Field(description="ID of target node (use -1 for new nodes)")
    is_new_node: bool = Field(description="Whether this is a new node to be created")
    new_node_name: Optional[str] = Field(default=None, description="Name for new node (required if is_new_node=True)")
    
    @property
    def target_node_name(self) -> Optional[str]:
        """Backward compatibility property"""
        return self.new_node_name if self.is_new_node else None
    
    def model_post_init(self, __context):
        """Validate that new nodes have names and existing nodes have valid IDs"""
        if self.is_new_node:
            if self.target_node_id != -1:
                raise ValueError("New nodes must have target_node_id=-1")
            if not self.new_node_name:
                raise ValueError("new_node_name is required when is_new_node=True")
        else:
            if self.target_node_id == -1:
                raise ValueError("Existing nodes must have positive target_node_id")


class TargetNodeResponse(BaseModel):
    """Response model for identify target node stage"""
    target_nodes: List[TargetNodeIdentification] = Field(description="Target node for each segment") 