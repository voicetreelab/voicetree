"""
Workflow Adapter for VoiceTree
Provides a clean interface between the VoiceTree backend and agentic workflows
"""

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from backend.text_to_graph_pipeline.orchestration.tree_action_decider import \
    TreeActionDecider
from backend.text_to_graph_pipeline.agentic_workflows.models import \
    CreateAction, AppendAction, BaseTreeAction
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import \
    DecisionTree
# Removed get_node_summaries import - no longer needed


@dataclass
class WorkflowResult:
    """Result from workflow execution"""
    success: bool
    new_nodes: List[str]
    tree_actions: List[BaseTreeAction]  # Changed from integration_decisions
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
        agent: Optional[TreeActionDecider] = None
    ):
        """
        Initialize the workflow adapter
        
        Args:
            decision_tree: The VoiceTree decision tree instance
            agent: Optional TreeActionDecider instance (will create one if not provided)
        """
        self.decision_tree = decision_tree
        self.agent = agent or TreeActionDecider()
    
    async def process_full_buffer(
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
            # Call the orchestrator
            optimization_actions = await self.agent.run(
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
                    "completed_chunks": [transcript]  # For buffer management
                }
            )
            
        except Exception as e:
            return WorkflowResult(
                success=False,
                new_nodes=[],
                tree_actions=[],
                error_message=f"Workflow execution failed: {str(e)}"
            )
    
    
    # when applying actions, if target node is null, don't try force finding it.
    def get_workflow_statistics(self) -> Dict[str, Any]:
        """Get statistics about the workflow state"""
        # Since workflow is now stateless, return tree statistics instead
        return {
            "total_nodes": len(self.decision_tree.tree),
            "message": "Workflow is stateless - showing tree statistics"
        }
    
    def clear_workflow_state(self) -> None:
        """Clear the workflow state"""
        # No state to clear - workflow is now stateless
        pass 