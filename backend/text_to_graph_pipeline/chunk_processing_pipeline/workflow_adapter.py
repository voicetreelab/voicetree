"""
Workflow Adapter for VoiceTree
Provides a clean interface between the VoiceTree backend and agentic workflows
"""

import asyncio
from typing import Dict, Any, List, Optional
from dataclasses import dataclass
from backend.text_to_graph_pipeline.agentic_workflows.pipeline import VoiceTreePipeline
from backend.text_to_graph_pipeline.agentic_workflows.schema_models import IntegrationDecision
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
            # Prepare state for the workflow (this updates internal state)
            self._prepare_state_snapshot()
            
            # Run the workflow with both transcript and transcript_history
            result = await asyncio.to_thread(
                self.pipeline.run,
                transcript,
                context  # This is the transcript_history from buffer manager
            )
            
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
            integration_decisions = [
                IntegrationDecision(**decision) for decision in integration_decisions_raw
            ]
            
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
                    "incomplete_buffer": result.get("incomplete_chunk_remainder", ""),
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
        Extract the text that was successfully processed from the chunks.
        
        This joins all the text from completed chunks to identify what portion
        of the original transcript was successfully processed.
        
        Args:
            workflow_result: Result from the workflow execution
            
        Returns:
            The concatenated text from all completed chunks
        """
        chunks = workflow_result.get("chunks", [])
        if not chunks:
            return ""
            
        # Join all completed chunk texts with a space
        completed_texts = []
        for chunk in chunks:
            text = chunk.get("text", "").strip()
            if text:
                completed_texts.append(text)
                
        return " ".join(completed_texts) if completed_texts else ""
    
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
    
    # when applying actions, if target node is null, don't try force finding it.
    def get_workflow_statistics(self) -> Dict[str, Any]:
        """Get statistics about the workflow state"""
        return self.pipeline.get_statistics()
    
    def clear_workflow_state(self) -> None:
        """Clear the workflow state"""
        self.pipeline.clear_state() 