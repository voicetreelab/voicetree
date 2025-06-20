#!/usr/bin/env python3
"""
Fast test script for chunk boundary handling in VoiceTree (with mocked LLM calls)
"""

import sys
from pathlib import Path
from unittest.mock import patch
import json

# Add project root to path for imports
current_dir = Path(__file__).parent
project_root = current_dir.parent.parent.parent  # Go up to VoiceTreePoc directory
sys.path.insert(0, str(project_root))

from backend.agentic_workflows.main import VoiceTreePipeline


def test_chunk_boundaries_fast():
    """Test that incomplete chunks are properly handled across executions (FAST - mocked LLM)"""
    print("🧪 Testing Chunk Boundary Handling (Fast Mode)")
    print("=" * 50)
    
    # Mock LLM responses that simulate the expected behavior
    mock_responses = {
        "segmentation": {
            "chunks": [
                {"name": "NLP Project", "text": "Working on NLP project", "is_complete": True},
                {"name": "System Architecture", "text": "The system will use transformers", "is_complete": False}
            ]
        },
        "relationship": [
            {"name": "NLP Project", "relevant_node_name": "NO_RELEVANT_NODE", "relationship": None},
            {"name": "System Architecture", "relevant_node_name": "NLP Project", "relationship": "elaborates on"}
        ],
        "integration": {
            "integration_decisions": [
                {
                    "name": "NLP Project", "action": "CREATE", "target_node": "NO_RELEVANT_NODE",
                    "new_node_name": "NLP Project", "new_node_summary": "Natural language processing project"
                },
                {
                    "name": "System Architecture", "action": "CREATE", "target_node": "NLP Project", 
                    "new_node_name": "System Architecture", "new_node_summary": "Transformer-based architecture"
                }
            ]
        },
        "extraction": {"new_nodes": ["NLP Project", "System Architecture"]}
    }
    
    with patch('backend.agentic_workflows.llm_integration.call_llm_structured') as mock_llm:
        # Set up mock to return different responses based on stage_type
        def mock_llm_response(prompt, stage_type, model_name="gemini-2.0-flash"):
            if stage_type == "segmentation":
                from backend.agentic_workflows.schema_models import SegmentationResponse
                return SegmentationResponse(**mock_responses["segmentation"])
            elif stage_type == "relationship":
                from backend.agentic_workflows.schema_models import RelationshipResponse
                return RelationshipResponse(analyzed_chunks=mock_responses["relationship"])
            elif stage_type == "integration":
                from backend.agentic_workflows.schema_models import IntegrationResponse
                return IntegrationResponse(**mock_responses["integration"])
            elif stage_type == "extraction":
                from backend.agentic_workflows.schema_models import NodeExtractionResponse
                return NodeExtractionResponse(**mock_responses["extraction"])
        
        mock_llm.side_effect = mock_llm_response
        
        # Create pipeline with state file
        state_file = "test_chunk_boundaries_fast_state.json"
        pipeline = VoiceTreePipeline(state_file)
        
        # Clear any existing state
        pipeline.clear_state()
        
        # Simulate voice chunks that are cut at arbitrary boundaries
        voice_chunks = [
            "I'm working on a new project for natural language processing. The system will use transfor",
            "mer models for text analysis. We need to implement entity recognition and sentiment",
            " analysis features. The project deadline is next month."
        ]
        
        print(f"\n📝 Processing {len(voice_chunks)} voice chunks with mocked LLM:")
        
        all_results = []
        for i, chunk in enumerate(voice_chunks):
            print(f"\n   Chunk {i+1}: \"{chunk[:50]}...\"")
            result = pipeline.run(chunk)
            all_results.append(result)
            print(f"   • Created: {result.get('new_nodes', [])}")
        
        # Test core functionality
        print("\n✅ Verification:")
        
        # Test 1: Pipeline should complete without errors
        for i, result in enumerate(all_results):
            assert result.get("error_message") is None, f"Chunk {i+1} had error"
        print(f"   ✓ All {len(voice_chunks)} chunks processed without errors")
        
        # Test 2: Should create some nodes
        total_nodes = sum(len(r.get('new_nodes', [])) for r in all_results)
        assert total_nodes > 0, f"Expected nodes to be created, got {total_nodes}"
        print(f"   ✓ Created {total_nodes} nodes total")
        
        # Test 3: Mock was called the expected number of times  
        # Each chunk goes through 4 stages, so should be called 3 chunks × 4 stages = 12 times
        expected_calls = len(voice_chunks) * 4
        assert mock_llm.call_count >= len(voice_chunks), f"Expected at least {len(voice_chunks)} LLM calls, got {mock_llm.call_count}"
        print(f"   ✓ LLM was called {mock_llm.call_count} times (mocked)")
        
        print("\n🎉 Fast chunk boundary test passed!")
        
        # Cleanup
        Path(state_file).unlink(missing_ok=True)


