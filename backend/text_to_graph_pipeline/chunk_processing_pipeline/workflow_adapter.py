"""
Workflow Adapter for VoiceTree
Provides a clean interface between the VoiceTree backend and agentic workflows
"""

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from backend.text_to_graph_pipeline.agentic_workflows.agents.voice_tree import \
    VoiceTreeAgent
from backend.text_to_graph_pipeline.agentic_workflows.models import \
    IntegrationDecision
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import \
    DecisionTree
from backend.text_to_graph_pipeline.tree_manager.tree_functions import \
    get_node_summaries


@dataclass
class WorkflowResult:
    """Result from workflow execution"""
    success: bool
    new_nodes: List[str]
    integration_decisions: List[IntegrationDecision]
    error_message: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class WorkflowAdapter:
    """
    Adapter between VoiceTree backend and agentic workflows.
    Handles state translation, execution, and result mapping.
    """
    
    def __init__(
        self, 
        decision_tree: DecisionTree
    ):
        """
        Initialize the workflow adapter
        
        Args:
            decision_tree: The VoiceTree decision tree instance
        """
        self.decision_tree = decision_tree
        self.agent = VoiceTreeAgent()
    
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

            # ideally here we should just have result: IntegrationDecision[]
            # also, IntegrationDecision should probs be renamed to TreeAction since that better represents what it is
            
            # No state manager - workflow is now a pure function
            
            # Process the workflow result
            if result.get("error_message"):
                return WorkflowResult(
                    success=False,
                    new_nodes=[],
                    integration_decisions=[],
                    error_message=result["error_message"]
                )
            
            # Get integration decisions and convert to Pydantic models
            integration_decisions_raw = result.get("integration_decisions", [])
            integration_decisions = []
            for decision in integration_decisions_raw:
                # Convert "NO_RELEVANT_NODE" to None for cleaner downstream handling
                if decision.get("target_node") == "NO_RELEVANT_NODE":
                    decision["target_node"] = None
                integration_decisions.append(IntegrationDecision(**decision))
            
            # Extract new node names from integration decisions
            new_nodes = []
            for decision in integration_decisions:
                if decision.action == "CREATE" and decision.new_node_name:
                    new_nodes.append(decision.new_node_name)
            

            
            return WorkflowResult(
                success=True,
                new_nodes=new_nodes,
                integration_decisions=integration_decisions,
                metadata={
                    "chunks_processed": len(result.get("chunks", [])),
                    "decisions_made": len(integration_decisions),
                    "completed_text": self._extract_completed_text(result)
                }
            )
            
        except Exception as e:
            return WorkflowResult(
                success=False,
                new_nodes=[],
                integration_decisions=[],
                error_message=f"Workflow execution failed: {str(e)}"
            )
    
    def _extract_completed_text(self, workflow_result: Dict[str, Any]) -> str:
        """
        Extract ONLY text from complete chunks that were segmented by the workflow.
        
        Incomplete chunks should remain in the buffer to be combined with the
        next transcript segment, so we only flush text from complete chunks.
        
        Args:
            workflow_result: Result from the workflow execution
            
        Returns:
            The concatenated text from complete chunks only
        """
        # Get all chunks from segmentation
        chunks = workflow_result.get("chunks", [])
        if not chunks:
            return ""
            
        # Extract text ONLY from complete chunks
        complete_texts = []
        for chunk in chunks:
            if chunk.get("is_complete", False):
                text = chunk.get("text", "").strip()
                if text:
                    complete_texts.append(text)
                
        return " ".join(complete_texts) if complete_texts else ""
    
    
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