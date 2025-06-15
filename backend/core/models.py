"""
Unified Data Models for VoiceTree
Replaces namedtuples and inconsistent data structures with type-safe Pydantic models
"""

from typing import List, Optional, Dict, Any, Literal
from pydantic import BaseModel, Field
from datetime import datetime


class NodeAction(BaseModel):
    """
    Represents an action to be taken on the tree (replaces namedtuple)
    """
    action: Literal["CREATE", "APPEND"] = Field(description="Action type")
    concept_name: str = Field(description="Name/title of the concept")
    content: str = Field(description="Markdown content to add/append")
    summary: str = Field(description="Summary of the node content")
    
    # Optional fields for CREATE actions
    parent_concept_name: Optional[str] = Field(default=None, description="Parent concept name for CREATE actions")
    relationship: Optional[str] = Field(default=None, description="Relationship to parent")
    
    # Metadata
    labelled_text: str = Field(default="", description="Original text that triggered this action")
    is_complete: bool = Field(default=True, description="Whether the action is complete")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0, description="Confidence score for the action")
    
    @classmethod
    def create_node(
        cls,
        concept_name: str,
        content: str,
        summary: str,
        parent_concept_name: str,
        relationship: str = "child of",
        labelled_text: str = "",
        confidence: float = 1.0
    ) -> "NodeAction":
        """Factory method for CREATE actions"""
        return cls(
            action="CREATE",
            concept_name=concept_name,
            content=content,
            summary=summary,
            parent_concept_name=parent_concept_name,
            relationship=relationship,
            labelled_text=labelled_text,
            confidence=confidence
        )
    
    @classmethod
    def append_to_node(
        cls,
        concept_name: str,
        content: str,
        summary: str,
        labelled_text: str = "",
        confidence: float = 1.0
    ) -> "NodeAction":
        """Factory method for APPEND actions"""
        return cls(
            action="APPEND",
            concept_name=concept_name,
            content=content,
            summary=summary,
            labelled_text=labelled_text,
            confidence=confidence
        )


class WorkflowResult(BaseModel):
    """
    Result from workflow execution (replaces ad-hoc dictionaries)
    """
    success: bool = Field(description="Whether the workflow succeeded")
    node_actions: List[NodeAction] = Field(default_factory=list, description="Actions to apply to the tree")
    new_node_names: List[str] = Field(default_factory=list, description="Names of newly created nodes")
    
    # Error handling
    error_message: Optional[str] = Field(default=None, description="Error message if workflow failed")
    warning_messages: List[str] = Field(default_factory=list, description="Non-fatal warnings")
    
    # Metadata
    execution_time_ms: float = Field(default=0.0, description="Execution time in milliseconds")
    chunks_processed: int = Field(default=0, description="Number of text chunks processed")
    incomplete_remainder: str = Field(default="", description="Text that couldn't be processed completely")
    
    # Statistics
    tokens_used: int = Field(default=0, description="Total tokens used for LLM calls")
    model_calls: int = Field(default=0, description="Number of LLM API calls made")
    
    def add_warning(self, message: str) -> None:
        """Add a warning message"""
        self.warning_messages.append(message)
        
    def mark_failed(self, error: str) -> None:
        """Mark the result as failed with an error"""
        self.success = False
        self.error_message = error


class ProcessResult(BaseModel):
    """
    Result from processing voice input through the tree manager
    """
    processed: bool = Field(description="Whether any processing occurred")
    workflow_result: Optional[WorkflowResult] = Field(default=None, description="Workflow execution result")
    nodes_updated: List[int] = Field(default_factory=list, description="IDs of nodes that were updated")
    
    # Buffer status
    buffer_size: int = Field(default=0, description="Current buffer size after processing")
    buffer_threshold: int = Field(default=500, description="Buffer threshold for processing")
    waiting_for_more_input: bool = Field(default=False, description="Whether we're waiting for more input")
    
    @classmethod
    def buffering(cls, buffer_size: int, threshold: int) -> "ProcessResult":
        """Create a result indicating we're still buffering"""
        return cls(
            processed=False,
            buffer_size=buffer_size,
            buffer_threshold=threshold,
            waiting_for_more_input=True
        )
    
    @classmethod
    def processed_successfully(cls, workflow_result: WorkflowResult, nodes_updated: List[int]) -> "ProcessResult":
        """Create a successful processing result"""
        return cls(
            processed=True,
            workflow_result=workflow_result,
            nodes_updated=nodes_updated,
            waiting_for_more_input=False
        )


