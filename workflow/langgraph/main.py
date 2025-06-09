"""
Main runner for testing the VoiceTree LangGraph workflow
"""

import json
from typing import Dict, Any

try:
    from graph import compile_voicetree_graph
    from state import VoiceTreeState
    LANGGRAPH_AVAILABLE = True
except ImportError:
    print("⚠️ LangGraph dependencies not available")
    LANGGRAPH_AVAILABLE = False
    VoiceTreeState = dict
    
    def compile_voicetree_graph():
        class MockApp:
            def invoke(self, state):
                return {"error_message": "LangGraph not installed. Please install: pip install langgraph langchain-core"}
        return MockApp()


def run_voicetree_pipeline(transcript: str, existing_nodes: str = "") -> Dict[str, Any]:
    """
    Run the complete VoiceTree processing pipeline
    
    Args:
        transcript: The input transcript text to process
        existing_nodes: Summary of existing nodes in the tree
        
    Returns:
        Final state containing processing results
    """
    print("🚀 Starting VoiceTree LangGraph Pipeline")
    print("=" * 50)
    
    # Compile the graph
    app = compile_voicetree_graph()
    
    # Create initial state
    initial_state = {
        "transcript_text": transcript,
        "existing_nodes": existing_nodes,
        "chunks": None,
        "analyzed_chunks": None,
        "integration_decisions": None,
        "new_nodes": None,
        "current_stage": "start",
        "error_message": None
    }
    
    # Run the pipeline
    try:
        final_state = app.invoke(initial_state)
        
        print("\n✅ Pipeline completed successfully!")
        print("=" * 50)
        
        # Print results summary
        if final_state.get("error_message"):
            print(f"❌ Error: {final_state['error_message']}")
        else:
            print(f"📊 Results Summary:")
            print(f"   • Chunks found: {len(final_state.get('chunks', []))}")
            print(f"   • Analyzed chunks: {len(final_state.get('analyzed_chunks', []))}")
            print(f"   • Integration decisions: {len(final_state.get('integration_decisions', []))}")
            print(f"   • New nodes to create: {len(final_state.get('new_nodes', []))}")
            
            if final_state.get("new_nodes"):
                print(f"   • New node names: {', '.join(final_state['new_nodes'])}")
        
        return final_state
        
    except Exception as e:
        print(f"❌ Pipeline failed: {str(e)}")
        return {
            **initial_state,
            "current_stage": "error",
            "error_message": str(e)
        }


def print_detailed_results(final_state: Dict[str, Any]):
    """Print detailed results from the pipeline execution"""
    
    print("\n" + "=" * 60)
    print("📋 DETAILED PIPELINE RESULTS")
    print("=" * 60)
    
    if final_state.get("error_message"):
        print(f"❌ Pipeline Error: {final_state['error_message']}")
        return
    
    # Stage 1: Segmentation
    chunks = final_state.get("chunks", [])
    print(f"\n🔵 Stage 1: Segmentation")
    print(f"Found {len(chunks)} chunks:")
    for i, chunk in enumerate(chunks, 1):
        print(f"  {i}. {chunk.get('name', 'Unnamed')} ({'✅ Complete' if chunk.get('is_complete') else '⚠️ Incomplete'})")
        print(f"     Text: {chunk.get('text', '')[:100]}...")
    
    # Stage 2: Relationship Analysis
    analyzed_chunks = final_state.get("analyzed_chunks", [])
    print(f"\n🔵 Stage 2: Relationship Analysis")
    for i, chunk in enumerate(analyzed_chunks, 1):
        rel_node = chunk.get('relevant_node_name', 'Unknown')
        relationship = chunk.get('relationship', 'None')
        print(f"  {i}. {chunk.get('name')} → {rel_node} ({relationship})")
    
    # Stage 3: Integration Decisions
    decisions = final_state.get("integration_decisions", [])
    print(f"\n🔵 Stage 3: Integration Decisions")
    for i, decision in enumerate(decisions, 1):
        action = decision.get('action', 'Unknown')
        target = decision.get('target_node', 'Unknown')
        print(f"  {i}. {decision.get('name')}: {action} → {target}")
        if action == "CREATE":
            print(f"     New node: {decision.get('new_node_name')}")
            print(f"     Summary: {decision.get('new_node_summary', '')[:80]}...")
    
    # Stage 4: New Nodes
    new_nodes = final_state.get("new_nodes", [])
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
    
    test_existing_nodes = """
    Existing nodes in the tree:
    - AI Projects: General category for AI-related work
    - Voice Processing: Work related to voice input processing
    - Knowledge Management: Systems for organizing information
    """
    
    print("🧪 Testing VoiceTree LangGraph Pipeline")
    print("=" * 50)
    print(f"Input transcript: {test_transcript.strip()}")
    print(f"Existing nodes: {test_existing_nodes.strip()}")
    
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