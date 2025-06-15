"""
Main runner for testing the VoiceTree LangGraph workflow
"""

import json
from typing import Dict, Any, List, Optional
from pathlib import Path

try:
    from agentic_workflows.graph import compile_voicetree_graph
    from agentic_workflows.state import VoiceTreeState
    from agentic_workflows.state_manager import VoiceTreeStateManager
    LANGGRAPH_AVAILABLE = True
except ImportError:
    print("⚠️ LangGraph dependencies not available")
    LANGGRAPH_AVAILABLE = False
    VoiceTreeState = dict
    VoiceTreeStateManager = None
    
    def compile_voicetree_graph():
        class MockApp:
            def invoke(self, state):
                return {"error_message": "LangGraph not installed. Please install: pip install langgraph langchain-core"}
        return MockApp()


class VoiceTreePipeline:
    """Main pipeline class that maintains state across executions"""
    
    def __init__(self, state_file: Optional[str] = None, buffer_threshold: int = 500):
        """
        Initialize the pipeline with optional persistent state
        
        Args:
            state_file: Optional path to persist state to disk
            buffer_threshold: Character count threshold for processing
        """
        self.state_manager = VoiceTreeStateManager(state_file) if LANGGRAPH_AVAILABLE else None
        self.app = compile_voicetree_graph()
        self.text_buffer = ""  # Simple character-count buffer
        self.buffer_threshold = buffer_threshold
    
    def run(self, transcript: str) -> Dict[str, Any]:
        """
        Run the VoiceTree processing pipeline with simple character-count buffering
        
        Args:
            transcript: The input transcript text to process
            
        Returns:
            Final state containing processing results
        """
        # Add new text to buffer
        self.text_buffer += transcript + " "
        
        # Check if buffer is ready for processing
        if len(self.text_buffer) < self.buffer_threshold:
            # Not enough content yet, return empty result
            return {
                "chunks": [],
                "new_nodes": [],
                "current_stage": "buffering",
                "buffer_size": len(self.text_buffer),
                "buffer_threshold": self.buffer_threshold
            }
        
        # Buffer is ready, process it
        text_to_process = self.text_buffer.strip()
        self.text_buffer = ""  # Clear buffer after processing
        
        print("🚀 Starting VoiceTree LangGraph Pipeline")
        print("=" * 50)
        print(f"📊 Processing buffered text: {len(text_to_process)} characters")
        
        # Get existing nodes from state manager
        existing_nodes_text = self.state_manager.get_node_summaries() if self.state_manager else "No existing nodes"
        
        # Create initial state
        initial_state = {
            "transcript_text": text_to_process,
            "existing_nodes": existing_nodes_text,
            "incomplete_chunk_buffer": "",  # No longer used
            "chunks": None,
            "analyzed_chunks": None,
            "integration_decisions": None,
            "new_nodes": None,
            "incomplete_chunk_remainder": None,  # No longer used
            "current_stage": "start",
            "error_message": None
        }
        
        # Run the pipeline
        try:
            final_state = self.app.invoke(initial_state)
            
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
        """Clear all state including buffer"""
        self.text_buffer = ""  # Clear the buffer too
        if self.state_manager:
            self.state_manager.clear_state()
            print("🗑️ State cleared")
    
    def force_process_buffer(self) -> Dict[str, Any]:
        """Force process whatever is in the buffer, regardless of threshold"""
        if not self.text_buffer.strip():
            return {
                "chunks": [],
                "new_nodes": [],
                "current_stage": "empty_buffer"
            }
        
        # Temporarily lower threshold to force processing
        original_threshold = self.buffer_threshold
        self.buffer_threshold = 0
        
        try:
            result = self.run("")  # Empty string won't add to buffer
            return result
        finally:
            self.buffer_threshold = original_threshold
    
    @property
    def incomplete_chunk_buffer(self) -> str:
        """Compatibility property for tests that expect this attribute"""
        return self.text_buffer
    
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


