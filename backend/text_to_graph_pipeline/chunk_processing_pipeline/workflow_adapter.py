"""
Workflow Adapter for VoiceTree
Provides a clean interface between the VoiceTree backend and agentic workflows
"""

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from backend.text_to_graph_pipeline.agentic_workflows.agents.tree_action_decider_agent import \
    TreeActionDeciderAgent
from backend.text_to_graph_pipeline.agentic_workflows.models import \
    CreateAction, AppendAction, BaseTreeAction
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import \
    DecisionTree
from backend.text_to_graph_pipeline.tree_manager.tree_functions import \
    get_node_summaries


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
        agent: Optional[TreeActionDeciderAgent] = None
    ):
        """
        Initialize the workflow adapter
        
        Args:
            decision_tree: The VoiceTree decision tree instance
            agent: Optional VoiceTreeAgent instance (will create one if not provided)
        """
        self.decision_tree = decision_tree
        self.agent = agent or TreeActionDeciderAgent()
    
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
            # Get existing nodes for context
            existing_nodes = get_node_summaries(self.decision_tree, max_nodes=10)
            
            # Run the agent asynchronously
            result = await self.agent.run(
                transcript=transcript,
                transcript_history=context,  # This is the transcript_history from buffer manager
                existing_nodes=existing_nodes
            )

            # The result should contain tree actions (CreateAction, AppendAction, etc.)
            
            # No state manager - workflow is now a pure function
            
            # Process the workflow result
            if result.get("error_message"):
                return WorkflowResult(
                    success=False,
                    new_nodes=[],
                    tree_actions=[],
                    error_message=result["error_message"]
                )
            
            # Get tree actions and convert to Pydantic models
            tree_actions_raw = result.get("tree_actions", result.get("integration_decisions", []))  # Support both field names during transition
            tree_actions = []
            for decision in tree_actions_raw:
                # Convert "NO_RELEVANT_NODE" to None for cleaner downstream handling
                if decision.get("target_node") == "NO_RELEVANT_NODE":
                    decision["target_node"] = None
                # Convert to appropriate action type based on action field
                action_type = decision.get("action")
                if action_type == "CREATE":
                    tree_actions.append(CreateAction(**decision))
                elif action_type == "APPEND":
                    tree_actions.append(AppendAction(**decision))
            
            # Extract new node names from CREATE actions
            new_nodes = []
            for action in tree_actions:
                if isinstance(action, CreateAction) and action.new_node_name:
                    new_nodes.append(action.new_node_name)
            

            
            return WorkflowResult(
                success=True,
                new_nodes=new_nodes,
                tree_actions=tree_actions,
                metadata={
                    "chunks_processed": len(result.get("chunks", [])),
                    "actions_generated": len(tree_actions),
                    "completed_chunks": self._extract_completed_chunks(result)
                }
            )
            
        except Exception as e:
            return WorkflowResult(
                success=False,
                new_nodes=[],
                tree_actions=[],
                error_message=f"Workflow execution failed: {str(e)}"
            )
    
    
    def _extract_completed_chunks(self, workflow_result: Dict[str, Any]) -> List[str]:
        """
        Extract text from complete chunks as a list.
        
        Each complete chunk should be removed from the buffer individually
        to handle non-contiguous chunks correctly.
        
        Args:
            workflow_result: Result from the workflow execution
            
        Returns:
            List of texts from complete chunks
        """
        chunks = workflow_result.get("chunks", [])
        if not chunks:
            return []
            
        complete_texts = []
        for chunk in chunks:
            if chunk.get("is_complete", False):
                text = chunk.get("text", "")
                if text:
                    complete_texts.append(text)
                    
        return complete_texts
    
    
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