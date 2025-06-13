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
    
    return results

def test_single_transcript():
    """Test with a single transcript for quick testing"""
    
    print("\n🧪 Quick Test with Single Transcript")
    print("=" * 80)
    
    transcript = """
    I need to work on the VoiceTree project today.
    First, I should integrate LangGraph to improve the workflow processing.
    This will help with better decision making about where to place new nodes in the tree.
    After that, I need to benchmark the performance against the current system.
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
    
    return result

if __name__ == "__main__":
    # Run the complex test with multiple transcripts
    print("Running complex tree creation test...")
    test_complex_tree_creation()
    
    # Run a simple single transcript test
    print("\n" + "="*80)
    test_single_transcript()