def print_detailed_results(final_state: Dict[str, Any]) -> None:
    """
    Print detailed results from the pipeline execution
    
    Args:
        final_state: The final state from pipeline execution
    """
    print("\n" + "=" * 60)
    print("📋 DETAILED PIPELINE RESULTS")
    print("=" * 60)
    
    if final_state.get("error_message"):
        print(f"❌ Pipeline Error: {final_state['error_message']}")
        return
    
    # Stage 1: Segmentation
    _print_segmentation_results(final_state.get("chunks", []))
    
    # Stage 2: Relationship Analysis
    _print_relationship_results(final_state.get("analyzed_chunks", []))
    
    # Stage 3: Integration Decisions
    _print_integration_results(final_state.get("integration_decisions", []))
    
    # Stage 4: New Nodes
    _print_new_nodes(final_state.get("new_nodes", []))


def _print_segmentation_results(chunks: List[Dict[str, Any]]) -> None:
    """Print segmentation stage results"""
    print(f"\n🔵 Stage 1: Segmentation")
    print(f"Found {len(chunks)} chunks:")
    for i, chunk in enumerate(chunks, 1):
        status = '✅ Complete' if chunk.get('is_complete') else '⚠️ Incomplete'
        print(f"  {i}. {chunk.get('name', 'Unnamed')} ({status})")
        text_preview = chunk.get('text', '')[:100]
        if len(chunk.get('text', '')) > 100:
            text_preview += "..."
        print(f"     Text: {text_preview}")


def _print_relationship_results(analyzed_chunks: List[Dict[str, Any]]) -> None:
    """Print relationship analysis results"""
    print(f"\n🔵 Stage 2: Relationship Analysis")
    for i, chunk in enumerate(analyzed_chunks, 1):
        rel_node = chunk.get('relevant_node_name', 'Unknown')
        relationship = chunk.get('relationship', 'None')
        print(f"  {i}. {chunk.get('name')} → {rel_node} ({relationship})")


def _print_integration_results(decisions: List[Dict[str, Any]]) -> None:
    """Print integration decision results"""
    print(f"\n🔵 Stage 3: Integration Decisions")
    for i, decision in enumerate(decisions, 1):
        action = decision.get('action', 'Unknown')
        target = decision.get('target_node', 'Unknown')
        print(f"  {i}. {decision.get('name')}: {action} → {target}")
        if action == "CREATE":
            print(f"     New node: {decision.get('new_node_name')}")
            summary = decision.get('new_node_summary', '')[:80]
            if len(decision.get('new_node_summary', '')) > 80:
                summary += "..."
            print(f"     Summary: {summary}")


def _print_new_nodes(new_nodes: List[str]) -> None:
    """Print new nodes to be created"""
    print(f"\n🔵 Stage 4: New Nodes to Create")
    if new_nodes:
        for i, node in enumerate(new_nodes, 1):
            print(f"  {i}. {node}")
    else:
        print("  No new nodes to create")


def main():
    """Main function for testing"""
    
    # Sample test data
    test_transcript = """
    Today I want to work on my voice tree project. I need to add new features to make it better.
    The main goal is to create a system that can process voice input and build knowledge graphs.
    I should also think about how to integrate this with existing tools and frameworks.
    """
    
    test_existing_nodes = [
        "AI Projects",
        "Voice Processing", 
        "Knowledge Management"
    ]
    
    print("🧪 Testing VoiceTree LangGraph Pipeline")
    print("=" * 50)
    print(f"Input transcript: {test_transcript.strip()}")
    print(f"Existing nodes: {test_existing_nodes}")
    
    # Run the pipeline
    result = run_voicetree_pipeline(test_transcript, test_existing_nodes)
    
    # Print detailed results
    print_detailed_results(result)
    
    # Save results to file for inspection
    output_file = "test_results.json"
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, default=str)
    
    print(f"\n💾 Results saved to: {output_file}")


if __name__ == "__main__":
    main() 