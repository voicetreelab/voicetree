"""
Workflow Adapter for VoiceTree
Provides a clean interface between the VoiceTree backend and agentic workflows
"""

import asyncio
from typing import Dict, Any, List, Optional
from dataclasses import dataclass
from backend.text_to_graph_pipeline.agentic_workflows.agents.voice_tree import VoiceTreeAgent
from backend.text_to_graph_pipeline.agentic_workflows.core.state_manager import VoiceTreeStateManager
from backend.text_to_graph_pipeline.agentic_workflows.models import IntegrationDecision
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree
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
        self.agent = VoiceTreeAgent()
        self.state_manager = VoiceTreeStateManager(state_file) if state_file else None
    
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
            # Get existing nodes for context
            existing_nodes = self.state_manager.get_node_summaries() if self.state_manager else self._get_node_summaries()
            
            # Run the agent directly
            result = await asyncio.to_thread(
                self.agent.run,
                transcript=transcript,
                transcript_history=context,  # This is the transcript_history from buffer manager
                existing_nodes=existing_nodes
            )
            
            # Update state manager if present
            if self.state_manager and result.get("new_nodes"):
                self.state_manager.add_nodes(result["new_nodes"], result)
            
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
    
    def _get_node_summaries(self) -> str:
        """
        Get node summaries from decision tree
        
        Returns:
            String with node summaries
        """
        node_summaries = []
        for node in self.decision_tree.tree.values():
            if hasattr(node, 'title') and hasattr(node, 'summary'): # todo, title or name?
                node_summaries.append(f"{node.title}: {node.summary}")
        
        return "\n".join(node_summaries) if node_summaries else "No existing nodes"
    
    # when applying actions, if target node is null, don't try force finding it.
    def get_workflow_statistics(self) -> Dict[str, Any]:
        """Get statistics about the workflow state"""
        if self.state_manager:
            return self.state_manager.get_statistics()
        return {"error": "No state manager configured"}
    
    def clear_workflow_state(self) -> None:
        """Clear the workflow state"""
        if self.state_manager:
            self.state_manager.clear_state() 