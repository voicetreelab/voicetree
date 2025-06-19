"""
Workflow Adapter for VoiceTree
Provides a clean interface between the VoiceTree backend and agentic workflows

Why? 
"""

import asyncio
import json
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass
from enum import Enum
from datetime import datetime

from backend.agentic_workflows.main import VoiceTreePipeline
from backend.tree_manager.decision_tree_ds import DecisionTree
# Define NodeAction locally to avoid circular imports
    # todo, we don't want multiple defintions                  can we avoid this? 
from collections import namedtuple

NodeAction = namedtuple('NodeAction',
                        [
                            'labelled_text',
                            'action',
                            'concept_name',
                            'neighbour_concept_name',
                            'relationship_to_neighbour',
                            'updated_summary_of_node',
                            'markdown_content_to_append',
                            'is_complete'
                        ])


class WorkflowMode(Enum):
    """Workflow execution modes"""
    ATOMIC = "atomic"  # State changes only after full completion
    STREAMING = "streaming"  # State changes during execution (future)
    # TODO, WE DON"T NEED TWO DIFFERENT MODES. 

@dataclass
class WorkflowResult:
    """Result from workflow execution"""
    success: bool
    new_nodes: List[str]
    node_actions: List[NodeAction]
    error_message: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class IntegrationDecision:
    """
    Unified data structure for integration decisions that can be converted to NodeAction.
    This eliminates the manual mapping layer by providing a shared schema.
    """
    name: str
    action: str
    target_node: Optional[str] = None
    new_node_name: Optional[str] = None
    new_node_summary: Optional[str] = None
    updated_summary: Optional[str] = None
    relationship: Optional[str] = None
    content: Optional[str] = None
    
    @classmethod
    def from_workflow_dict(cls, decision_data: Dict[str, Any]) -> 'IntegrationDecision':
        """
        Factory method to create IntegrationDecision from workflow output format.
        This handles the format conversion in one place.
        """
        if decision_data is None:
            raise ValueError("decision_data cannot be None")
        
        # Handle relationship fallback more carefully
        relationship = decision_data.get("relationship")
        if relationship is None:  # Only fallback if None, not empty string
            relationship = decision_data.get("relationship_for_edge")#todo why the hell do we have this? 
            # relationship_for_edge vs relationship
        
        return cls(
            name=decision_data.get("name", ""),
            action=decision_data.get("action", "").upper(),
            target_node=decision_data.get("target_node"),
            new_node_name=decision_data.get("new_node_name"),
            new_node_summary=decision_data.get("new_node_summary"),
            updated_summary=decision_data.get("updated_summary"),
            relationship=relationship,
            content=decision_data.get("content", "")
        )
    
    def to_node_action(self) -> NodeAction:
        """
        Convert IntegrationDecision to NodeAction.
        This replaces the manual mapping logic.
        """
        # Validate action before processing
        if not self.action or self.action not in ("CREATE", "APPEND"):
            raise ValueError(f"Invalid action type: '{self.action}'. Must be 'CREATE' or 'APPEND'")
        
        if self.action == "CREATE":
            return NodeAction(
                labelled_text=self.name,
                action="CREATE",
                concept_name=self.new_node_name or "",
                neighbour_concept_name=self.target_node or "",
                relationship_to_neighbour=self.relationship or "",
                updated_summary_of_node=self.new_node_summary or "",
                markdown_content_to_append=self.content or "",
                is_complete=True
            )
        elif self.action == "APPEND":
            return NodeAction(
                labelled_text=self.name,
                action="APPEND",
                concept_name=self.target_node or "",
                neighbour_concept_name=None,
                relationship_to_neighbour=None,
                updated_summary_of_node=self.updated_summary or "",
                markdown_content_to_append=self.content or "",
                is_complete=True
            )