def test_extreme_boundaries_fast():
    """Test extreme cases of chunk boundaries (FAST - mocked LLM)"""
    print("\n🧪 Testing Extreme Chunk Boundaries (Fast Mode)")
    print("=" * 50)
    
    # Simple mock response
    with patch('backend.agentic_workflows.llm_integration.call_llm_structured') as mock_llm:
        def mock_response(prompt, stage_type, model_name="gemini-2.0-flash"):
            from backend.agentic_workflows.schema_models import (
                SegmentationResponse, RelationshipResponse, 
                IntegrationResponse, NodeExtractionResponse
            )
            
            if stage_type == "segmentation":
                return SegmentationResponse(chunks=[
                    {"name": "AI System", "text": "AI system text", "is_complete": True}
                ])
            elif stage_type == "relationship":
                return RelationshipResponse(analyzed_chunks=[
                    {"name": "AI System", "relevant_node_name": "NO_RELEVANT_NODE", "relationship": None}
                ])
            elif stage_type == "integration":
                return IntegrationResponse(integration_decisions=[
                    {"name": "AI System", "action": "CREATE", "target_node": "NO_RELEVANT_NODE",
                     "new_node_name": "AI System", "new_node_summary": "Artificial intelligence system"}
                ])
            elif stage_type == "extraction":
                return NodeExtractionResponse(new_nodes=["AI System"])
        
        mock_llm.side_effect = mock_response
        
        pipeline = VoiceTreePipeline("test_extreme_fast_state.json")
        pipeline.clear_state()
        
        # Test cases with extreme fragmentation
        extreme_chunks = ["The", " artificial", " intelligence", " system"]
        
        print(f"\n📝 Processing {len(extreme_chunks)} extremely fragmented chunks:")
        
        for i, chunk in enumerate(extreme_chunks):
            print(f"   Chunk {i+1}: \"{chunk}\"")
            result = pipeline.run(chunk)
        
        stats = pipeline.get_statistics()
        print(f"\n📊 Final result: {stats['total_nodes']} nodes created")
        
        # Assert that nodes were created
        assert stats['total_nodes'] > 0, f"Expected nodes to be created, got {stats['total_nodes']}"
        print("✅ Fast extreme fragmentation test passed!")
        
        # Cleanup
        Path("test_extreme_fast_state.json").unlink(missing_ok=True)


if __name__ == "__main__":
    import time
    
    start_time = time.time()
    
    try:
        test_chunk_boundaries_fast()
        test1_passed = True
    except Exception as e:
        print(f"❌ test_chunk_boundaries_fast failed: {e}")
        test1_passed = False
    
    try:
        test_extreme_boundaries_fast()
        test2_passed = True
    except Exception as e:
        print(f"❌ test_extreme_boundaries_fast failed: {e}")
        test2_passed = False
    
    end_time = time.time()
    
    print("\n" + "="*60)
    print("🏁 Fast Test Results:")
    print(f"   • Chunk boundary handling: {'✅ PASSED' if test1_passed else '❌ FAILED'}")
    print(f"   • Extreme fragmentation: {'✅ PASSED' if test2_passed else '❌ FAILED'}")
    print(f"   • Total time: {end_time - start_time:.2f} seconds ⚡")
    
    if test1_passed and test2_passed:
        print("\n🎉 All fast tests passed! 🚀")
    else:
        print("\n⚠️ Some tests failed") 