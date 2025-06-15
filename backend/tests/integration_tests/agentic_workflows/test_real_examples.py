#!/usr/bin/env python3
"""
Test the VoiceTree LangGraph pipeline with real examples from the integration tests
"""

import sys
import os
from pathlib import Path
import json

# Add project root to path for imports
current_dir = Path(__file__).parent
project_root = current_dir.parent.parent.parent  # Go up to VoiceTreePoc directory
sys.path.insert(0, str(project_root))

# Import the main module from the backend
from backend.agentic_workflows.main import run_voicetree_pipeline, print_detailed_results

def test_complex_tree_creation():
    """Test with the same examples used in the integration tests"""
    
    print("🧪 Testing VoiceTree LangGraph Pipeline with Real Integration Test Examples")
    print("=" * 80)
    
    # Longer, more realistic transcripts that exceed the 500-character buffer threshold
    transcript1 = """
    This is a comprehensive test of the VoiceTree application and its capabilities.
    I want to create a new node about project planning and management strategies. 
    The first step is to define the project scope clearly, including all deliverables and timelines.
    The next step is to identify the key stakeholders, their roles, and responsibilities.
    We also need to establish communication channels and regular check-in meetings.
    Risk assessment and mitigation strategies should be developed early in the process.
    Finally, we need to set up proper documentation and version control systems.
    """

    transcript2 = (
        "Another important thing I will have to do is start reaching out to potential investors "
        "to see what next steps they would recommend for me and my startup. "
        "I should talk to Austin's dad first since he has experience in this industry. "
        "I also need to prepare a comprehensive business plan with financial projections. "
        "Market research and competitive analysis will be crucial for these conversations. "
        "I should also prepare a demo of the current product to show its capabilities. "
        "Building relationships with investors takes time, so I need to start early."
    )

    transcript3 = (
        "To be able to start reaching out to investors effectively, I will first have to polish my POC significantly. "
        "This involves refining the user interface to make it more intuitive and professional. "
        "I need to improve the summarization quality and accuracy of the AI models. "
        "Making sure the application is robust and easy to use is absolutely critical. "
        "I'll also need to prepare a compelling pitch deck and presentation materials. "
        "Performance optimization and scalability testing should be completed. "
        "User feedback collection and iteration based on that feedback is important. "
        "Documentation for both users and developers needs to be comprehensive and clear."
    )
    
    # Start with empty tree (just root node)
    existing_nodes = """
    Current tree nodes:
    - Root: Today's thoughts and tasks
    """
    
    results = []
    
    # Process transcript 1
    print("\n📝 Processing Transcript 1: Project Planning")
    print("-" * 60)
    print(f"Input: {transcript1.strip()}")
    result1 = run_voicetree_pipeline(transcript1, existing_nodes)
    print_detailed_results(result1)
    results.append(result1)
    
    # Update existing nodes based on result1
    if result1.get("new_nodes"):
        existing_nodes += "\n".join([f"    - {node}" for node in result1["new_nodes"]])
    
    # Process transcript 2
    print("\n📝 Processing Transcript 2: Reaching Out to Investors")
    print("-" * 60)
    print(f"Input: {transcript2.strip()}")
    result2 = run_voicetree_pipeline(transcript2, existing_nodes)
    print_detailed_results(result2)
    results.append(result2)
    
    # Update existing nodes based on result2
    if result2.get("new_nodes"):
        existing_nodes += "\n".join([f"    - {node}" for node in result2["new_nodes"]])
    
    # Process transcript 3
    print("\n📝 Processing Transcript 3: Polishing the POC")
    print("-" * 60)
    print(f"Input: {transcript3.strip()}")
    result3 = run_voicetree_pipeline(transcript3, existing_nodes)
    print_detailed_results(result3)
    results.append(result3)
    
    # Analyze the results
    print("\n📊 Analysis of Results")
    print("=" * 80)
    
    # Count total nodes created
    total_new_nodes = sum(len(r.get("new_nodes", [])) for r in results)
    print(f"Total new nodes created: {total_new_nodes}")
    
    # Check for APPEND vs CREATE decisions
    append_count = 0
    create_count = 0
    for r in results:
        if r.get("integration_decisions"):
            for decision in r["integration_decisions"]:
                if isinstance(decision, dict):
                    if decision.get("decision") == "APPEND":
                        append_count += 1
                    elif decision.get("decision") == "CREATE":
                        create_count += 1
    
    print(f"APPEND decisions: {append_count}")
    print(f"CREATE decisions: {create_count}")
    
    # Show final tree structure
    print("\n🌳 Final Tree Structure:")
    print(existing_nodes)
    
    # Save results to file for further analysis
    output_file = current_dir / "test_results.json"
    with open(output_file, "w") as f:
        json.dump({
            "results": results,
            "final_tree": existing_nodes,
            "statistics": {
                "total_new_nodes": total_new_nodes,
                "append_decisions": append_count,
                "create_decisions": create_count
            }
        }, f, indent=2)
    
    print(f"\n💾 Results saved to: {output_file}")
    
    # Assert that we got meaningful results
    assert total_new_nodes > 0, f"Expected to create new nodes, but got {total_new_nodes}"
    assert len(results) == 3, f"Expected 3 results, but got {len(results)}"
    
    # Assert that each transcript produced some output
    for i, result in enumerate(results):
        assert result is not None, f"Result {i+1} is None"
        assert "chunks" in result, f"Result {i+1} missing 'chunks' field"

def test_single_transcript():
    """Test with a single transcript for quick testing"""
    
    print("\n🧪 Quick Test with Single Transcript")
    print("=" * 80)
    
    transcript = """
    I need to work on the VoiceTree project today and make significant progress on several fronts.
    First, I should integrate LangGraph to improve the workflow processing and make it more robust.
    This will help with better decision making about where to place new nodes in the tree structure.
    After that, I need to benchmark the performance against the current system to measure improvements.
    I also need to write comprehensive tests to ensure the new functionality works correctly.
    Documentation updates will be necessary to reflect the new architecture and capabilities.
    User interface improvements should be considered to make the system more intuitive.
    Finally, I should prepare for the next phase of development and plan future features.
    """
    
    existing_nodes = """
    Current tree nodes:
    - VoiceTree Project: Main project for voice-to-knowledge-graph system
    - Backend Development: Work on the backend API and processing
    - Testing: Unit and integration tests
    """
    
    print(f"Input: {transcript.strip()}")
    result = run_voicetree_pipeline(transcript, existing_nodes)
    print_detailed_results(result)
    
    # Assert that we got a valid result
    assert result is not None, "Result should not be None"
    assert "chunks" in result, "Result should contain 'chunks' field"
    assert len(result.get("chunks", [])) > 0, "Should have processed at least one chunk"

if __name__ == "__main__":
    # Run the complex test with multiple transcripts
    print("Running complex tree creation test...")
    test_complex_tree_creation()
    
    # Run a simple single transcript test
    print("\n" + "="*80)
    test_single_transcript()
