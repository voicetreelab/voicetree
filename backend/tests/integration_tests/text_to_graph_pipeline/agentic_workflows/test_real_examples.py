#!/usr/bin/env python3
"""
Test the VoiceTree LangGraph pipeline with real examples from the integration tests
"""

import asyncio
import json
import sys
from pathlib import Path
import pytest
from backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow import \
    TreeActionDeciderWorkflow
from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree

# Add project root to path for imports
current_dir = Path(__file__).parent
project_root = current_dir.parent.parent.parent  # Go up to VoiceTree directory
sys.path.insert(0, str(project_root))


@pytest.mark.asyncio
async def test_complex_tree_creation():
    """Test with the same examples used in the integration tests"""
    
    print("🧪 Testing VoiceTree LangGraph Pipeline with Real Integration Test Examples")
    print("=" * 80)
    
    # These are the exact transcripts from test_system_llm_live.py
    transcript1 = """
    This is a test of the VoiceTree application.
    I want to create a new node about project planning. 
    The first step is to define the project scope. 
    The next step is to identify the key stakeholders.
    """

    transcript2 = (
        "Another thing I will have to do is start reaching out to investors "
        "to see what next steps they would recommend for me. "
        "I should talk to Austin's dad first."
    )

    transcript3 = (
        "To be able to start reaching out to investors, I will first have to polish my POC. "
        "This involves refining the user interface, improving the summarization quality, "
        "and making sure the application is robust and easy to use. "
        "I'll also need to prepare a compelling pitch deck and presentation."
    )
    
    # Start with empty tree (just root node)
    decision_tree = MarkdownTree()
    
    results = []
    
    # Process transcript 1
    print("\n📝 Processing Transcript 1: Project Planning")
    print("-" * 60)
    print(f"Input: {transcript1.strip()}")
    agent = TreeActionDeciderWorkflow(decision_tree)
    
    # Get initial tree size
    initial_size = len(decision_tree.tree)
    
    # The new workflow applies actions immediately and returns empty list
    result1 = await agent.run(transcript1, decision_tree)
    
    # Check tree growth
    final_size = len(decision_tree.tree)
    nodes_added = final_size - initial_size
    print(f"\nResult 1: Tree grew from {initial_size} to {final_size} nodes ({nodes_added} added)")
    results.append(result1)
    
    # Process transcript 2
    print("\n📝 Processing Transcript 2: Reaching Out to Investors")
    print("-" * 60)
    print(f"Input: {transcript2.strip()}")
    
    # Get initial tree size
    initial_size = len(decision_tree.tree)
    
    result2 = await agent.run(transcript2, decision_tree)
    
    # Check tree growth
    final_size = len(decision_tree.tree)
    nodes_added = final_size - initial_size
    print(f"\nResult 2: Tree grew from {initial_size} to {final_size} nodes ({nodes_added} added)")
    results.append(result2)
    
    # Process transcript 3
    print("\n📝 Processing Transcript 3: Polishing the POC")
    print("-" * 60)
    print(f"Input: {transcript3.strip()}")
    
    # Get initial tree size
    initial_size = len(decision_tree.tree)
    
    result3 = await agent.run(transcript3, decision_tree)
    
    # Check tree growth
    final_size = len(decision_tree.tree)
    nodes_added = final_size - initial_size
    print(f"\nResult 3: Tree grew from {initial_size} to {final_size} nodes ({nodes_added} added)")
    results.append(result3)
    
    # Analyze the results
    print("\n📊 Analysis of Results")
    print("=" * 80)
    
    # The new workflow applies actions immediately, so results are empty lists
    # Instead, we track tree growth
    print(f"Final tree structure: {len(decision_tree.tree)} nodes")
    
    # Show final tree structure
    print("\n🌳 Final Tree Structure:")
    print(f"Total nodes in tree: {len(decision_tree.tree)}")
    for node_id, node in decision_tree.tree.items():
        print(f"  - {node.title}: {node.summary}")
    
    # Save results to file for further analysis (temporary)
    output_file = current_dir / "test_results.json"
    try:
        with open(output_file, "w") as f:
            json.dump({
                "final_tree_size": len(decision_tree.tree),
                "tree_structure": {
                    node_id: {
                        "name": node.title,
                        "summary": node.summary
                    }
                    for node_id, node in decision_tree.tree.items()
                }
            }, f, indent=2)

        print(f"\n💾 Results saved to: {output_file}")

        # Assert that we got meaningful results
        assert len(results) == 3, f"Expected 3 results, but got {len(results)}"
        assert len(decision_tree.tree) > 1, f"Expected tree to grow beyond root node, but it has {len(decision_tree.tree)} nodes"

    finally:
        # Clean up test output file
        if output_file.exists():
            output_file.unlink()
            print(f"🧹 Cleaned up test file: {output_file}")

@pytest.mark.asyncio
@pytest.mark.skip(reason="Test flaky due to LLM JSON parsing errors")
async def test_single_transcript():
    """Test with a single transcript for quick testing"""
    
    print("\n🧪 Quick Test with Single Transcript")
    print("=" * 80)
    
    transcript = """
    I need to work on the VoiceTree project today.
    First, I should integrate LangGraph to improve the workflow processing.
    This will help with better decision making about where to place new nodes in the tree.
    After that, I need to benchmark the performance against the current system.
    """
    
    # Create tree with some existing nodes
    decision_tree = MarkdownTree()
    # Add some existing nodes
    from backend.markdown_tree_manager.markdown_tree_ds import Node
    decision_tree.tree[1] = Node(name="VoiceTree Project", node_id=1, content="", summary="Main project for voice-to-knowledge-graph system")
    decision_tree.tree[2] = Node(name="Backend Development", node_id=2, content="", summary="Work on the backend API and processing")
    decision_tree.tree[3] = Node(name="Testing", node_id=3, content="", summary="Unit and integration tests")
    
    print(f"Input: {transcript.strip()}")
    agent = TreeActionDeciderWorkflow(decision_tree)
    
    # Get initial tree size
    initial_size = len(decision_tree.tree)
    
    result = await agent.run(transcript, decision_tree)
    
    if result is None:
        print("\nResult is None - likely due to LLM API error")
        # Still want to assert so the test fails properly
        assert result is not None, "Result should not be None (check LLM API connection)"
    
    # Check tree growth
    final_size = len(decision_tree.tree)
    nodes_added = final_size - initial_size
    print(f"\nTree grew from {initial_size} to {final_size} nodes ({nodes_added} added)")
    
    print(f"\nFinal tree has {len(decision_tree.tree)} nodes")
    
    # Assert basic structure
    assert result is not None, "Expected a result"
    assert isinstance(result, list), "Result should be a list of actions"

if __name__ == "__main__":
    # Run the complex test with multiple transcripts
    print("Running complex tree creation test...")
    asyncio.run(test_complex_tree_creation())
    
    # Run a simple single transcript test
    print("\n" + "="*80)
    asyncio.run(test_single_transcript())