class ChunkModel(BaseModel):
    """Model for text segmentation chunks (from agentic workflows)"""
    name: str = Field(description="Concise name for the chunk (1-5 words)")
    text: str = Field(description="The actual text content of the chunk")
    is_complete: bool = Field(description="Whether this chunk represents a complete thought")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0, description="Confidence in the segmentation")


class AnalyzedChunk(BaseModel):
    """Model for chunks with relationship analysis"""
    chunk: ChunkModel = Field(description="The original chunk")
    existing_nodes: List[str] = Field(default_factory=list, description="Related existing nodes")
    relationship_type: str = Field(description="Type of relationship (elaboration, contrast, etc.)")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0, description="Confidence in the analysis")


class IntegrationDecision(BaseModel):
    """Model for integration decisions"""
    action: Literal["CREATE", "APPEND"] = Field(description="Action to take")
    chunk_name: str = Field(description="Name of the chunk being integrated")
    target_node: Optional[str] = Field(default=None, description="Target node for the action")
    new_node_name: Optional[str] = Field(default=None, description="Name for new node (CREATE only)")
    relationship: Optional[str] = Field(default=None, description="Relationship description")
    content: str = Field(description="Content to add")
    summary: str = Field(description="Summary of the content")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0, description="Confidence in the decision")
    
    def to_node_action(self) -> NodeAction:
        """Convert to NodeAction for execution"""
        if self.action == "CREATE":
            return NodeAction.create_node(
                concept_name=self.new_node_name or self.chunk_name,
                content=self.content,
                summary=self.summary,
                parent_concept_name=self.target_node or "Root",
                relationship=self.relationship or "child of",
                confidence=self.confidence
            )
        else:  # APPEND
            return NodeAction.append_to_node(
                concept_name=self.target_node or self.chunk_name,
                content=self.content,
                summary=self.summary,
                confidence=self.confidence
            )


# Response models for structured LLM output (from agentic workflows)
class SegmentationResponse(BaseModel):
    """Response from segmentation stage"""
    chunks: List[ChunkModel] = Field(description="List of segmented chunks")
    incomplete_remainder: str = Field(default="", description="Text that couldn't be segmented")


class RelationshipResponse(BaseModel):
    """Response from relationship analysis stage"""
    analyzed_chunks: List[AnalyzedChunk] = Field(description="Chunks with relationship analysis")


class IntegrationResponse(BaseModel):
    """Response from integration decision stage"""
    integration_decisions: List[IntegrationDecision] = Field(description="Decisions for each chunk")


class NodeExtractionResponse(BaseModel):
    """Response from node extraction stage"""
    new_nodes: List[str] = Field(description="Names of nodes to be created")


# Statistics and monitoring models
class WorkflowStats(BaseModel):
    """Statistics about workflow execution"""
    total_executions: int = Field(default=0, description="Total number of workflow executions")
    successful_executions: int = Field(default=0, description="Number of successful executions") 
    failed_executions: int = Field(default=0, description="Number of failed executions")
    average_execution_time_ms: float = Field(default=0.0, description="Average execution time")
    total_tokens_used: int = Field(default=0, description="Total tokens consumed")
    total_nodes_created: int = Field(default=0, description="Total nodes created")
    
    @property
    def success_rate(self) -> float:
        """Calculate success rate as percentage"""
        if self.total_executions == 0:
            return 0.0
        return (self.successful_executions / self.total_executions) * 100.0 