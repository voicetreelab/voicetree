"""
TreeActionDeciderWorkflow - Orchestrates the two-step tree update pipeline with workflow result handling.

Combines the functionality of TreeActionDecider and WorkflowAdapter into a single cohesive class.
"""

from dataclasses import dataclass
from typing import List, Union, Optional, Dict, Any

from ..agentic_workflows.agents.append_to_relevant_node_agent import AppendToRelevantNodeAgent
from ..agentic_workflows.agents.single_abstraction_optimizer_agent import SingleAbstractionOptimizerAgent
from ..agentic_workflows.models import UpdateAction, CreateAction, BaseTreeAction
from ..tree_manager.decision_tree_ds import DecisionTree
from .apply_tree_actions import TreeActionApplier


@dataclass
class WorkflowResult:
    """Result from workflow execution"""
    success: bool
    new_nodes: List[str]
    tree_actions: List[BaseTreeAction]
    error_message: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class TreeActionDeciderWorkflow:
    """
    Orchestrates the two-step tree update pipeline with workflow result handling.
    NOT an agent - pure deterministic coordination with result wrapping.
    """
    
    def __init__(self, decision_tree: Optional[DecisionTree] = None):
        """
        Initialize the workflow
        
        Args:
            decision_tree: Optional decision tree instance (can be set later)
        """
        self.decision_tree = decision_tree
        self.append_agent = AppendToRelevantNodeAgent()
        self.optimizer_agent = SingleAbstractionOptimizerAgent()
    
    async def run(
        self,
        transcript_text: str,
        decision_tree: Optional[DecisionTree] = None,
        transcript_history: str = ""
    ) -> List[Union[UpdateAction, CreateAction]]:
        """
        Execute the two-step pipeline (raw version without result wrapping).
        
        Args:
            transcript_text: New transcript content to process
            decision_tree: Current tree state (uses instance tree if not provided)
            transcript_history: Previous transcript context
            
        Returns:
            List of optimization actions (UpdateAction or CreateAction)
        """
        tree = decision_tree or self.decision_tree
        if not tree:
            raise ValueError("No decision tree provided")
        
        # Step 1: Get placement actions from AppendToRelevantNodeAgent
        placement_actions = await self.append_agent.run(
            transcript_text=transcript_text,
            decision_tree=tree,
            transcript_history=transcript_history
        )
        
        # If no placement actions, return empty list
        if not placement_actions:
            return []
        
        # Step 2: Apply placement actions internally to get modified node IDs
        applier = TreeActionApplier(tree)
        modified_node_ids = applier.apply(placement_actions)
        
        # Step 3: Optimize each modified node
        optimization_actions = []
        for node_id in modified_node_ids:
            actions = await self.optimizer_agent.run(
                node_id=node_id,
                decision_tree=tree
            )
            optimization_actions.extend(actions)
        
        return optimization_actions
    
    async def process_full_buffer(
        self, 
        transcript: str,
        context: Optional[str] = None
    ) -> WorkflowResult:
        """
        Process a transcript through the workflow with result wrapping.
        
        Args:
            transcript: The voice transcript to process
            context: Optional context from previous transcripts
            
        Returns:
            WorkflowResult with processing outcomes
        """
        if not self.decision_tree:
            return WorkflowResult(
                success=False,
                new_nodes=[],
                tree_actions=[],
                error_message="No decision tree set for workflow"
            )
        
        try:
            # Call the orchestrator
            optimization_actions = await self.run(
                transcript_text=transcript,
                decision_tree=self.decision_tree,
                transcript_history=context or ""
            )
            
            # Track new nodes from CREATE actions
            new_nodes = []
            for action in optimization_actions:
                if isinstance(action, CreateAction) and action.new_node_name:
                    new_nodes.append(action.new_node_name)
            
            return WorkflowResult(
                success=True,
                new_nodes=new_nodes,
                tree_actions=optimization_actions,  # Only optimization actions
                metadata={
                    "processed_text": transcript,
                    "actions_generated": len(optimization_actions),
                    "completed_chunks": [transcript]  # TODO: here we need to extract only the completed chunks 
                }
            )
            
        except Exception as e:
            return WorkflowResult(
                success=False,
                new_nodes=[],
                tree_actions=[],
                error_message=f"Workflow execution failed: {str(e)}"
            )
    
    def get_workflow_statistics(self) -> Dict[str, Any]:
        """Get statistics about the workflow state"""
        if not self.decision_tree:
            return {"error": "No decision tree set"}
        
        return {
            "total_nodes": len(self.decision_tree.tree),
            "message": "Workflow is stateless - showing tree statistics"
        }
    
    def clear_workflow_state(self) -> None:
        """Clear the workflow state"""
        # No state to clear - workflow is now stateless
        pass