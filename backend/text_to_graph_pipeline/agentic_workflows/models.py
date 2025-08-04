"""
Pydantic models for VoiceTree agentic workflow structured output
"""

from typing import List, Literal, Optional, Union

from pydantic import BaseModel, Field


class BaseTreeAction(BaseModel):
    """Base class for all tree actions"""
    action: str = Field(description="Action type")


class SegmentModel(BaseModel):
    """Model for segmentation stage output"""
    reasoning: str = Field(description="Analysis of why this is segmented as a distinct segment and meaingfullness assessment")
    edited_text: str = Field(description="Edited segment content")
    raw_text: str = Field(description="The section from original transcript that the editted_text segment is based off of")
    is_routable: bool = Field(description="Whether this segment is actually meaningful within the speaker's context")


class SegmentationResponse(BaseModel):
    """Response model for segmentation stage"""
    reasoning: str = Field(description="An analysis of the meaning of the input text, its core idea. Analysis of potential boundaries for segmentation of the transcript as a whole")

    segments: List[SegmentModel] = Field(description="List of segments (which together commpletely represent the original chunk")
    debug_notes: Optional[str] = Field(default=None, description="Optional: Your observations about any confusing aspects of the prompt, contradictions you faced, unclear instructions, or any difficulties in completing the task")


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
    target_node_name: Optional[str] = Field(default=None, description="Name of parent node")
    # New ID-based field, do processing based off of this.
    parent_node_id: Optional[int] = Field(default=None, description="ID of parent node (None for orphan)")
    new_node_name: str = Field(description="Name for the new node")
    content: str = Field(description="Content for the new node")
    summary: str = Field(description="Summary for the new node")
    relationship: str = Field(description="Relationship to parent (e.g., 'subtask of')")


class AppendAction(BaseTreeAction):
    """Model for APPEND action - adds content to existing node"""
    action: Literal["APPEND"] = Field(description="Action type")
    target_node_id: int = Field(description="ID of node to append content to")
    target_node_name: Optional[str] = Field(default=None, description="Name of target node (for fallback if ID not found)")
    content: str = Field(description="Content to append to the node")


class ChildNodeSpec(BaseModel):
    """Specification for a new child node to be created"""
    name: str = Field(description="Name for the new node")
    content: str = Field(description="Content for the new node")
    summary: str = Field(description="A concise summary for the new node")
    relationship: str = Field(description="The human-readable, 'fill-in-the-blank' phrase representing the relationship to the target node.")
    target_node_name: str = Field(description="Name of the node this new node should be linked to (default: current node being optimized)")


class OptimizationResponse(BaseModel):
    """Response model for single abstraction optimization - no union types"""
    reasoning: str = Field(description="COMPREHENSIVE reasoning notes for ALL stages.")
    
    # Boolean flag to indicate intent to create nodes
    should_create_nodes: bool = Field(description="Set to true if you want to create new child nodes, false otherwise")
    
    # New child nodes to create (only when should_create_nodes is true)
    new_nodes: List[ChildNodeSpec] = Field(description="List of new nodes to create (required when should_create_nodes=true, ignored when false)")

    # Original node update (if needed)
    original_new_content: Optional[str] = Field(description="Updated content for the original node.")
    original_new_summary: Optional[str] = Field(default=None, description="Updated summary for the original node.")
    
    debug_notes: Optional[str] = Field(default=None, description="Your observations about any confusing aspects of the prompt, contradictions you faced, unclear instruction which created difficulties in completing the task")
    
    def model_post_init(self, __context):
        """Validate consistency between should_create_nodes flag and new_nodes list"""
        if self.should_create_nodes and not self.new_nodes:
            raise ValueError("new_nodes cannot be empty when should_create_nodes is True")


class TargetNodeIdentification(BaseModel):
    """Model for identifying target node for a segment"""
    text: str = Field(description="The original text of the segment from the input. Word for Word.")
    reasoning: str = Field(description="Your reasoning/thought notes for each stage of the process to identify the target node")
    target_node_id: int = Field(description="ID of target node (use -1 for new nodes)")
    target_node_name: Optional[str] = Field(default=None, description="Name of the chosen existing node (required when is_orphan=False)")
    is_orphan: bool = Field(default=False, description="True when the segment has no possibly related target node")
    orphan_topic_name: Optional[str] = Field(default=None, description="Specific name the orphan should have (required if is_orphan=True)")
    relationship_to_target: str=Field(description="The fill-in-the-blank relationship type of segment, to either the target node, or orphan name")

    
    def model_post_init(self, __context):
        """Validate that new nodes have names and existing nodes have valid IDs"""
        if self.is_orphan:
            if not self.orphan_topic_name:
                raise ValueError("orphan_topic_name is required when is_orphan=True")
        else:
            if not self.target_node_name:
                raise ValueError("target_node_name is required when is_orphan=False")


class TargetNodeResponse(BaseModel):
    """Response model for identify target node stage"""
    target_nodes: List[TargetNodeIdentification] = Field(description="Target node for each segment")
    global_reasoning: str = Field(description="Your notes for understanding the complete text section")
    debug_notes: Optional[str] = Field(default=None, description="Your observations about any confusing aspects of the prompt, contradictions you faced, unclear instructions, or any difficulties in completing the task")


from typing import Union


class AppendAgentResult(BaseModel):
    """Result from AppendToRelevantNodeAgent containing actions and segment info"""
    actions: List[Union[AppendAction, CreateAction]] = Field(description="List of actions to apply")
    segments: List[SegmentModel] = Field(description="List of segments with completeness info")


class ClusterAssignment(BaseModel):
    """Assignment of a node to a cluster"""
    node_id: int = Field(description="ID of the node being assigned")
    cluster_name: Optional[str] = Field(description="Name of the cluster (None if unclustered)")

class TagAssignment(BaseModel):
    """Assignment of multiple tags to a node"""
    node_id: int = Field(description="ID of the node being assigned")
    tags: List[str] = Field(description="List of tags assigned to this node (empty list if no tags)")
    # don't add reasoning

class ClusteringResponse(BaseModel):
    """Response model for clustering analysis"""
    clusters: List[ClusterAssignment] = Field(description="List of cluster assignments for each node")


class TagResponse(BaseModel):
    """Response model for multi-tag analysis"""
    tags: List[TagAssignment] = Field(description="List of tag assignments for each node")


class Theme(BaseModel):
    """A single theme identified from the nodes."""
    theme_name: str = Field(description="A short, descriptive name for the theme.")
    theme_description: str = Field(description="A brief description of the theme.")
    node_names: List[str] = Field(description="A list of node titles/names belonging to this theme. Use the exact node titles as shown.")
    confidence: float = Field(description="Confidence score for the theme identification.", ge=0.0, le=1.0)


class ThemeResponse(BaseModel):
    """Response model for theme identification analysis"""
    themes: List[Theme] = Field(description="List of identified themes.")
