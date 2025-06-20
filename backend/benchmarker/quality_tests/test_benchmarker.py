"""
Test script to verify the benchmarker works with the workflow system
"""

import asyncio
import tempfile
import os
from pathlib import Path

from backend.tree_manager.workflow_tree_manager import WorkflowTreeManager
from backend.tree_manager.decision_tree_ds import DecisionTree


async def test_workflow_manager():
    """Test that WorkflowTreeManager processes text correctly"""
    
    print("Testing WorkflowTreeManager...")
    
    # Create a temporary workflow state file
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        state_file = tmp.name
    
    try:
        # Initialize components
        decision_tree = DecisionTree()
        tree_manager = WorkflowTreeManager(
            decision_tree=decision_tree,
            workflow_state_file=state_file
        )
        
        # Test transcripts
        test_transcripts = [
            "This is a test of the voice tree system.",
            "The system should create nodes for different concepts.",
            "Each concept becomes a node in the tree structure."
        ]
        
        # Process each transcript
        for i, transcript in enumerate(test_transcripts, 1):
            print(f"\nProcessing transcript {i}: '{transcript[:50]}...'")
            await tree_manager.process_voice_input(transcript)
        
        # Get statistics
        stats = tree_manager.get_workflow_statistics()
        print(f"\nWorkflow statistics: {stats}")
        
        # Check tree structure
        node_count = len(decision_tree.tree)
        print(f"Total nodes created: {node_count}")
        
        if node_count > 0:
            print("✅ WorkflowTreeManager is working correctly!")
            return True
        else:
            print("❌ No nodes were created")
            return False
            
    finally:
        # Clean up
        if os.path.exists(state_file):
            os.remove(state_file)


async def test_benchmarker_imports():
    """Test that the benchmarker can import the new components"""
    
    print("\nTesting benchmarker imports...")
    
    try:
        from quality_LLM_benchmarker import (
            process_transcript_with_voicetree,
            evaluate_tree_quality,
            WorkflowTreeManager
        )
        print("✅ All imports successful!")
        return True
    except ImportError as e:
        print(f"❌ Import error: {e}")
        return False


async def main():
    """Run all tests"""
    
    print("🧪 Testing VoiceTree Workflow Integration")
    print("=" * 60)
    
    # Test WorkflowTreeManager
    workflow_test = await test_workflow_manager()
    
    # Test benchmarker imports
    import_test = await test_benchmarker_imports()
    
    # Summary
    print("\n" + "=" * 60)
    print("Test Summary:")
    print(f"  WorkflowTreeManager: {'✅ PASS' if workflow_test else '❌ FAIL'}")
    print(f"  Benchmarker Imports: {'✅ PASS' if import_test else '❌ FAIL'}")
    
    if workflow_test and import_test:
        print("\n✅ All tests passed! The benchmarker should work with the new system.")
    else:
        print("\n❌ Some tests failed. Please check the errors above.")


if __name__ == "__main__":
    # Note: This test uses mock LLM responses by default
    print("⚠️  Note: This test uses mock LLM responses.")
    print("    The actual benchmarker will need proper API keys configured.")
    
    asyncio.run(main()) 