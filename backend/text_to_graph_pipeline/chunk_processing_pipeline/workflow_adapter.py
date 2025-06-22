"""
Workflow Adapter for VoiceTree
Provides a clean interface between the VoiceTree backend and agentic workflows
"""

import asyncio
import json
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass
from backend.text_to_graph_pipeline.agentic_workflows.pipeline import VoiceTreePipeline
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree
from backend.text_to_graph_pipeline.tree_manager import NodeAction


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
        state_file: Optional[str] = None
    ):
        """
        Initialize the workflow adapter
        
        Args:
            decision_tree: The VoiceTree decision tree instance
            state_file: Optional path to persist workflow state
        """
        self.decision_tree = decision_tree
        self.pipeline = VoiceTreePipeline(state_file)
    
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
            # Get current state snapshot for the workflow
            state_snapshot = self._prepare_state_snapshot()
            
            # Run the workflow (synchronously for now, can be made async)
            result = await asyncio.to_thread(
                self.pipeline.run,
                transcript
            )
            
            # Process the workflow result
            if result.get("error_message"):
                return WorkflowResult(
                    success=False,
                    new_nodes=[],
                    node_actions=[],
                    error_message=result["error_message"]
                )
            
            # Convert workflow decisions to NodeActions
            node_actions = self._convert_to_node_actions(result)
            
            # Extract new node names from integration decisions
            new_nodes = []
            for decision in result.get("integration_decisions", []):
                if decision.get("action") == "CREATE" and decision.get("new_node_name"):
                    new_nodes.append(decision["new_node_name"])
            
            # Note: In ATOMIC mode, the caller (ChunkProcessor) is responsible for applying node actions
            # to avoid duplicate application
            
            return WorkflowResult(
                success=True,
                new_nodes=new_nodes,
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
        # Get all nodes with their summaries
        node_summaries = []
        for node_id, node in self.decision_tree.tree.items():
            if hasattr(node, 'name') and hasattr(node, 'summary'):
                node_summaries.append(f"{node.name}: {node.summary}")
        
        return {
            "existing_nodes": "\n".join(node_summaries),
            "total_nodes": len(self.decision_tree.tree)
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
                    relationship_to_neighbour=decision.get("relationship_for_edge", ""),
                    markdown_content_to_append=decision.get("content", decision.get("text", "")),
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