class WorkflowAdapter:
    """
    Adapter between VoiceTree backend and agentic workflows.
    Handles state translation, execution, and result mapping.
    """
    
    def __init__(
        self, 
        decision_tree: DecisionTree,
        state_file: Optional[str] = None,
        mode: WorkflowMode = WorkflowMode.ATOMIC
    ):
        """
        Initialize the workflow adapter
        
        Args:
            decision_tree: The VoiceTree decision tree instance
            state_file: Optional path to persist workflow state
            mode: Execution mode (atomic or streaming)
        """
        self.decision_tree = decision_tree
        self.mode = mode
        self.pipeline = VoiceTreePipeline(state_file)
        self._incomplete_buffer = ""
    
    async def process_transcript(
        self, 
        transcript: str,
        context: Optional[str] = None
    ) -> WorkflowResult:
        """
        Process a transcript through the agentic workflow
        
        Args:
            transcript: The voice transcript to process
            context: Optional context from previous transcripts
            
        Returns:
            WorkflowResult with processing outcomes
        """
        try:
            # Prepare the full transcript with any incomplete buffer
            full_transcript = transcript
            if self._incomplete_buffer:
                full_transcript = self._incomplete_buffer + " " + transcript
            
            # Get current state snapshot for the workflow
            state_snapshot = self._prepare_state_snapshot()
            
            # Add the text to the pipeline buffer and force process it
            # This bypasses the pipeline's internal buffering since UnifiedBufferManager already handles chunking
            self.pipeline.text_buffer += full_transcript + " "
            
            # Force process the buffer regardless of threshold. (todo What??? why do this
            # todo let UnifiedBufferManager handle chunking for us here, then don't have a seperate "buffer" here that # just force processes????

            result = await asyncio.to_thread(
                self.pipeline.force_process_buffer
            )
            

            # Manually set the existing_nodes in the result if it's missing
            if result and not result.get("error_message"):
                # Ensure the pipeline had the existing nodes information
                # todo: why is this if statement actually necessary? seems confusing and unnecessary
                if "existing_nodes" not in result or result["existing_nodes"] == "No existing nodes":
                    # Re-run with proper existing nodes if needed
                    self.pipeline.text_buffer = ""  # Clear buffer
                    result = await asyncio.to_thread(
                        lambda: self.pipeline.run("", state_snapshot["existing_nodes"])
                    )
                    if result and not result.get("error_message"):
                        # Now add our actual content and process
                        result = await asyncio.to_thread(
                            lambda: self.pipeline.run(full_transcript, state_snapshot["existing_nodes"])
                        )
            
            # Process the workflow result
            if result.get("error_message"):
                return WorkflowResult(
                    success=False,
                    new_nodes=[],
                    node_actions=[],
                    error_message=result["error_message"]
                )
            
            # Update incomplete buffer
            self._incomplete_buffer = result.get("incomplete_chunk_remainder", "")
            
            # Convert workflow decisions to NodeActions
            node_actions = self._convert_to_node_actions(result)
            
            # todo: don't have two different modes? Why did we even want this initially?
            # Apply changes if in atomic mode
            if self.mode == WorkflowMode.ATOMIC:
                await self._apply_node_actions(node_actions)
            
            return WorkflowResult(
                success=True,
                new_nodes=result.get("new_nodes", []),
                node_actions=node_actions,
                metadata={
                    "chunks_processed": len(result.get("chunks", [])),
                    "decisions_made": len(result.get("integration_decisions", [])),
                    "incomplete_buffer": result.get("incomplete_chunk_remainder", "")
                }
            )
            
        except Exception as e:
            return WorkflowResult(
                success=False,
                new_nodes=[],
                node_actions=[],
                error_message=f"Workflow execution failed: {str(e)}"
            )
    
    def _prepare_state_snapshot(self) -> Dict[str, Any]:
        """
        Prepare a state snapshot for the workflow
        
        Returns:
            Dictionary with current tree state information
        """
        # Get all nodes with their summaries, ordered by creation time (most recent first)
        node_summaries = []
        nodes_by_recency = sorted(
            self.decision_tree.tree.items(),
            key=lambda x: x[1].created_at if hasattr(x[1], 'created_at') else datetime.min,
            reverse=True
        )
        
        for node_id, node in nodes_by_recency:
            if hasattr(node, 'title') and hasattr(node, 'summary'):
                # Include more context: summary, recent activity, and content preview
                node_info = f"- {node.title}: {node.summary}"
                
                # Add parent relationship context
                if hasattr(node, 'parent_id') and node.parent_id is not None:
                    parent_node = self.decision_tree.tree.get(node.parent_id)
                    if parent_node and hasattr(parent_node, 'title'):
                        node_info += f" (child of {parent_node.title})"
                # else: todo don't need this
                #     node_info += " (child of NO_RELEVANT_NODE)"
                
                # Add recent modification indicator. todo don't need 
                # if hasattr(node, 'modified_at') and hasattr(node, 'created_at'):
                #     if node.modified_at > node.created_at:
                #         node_info += " [recently updated]"
                
                node_summaries.append(node_info)
        
        # If no nodes exist, provide clear indication
        if not node_summaries:
            existing_nodes_text = "No existing nodes"
        else:
            existing_nodes_text = "\n".join(node_summaries)
        
        return {
            "existing_nodes": existing_nodes_text,
            "total_nodes": len(self.decision_tree.tree),
            "recent_nodes_count": min(5, len(self.decision_tree.tree))  # For context prioritization
        }
    
    def _convert_to_node_actions(self, workflow_result: Dict[str, Any]) -> List[NodeAction]:
        """
        Convert workflow integration decisions to NodeAction objects using the unified approach.
        This eliminates the manual field mapping by using the IntegrationDecision shared schema.
        
        Args:
            workflow_result: Result from the workflow execution
            
        Returns:
            List of NodeAction objects
        """
        decisions = workflow_result.get("integration_decisions", [])

        # FIXED: Eliminated manual mapping using IntegrationDecision shared schema
        # This solves the "impedance mismatch" problem by using a unified approach.
        
        node_actions = []
        for decision_data in decisions:
            try:
                # Convert to IntegrationDecision using the factory method
                integration_decision = IntegrationDecision.from_workflow_dict(decision_data)
                
                # Convert to NodeAction using the unified conversion method
                node_action = integration_decision.to_node_action()
                node_actions.append(node_action)
                
            except (ValueError, TypeError) as e:
                # Log the error but continue processing other decisions
                # This prevents one bad decision from breaking the entire workflow
                print(f"Warning: Skipping invalid integration decision: {e}")
                print(f"  Decision data: {decision_data}")
                continue
        
        return node_actions
    
    async def _apply_node_actions(self, node_actions: List[NodeAction]) -> None:
        """
        Apply node actions to the decision tree
        
        Args:
            node_actions: List of actions to apply
        """
        for action in node_actions:
            if action.action == "CREATE":
                parent_id = self.decision_tree.get_node_id_from_name(
                    action.neighbour_concept_name
                )
                self.decision_tree.create_new_node(
                    name=action.concept_name,
                    parent_node_id=parent_id,
                    content=action.markdown_content_to_append,
                    summary=action.updated_summary_of_node,
                    relationship_to_parent=action.relationship_to_neighbour
                )
                
            elif action.action == "APPEND":
                node_id = self.decision_tree.get_node_id_from_name(
                    action.concept_name
                )
                if node_id:
                    node = self.decision_tree.tree[node_id]
                    node.append_content(
                        action.markdown_content_to_append,
                        action.updated_summary_of_node,
                        action.labelled_text
                    )
    
    def get_workflow_statistics(self) -> Dict[str, Any]:
        """Get statistics about the workflow state"""
        return self.pipeline.get_statistics()
    
    def clear_workflow_state(self) -> None:
        """Clear the workflow state"""
        self.pipeline.clear_state()
        self._incomplete_buffer = "" 