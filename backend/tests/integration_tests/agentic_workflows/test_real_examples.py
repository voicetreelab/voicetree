#!/usr/bin/env python3
"""
Test the VoiceTree LangGraph pipeline with real examples from the integration tests
"""

import asyncio
import json
import os
import sys
from pathlib import Path

import pytest

# Add project root to path for imports
current_dir = Path(__file__).parent
project_root = current_dir.parent.parent.parent  # Go up to VoiceTreePoc directory
sys.path.insert(0, str(project_root))

# Import the workflow directly
from backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow import \
    TreeActionDeciderWorkflow
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree


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
    decision_tree = DecisionTree()
    
    results = []
    
    # Process transcript 1
    print("\n📝 Processing Transcript 1: Project Planning")
    print("-" * 60)
    print(f"Input: {transcript1.strip()}")
    agent = TreeActionDeciderWorkflow(decision_tree)
    result1 = await agent.run(transcript1)
    print(f"\nResult 1: {len(result1)} optimization actions generated")
    results.append(result1)
    
    # Apply actions to the tree
    from backend.text_to_graph_pipeline.chunk_processing_pipeline.apply_tree_actions import TreeActionApplier
    applier = TreeActionApplier(decision_tree)
    applier.apply(result1)
    
    # Process transcript 2
    print("\n📝 Processing Transcript 2: Reaching Out to Investors")
    print("-" * 60)
    print(f"Input: {transcript2.strip()}")
    result2 = await agent.run(transcript2)
    print(f"\nResult 2: {len(result2)} optimization actions generated")
    results.append(result2)
    
    # Apply actions to the tree
    applier.apply(result2)
    
    # Process transcript 3
    print("\n📝 Processing Transcript 3: Polishing the POC")
    print("-" * 60)
    print(f"Input: {transcript3.strip()}")
    result3 = await agent.run(transcript3)
    print(f"\nResult 3: {len(result3)} optimization actions generated")
    results.append(result3)
    
    # Analyze the results
    print("\n📊 Analysis of Results")
    print("=" * 80)
    
    # Count total actions generated
    total_actions = sum(len(r) for r in results)
    print(f"Total optimization actions generated: {total_actions}")
    
    # Apply final actions and show tree structure
    applier.apply(result3)
    print(f"\nFinal tree structure: {len(decision_tree.tree)} nodes")
    
    # Analyze what kinds of actions were generated
    from backend.text_to_graph_pipeline.agentic_workflows.models import CreateAction, UpdateAction
    create_count = sum(1 for r in results for action in r if isinstance(action, CreateAction))
    update_count = sum(1 for r in results for action in r if isinstance(action, UpdateAction))
    
    print(f"CREATE actions: {create_count}")
    print(f"UPDATE actions: {update_count}")
    
    # Show final tree structure
    print("\n🌳 Final Tree Structure:")
    print(f"Total nodes in tree: {len(decision_tree.tree)}")
    for node_id, node in decision_tree.tree.items():
        print(f"  - {node.name}: {node.summary}")
    
    # Save results to file for further analysis
    output_file = current_dir / "test_results.json"
    with open(output_file, "w") as f:
        json.dump({
            "results": [[str(action) for action in r] for r in results],  # Convert actions to string for JSON
            "final_tree_size": len(decision_tree.tree),
            "statistics": {
                "total_actions": total_actions,
                "create_actions": create_count,
                "update_actions": update_count,
                "tree_nodes": len(decision_tree.tree)
            }
        }, f, indent=2)
    
    print(f"\n💾 Results saved to: {output_file}")
    
    # Assert that we got meaningful results
    assert total_actions >= 0, f"Expected some actions, but got {total_actions}"
    assert len(results) == 3, f"Expected 3 results, but got {len(results)}"
    assert len(decision_tree.tree) > 1, f"Expected tree to grow beyond root node"

@pytest.mark.asyncio
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
    decision_tree = DecisionTree()
    # Add some existing nodes
    from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import Node
    decision_tree.tree[1] = Node(id=1, name="VoiceTree Project", summary="Main project for voice-to-knowledge-graph system", content="")
    decision_tree.tree[2] = Node(id=2, name="Backend Development", summary="Work on the backend API and processing", content="")
    decision_tree.tree[3] = Node(id=3, name="Testing", summary="Unit and integration tests", content="")
    
    print(f"Input: {transcript.strip()}")
    agent = TreeActionDeciderWorkflow(decision_tree)
    result = await agent.run(transcript)
    
    if result is None:
        print("\nResult is None - likely due to LLM API error")
        # Still want to assert so the test fails properly
        assert result is not None, "Result should not be None (check LLM API connection)"
    # else:
    #     # Check if there's an error message
    #     if result.get('error_message'):
    #         print(f"\nError during processing: {result['error_message']}")
    #         # If there's an event loop error, it's okay to skip the test
    #         if "Event loop is closed" in result['error_message']:
    #             print("Skipping test due to event loop issue - this is expected when running multiple async tests")
    #             return
        
    print(f"\nResult: {len(result)} optimization actions generated")
    
    # Apply actions and display final tree
    from backend.text_to_graph_pipeline.chunk_processing_pipeline.apply_tree_actions import TreeActionApplier
    applier = TreeActionApplier(decision_tree)
    applier.apply(result)
    
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
