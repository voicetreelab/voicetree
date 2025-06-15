"""
Workflow Adapter for VoiceTree
Provides a clean interface between the VoiceTree backend and agentic workflows
"""

import asyncio
import json
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass
from enum import Enum
from datetime import datetime

from agentic_workflows.main import VoiceTreePipeline
from tree_manager.decision_tree_ds import DecisionTree
from tree_manager import NodeAction


class WorkflowMode(Enum):
    """Workflow execution modes"""
    ATOMIC = "atomic"  # State changes only after full completion
    STREAMING = "streaming"  # State changes during execution (future)


@dataclass
class WorkflowResult:
    """Result from workflow execution"""
    success: bool
    new_nodes: List[str]
    node_actions: List[NodeAction]
    error_message: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


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
            
            # Run the workflow (synchronously for now, can be made async)
            result = await asyncio.to_thread(
                self.pipeline.run,
                full_transcript
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
                else:
                    node_info += " (child of NO_RELEVANT_NODE)"
                
                # Add recent modification indicator
                if hasattr(node, 'modified_at') and hasattr(node, 'created_at'):
                    if node.modified_at > node.created_at:
                        node_info += " [recently updated]"
                
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
        Convert workflow integration decisions to NodeAction objects
        
        Args:
            workflow_result: Result from the workflow execution
            
        Returns:
            List of NodeAction objects
        """
        node_actions = []
        decisions = workflow_result.get("integration_decisions", [])
        
        for decision in decisions:
            action = decision.get("action", "").upper()
            
            if action == "CREATE":
                node_action = NodeAction(
                    action="CREATE",
                    concept_name=decision.get("new_node_name", ""),
                    neighbour_concept_name=decision.get("target_node", ""),
                    relationship_to_neighbour=decision.get("relationship", ""),
                    markdown_content_to_append=decision.get("content", ""),
                    updated_summary_of_node=decision.get("new_node_summary", ""),
                    is_complete=True,
                    labelled_text=decision.get("name", "")
                )
                node_actions.append(node_action)
                
            elif action == "APPEND":
                node_action = NodeAction(
                    action="APPEND",
                    concept_name=decision.get("target_node", ""),
                    neighbour_concept_name=None,
                    relationship_to_neighbour=None,
                    markdown_content_to_append=decision.get("content", ""),
                    updated_summary_of_node=decision.get("updated_summary", ""),
                    is_complete=True,
                    labelled_text=decision.get("name", "")
                )
                node_actions.append(node_action)
        
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