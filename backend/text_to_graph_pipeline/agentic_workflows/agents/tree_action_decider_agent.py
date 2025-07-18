"""
VoiceTree agent implementation - self-contained with complete workflow
"""

from typing import Any, Dict, List, Optional

from langgraph.graph import END

from ..core.agent import Agent
from ..core.state import VoiceTreeState, validate_state
from ..models import (RelationshipResponse,
                      SegmentationResponse)
# IntegrationResponse removed - this agent will be replaced with new pipeline


class TreeActionDeciderAgent(Agent):
    """Self-contained VoiceTree agent with complete workflow"""
    
    def __init__(self):
        super().__init__("VoiceTreeAgent", VoiceTreeState)
        self._setup_workflow()
        
    def _setup_workflow(self):
        """Define prompts and dataflow"""
        # Define prompts - these will load from files
        self.add_prompt(
            "segmentation",
            "segmentation",  # References prompts/segmentation.md
            SegmentationResponse
        )
        
        self.add_prompt(
            "relationship_analysis", 
            "relationship_analysis",  # References prompts/relationship_analysis.md
            RelationshipResponse
        )
        
        # Commented out - IntegrationResponse removed, will be replaced with new pipeline
        # self.add_prompt(
        #     "integration_decision",
        #     "integration_decision",  # References prompts/integration_decision.md
        #     IntegrationResponse
        # )
        
        # Define dataflow
        self.add_dataflow("segmentation", "relationship_analysis")
        self.add_dataflow(
            "relationship_analysis",
            "integration_decision",
            transform=self._filter_complete_chunks
        )
        self.add_dataflow("integration_decision", END)
        
    def _filter_complete_chunks(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Only pass complete chunks to integration decision"""
        all_chunks = state.get("chunks", [])
        complete_chunks = [chunk for chunk in all_chunks if chunk.get("is_complete", False)]
        
        # Update analyzed_chunks to only include complete ones
        analyzed = state.get("analyzed_chunks", [])
        complete_names = {c["name"] for c in complete_chunks}
        filtered_analyzed = [a for a in analyzed if a.get("name") in complete_names]
        
        return {
            **state,
            "analyzed_chunks": filtered_analyzed
        }
        
    async def run(self, transcript: str, transcript_history: Optional[str] = None, 
            existing_nodes: Optional[str] = None) -> Dict[str, Any]:
        """
        Run the agent with proper initialization and result extraction
        
        Args:
            transcript: Voice transcript to process
            transcript_history: Optional context from previous transcripts
            existing_nodes: Description of existing knowledge nodes
            
        Returns:
            Complete processing results including extracted new nodes
        """
        from ..core.debug_logger import log_transcript_processing

        # Log the transcript being processed
        log_transcript_processing(transcript, "VoiceTreeAgent.run")
        
        # Create initial state
        initial_state: VoiceTreeState = {
            "transcript_text": transcript,
            "transcript_history": transcript_history or "",
            "existing_nodes": existing_nodes or "No existing nodes",
            "chunks": None,
            "analyzed_chunks": None,
            "integration_decisions": None,
            "new_nodes": None,
            "current_stage": "start",
            "error_message": None
        }
        
        # Validate state
        validate_state(initial_state)
        
        try:
            # Compile and run
            app = self.compile()
            result = await app.ainvoke(initial_state)
            
            # Extract new nodes from decisions if not already present
            if not result.get("new_nodes") and result.get("integration_decisions"):
                result["new_nodes"] = self._extract_new_nodes(result["integration_decisions"])
            
            # Create debug summary
            from ..core.debug_logger import create_debug_summary
            create_debug_summary()
                
            return result
            
        except Exception as e:
            return {
                **initial_state,
                "current_stage": "error",
                "error_message": str(e)
            }
            
    def _extract_new_nodes(self, decisions: List[Dict[str, Any]]) -> List[str]:
        """Extract new node names from integration decisions"""
        new_nodes = []
        for decision in decisions:
            if decision.get("action") == "CREATE" and decision.get("new_node_name"):
                new_nodes.append(decision["new_node_name"])
        return new_nodes