"""
VoiceTree LangGraph workflow pipeline implementation
"""

from typing import Dict, Any, List, Optional

from backend.text_to_graph_pipeline.agentic_workflows.graph import compile_voicetree_graph
from backend.text_to_graph_pipeline.agentic_workflows.state import VoiceTreeState
from backend.text_to_graph_pipeline.agentic_workflows.state_manager import VoiceTreeStateManager


class VoiceTreePipeline:
    """Main pipeline class that maintains state across executions"""
    
    def __init__(self, state_file: Optional[str] = None):
        """
        Initialize the pipeline with optional persistent state
        
        Args:
            state_file: Optional path to persist state to disk
        """
        self.state_manager = VoiceTreeStateManager(state_file)
        self.app = compile_voicetree_graph()
        self.incomplete_chunk_buffer = ""  # Buffer for incomplete chunks
    
    def run(self, transcript: str) -> Dict[str, Any]:
        """
        Run the VoiceTree processing pipeline
        
        Args:
            transcript: The input transcript text to process
            
        Returns:
            Final state containing processing results
        """
        print("🚀 Starting VoiceTree LangGraph Pipeline")
        print("=" * 50)
        
        # NOTE: Incomplete chunk handling is now managed by TextBufferManager
        
        # Get existing nodes from state manager
        existing_nodes_text = self.state_manager.get_node_summaries() if self.state_manager else "No existing nodes"
        
        # Create initial state
        initial_state = {
            "transcript_text": transcript,
            "existing_nodes": existing_nodes_text,
            "incomplete_chunk_buffer": self.incomplete_chunk_buffer,
            "chunks": None,
            "analyzed_chunks": None,
            "integration_decisions": None,
            "new_nodes": None,
            "incomplete_chunk_remainder": None,
            "current_stage": "start",
            "error_message": None
        }
        
        # Run the pipeline
        try:
            final_state = self.app.invoke(initial_state)
            
            # Extract new nodes from integration decisions if not already present
            if final_state.get("integration_decisions") and not final_state.get("new_nodes"):
                new_nodes = []
                for decision in final_state["integration_decisions"]:
                    if decision.get("action") == "CREATE" and decision.get("new_node_name"):
                        new_nodes.append(decision["new_node_name"])
                final_state["new_nodes"] = new_nodes
            
            print("\n✅ Pipeline completed successfully!")
            print("=" * 50)
            
            # Print results summary
            if final_state.get("error_message"):
                print(f"❌ Error: {final_state['error_message']}")
            else:
                self._print_results_summary(final_state)
                
                # Update state manager with new nodes
                if self.state_manager and final_state.get("new_nodes"):
                    self.state_manager.add_nodes(final_state["new_nodes"], final_state)
                    print(f"\n📊 State updated: {len(self.state_manager.nodes)} total nodes")
                
                # Update incomplete chunk buffer for next execution
                self.incomplete_chunk_buffer = final_state.get("incomplete_chunk_remainder", "")
                if self.incomplete_chunk_buffer:
                    print(f"\n⏳ Incomplete chunk saved for next execution: '{self.incomplete_chunk_buffer[:50]}...'")
            
            return final_state
            
        except Exception as e:
            print(f"❌ Pipeline failed: {str(e)}")
            return {
                **initial_state,
                "current_stage": "error",
                "error_message": str(e)
            }
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get statistics about the current state"""
        if self.state_manager:
            return self.state_manager.get_statistics()
        return {"error": "No state manager available"}
    
    def clear_state(self) -> None:
        """Clear all state"""
        if self.state_manager:
            self.state_manager.clear_state()
            print("🗑️ State cleared")
    
    def _print_results_summary(self, state: Dict[str, Any]) -> None:
        """Print a summary of pipeline results"""
        print("📊 Results Summary:")
        print(f"   • Chunks found: {len(state.get('chunks', []))}")
        print(f"   • Analyzed chunks: {len(state.get('analyzed_chunks', []))}")
        print(f"   • Integration decisions: {len(state.get('integration_decisions', []))}")
        print(f"   • New nodes to create: {len(state.get('new_nodes', []))}")
        
        if state.get("new_nodes"):
            print(f"   • New node names: {', '.join(state['new_nodes'])}")


def run_voicetree_pipeline(
    transcript: str, 
    existing_nodes: Optional[List[str]] = None,
    state_file: Optional[str] = None
) -> Dict[str, Any]:
    """
    Run the complete VoiceTree processing pipeline (backward compatibility)
    
    Args:
        transcript: The input transcript text to process
        existing_nodes: List of existing node names in the tree (deprecated - use state_file instead)
        state_file: Optional path to persist state
        
    Returns:
        Final state containing processing results
    """
    # Create a temporary pipeline instance
    pipeline = VoiceTreePipeline(state_file)
    
    # If existing_nodes provided, add them to state manager (for backward compatibility)
    if existing_nodes and pipeline.state_manager:
        for node in existing_nodes:
            if node not in pipeline.state_manager.nodes:
                pipeline.state_manager.nodes[node] = {
                    "name": node,
                    "created_at": "legacy",
                    "summary": "",
                    "parent": None,
                    "content": ""
                }
    
    return pipeline.run(transcript)




 