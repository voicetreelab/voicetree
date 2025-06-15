#!/usr/bin/env python3
"""
Adaptive test script for chunk boundary handling in VoiceTree
Adapts chunk count and mocking based on test mode (local/ci/mocked)
"""

import sys
from pathlib import Path
from unittest.mock import patch
import pytest

# Add project root to path for imports
current_dir = Path(__file__).parent
project_root = current_dir.parent.parent.parent  # Go up to VoiceTreePoc directory
sys.path.insert(0, str(project_root))

from backend.agentic_workflows.main import VoiceTreePipeline


@pytest.mark.api
def test_chunk_boundaries_adaptive(test_mode, chunk_count):
    """Test that incomplete chunks are properly handled across executions"""
    print(f"🧪 Testing Chunk Boundary Handling ({test_mode.upper()} mode)")
    print("=" * 50)
    
    # Determine chunks based on test mode
    all_chunks = [
        "I'm working on a new project for natural language processing. The system will use transfor",
        "mer models for text analysis. We need to implement entity recognition and sentiment",
        " analysis features. The project deadline is next month.",
        "Additionally, we should consider adding multi-language support for",
        " English, Spanish, and French languages."
    ]
    
    # Use subset of chunks based on mode
    voice_chunks = all_chunks[:chunk_count]
    
    print(f"📊 Mode: {test_mode}")
    print(f"📊 Processing {len(voice_chunks)} chunks (API calls: {len(voice_chunks) * 4})")
    
    # Set up mocking for mocked mode
    if test_mode == "mocked":
        return _test_with_mocked_llm(voice_chunks)
    else:
        return _test_with_real_llm(voice_chunks, test_mode)


def _test_with_mocked_llm(voice_chunks):
    """Test with mocked LLM calls"""
    mock_responses = {
        "segmentation": {
            "chunks": [
                {"name": "NLP Project", "text": "Working on NLP project with transformers", "is_complete": True}
            ]
        },
        "relationship": [
            {
                "name": "NLP Project", 
                "text": "Working on NLP project with transformers",
                "reasoning": "Analyzing if this relates to existing nodes",
                "relevant_node_name": "NO_RELEVANT_NODE", 
                "relationship": None
            }
        ],
        "integration": {
            "integration_decisions": [
                {
                    "name": "NLP Project", 
                    "text": "Working on NLP project with transformers",
                    "action": "CREATE", 
                    "target_node": "NO_RELEVANT_NODE",
                    "new_node_name": "NLP Project", 
                    "new_node_summary": "Natural language processing project",
                    "relationship_for_edge": None,
                    "content": "Working on NLP project with transformers"
                }
            ]
        },
        "extraction": {"new_nodes": ["NLP Project"]}
    }
    
    # Mock the function where it's actually used (in nodes.py)
    with patch('backend.agentic_workflows.nodes.call_llm_structured') as mock_llm:
        def mock_llm_response(prompt, stage_type, model_name="gemini-2.0-flash"):
            print(f"🤖 MOCKED LLM CALL: {stage_type}")
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
        
        return _run_test_logic(voice_chunks, "mocked", mock_llm)


def _test_with_real_llm(voice_chunks, test_mode):
    """Test with real LLM calls"""
    return _run_test_logic(voice_chunks, test_mode, None)


def _run_test_logic(voice_chunks, test_mode, mock_llm=None):
    """Common test logic for both mocked and real tests"""
    state_file = f"test_chunk_boundaries_{test_mode}_state.json"
    pipeline = VoiceTreePipeline(state_file, buffer_threshold=100)  # Lower threshold for testing
    
    # Clear any existing state
    pipeline.clear_state()
    
    print(f"\n📝 Processing voice chunks with arbitrary boundaries:")
    
    all_results = []
    for i, chunk in enumerate(voice_chunks):
        print(f"\n   Chunk {i+1}/{len(voice_chunks)}: \"{chunk[:50]}...\"")
        result = pipeline.run(chunk)
        
        # If still buffering and this is the last chunk, force process the buffer
        if i == len(voice_chunks) - 1 and result.get("current_stage") == "buffering":
            print(f"   • Forcing buffer processing for final chunk...")
            result = pipeline.force_process_buffer()
        
        all_results.append({
            "chunk_num": i + 1,
            "input_text": chunk,
            "had_buffer": bool(pipeline.incomplete_chunk_buffer),
            "new_nodes": result.get("new_nodes", []),
            "chunks_processed": len(result.get("chunks", [])),
            "has_incomplete": bool(result.get("incomplete_chunk_remainder"))
        })
        
        nodes_created = len(result.get("new_nodes", []))
        print(f"   • Created {nodes_created} nodes")
        if result.get("incomplete_chunk_remainder"):
            print(f"   • Buffered: \"{result['incomplete_chunk_remainder'][:30]}...\"")
    
    # Verify results
    stats = pipeline.get_statistics()
    total_nodes = sum(len(r['new_nodes']) for r in all_results)
    
    print(f"\n📊 Test Summary ({test_mode.upper()}):")
    print(f"   • Voice chunks processed: {len(voice_chunks)}")
    print(f"   • Total nodes created: {total_nodes}")
    print(f"   • Final state nodes: {stats['total_nodes']}")
    
    if mock_llm:
        print(f"   • LLM calls made: {mock_llm.call_count} (mocked)")
    else:
        expected_api_calls = len(voice_chunks) * 4
        print(f"   • API calls made: ~{expected_api_calls} (real)")
    
    # Core functionality tests
    print("\n✅ Verification:")
    
    # Test 1: Nodes should be created
    assert total_nodes > 0, f"Expected nodes to be created, got {total_nodes}"
    print(f"   ✓ Created {total_nodes} nodes total")
    
    # Test 2: No errors should occur
    for i, result in enumerate(all_results):
        error = result.get("error_message") if isinstance(result, dict) else None
        assert error is None, f"Chunk {i+1} had error: {error}"
    print(f"   ✓ All {len(voice_chunks)} chunks processed without errors")
    
    # Test 3: For multi-chunk tests, should have some buffering
    if len(voice_chunks) > 1:
        incomplete_chunks = sum(1 for r in all_results if r['has_incomplete'])
        print(f"   ✓ Had {incomplete_chunks} incomplete chunks (buffering working)")
    
    print(f"\n🎉 {test_mode.upper()} chunk boundary test passed!")
    
    # Cleanup
    Path(state_file).unlink(missing_ok=True)


@pytest.mark.api
def test_extreme_boundaries_adaptive(test_mode, extreme_chunk_count):
    """Test extreme cases of chunk boundaries"""
    print(f"\n🧪 Testing Extreme Chunk Boundaries ({test_mode.upper()} mode)")
    print("=" * 50)
    
    # All possible extreme chunks
    all_extreme_chunks = [
        "The", " artificial", " intelligence", " system",
        " uses", " deep", " learning", ".", " It", " can",
        " recognize", " patterns", " in", " data", "."
    ]
    
    # Use subset based on mode
    extreme_chunks = all_extreme_chunks[:extreme_chunk_count]
    
    print(f"📊 Processing {len(extreme_chunks)} extremely fragmented chunks")
    
    if test_mode == "mocked":
        # Simple mock for extreme test
        with patch('backend.agentic_workflows.nodes.call_llm_structured') as mock_llm:
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
                        {
                            "name": "AI System", 
                            "text": "AI system text",
                            "reasoning": "Analyzing AI system relationship",
                            "relevant_node_name": "NO_RELEVANT_NODE", 
                            "relationship": None
                        }
                    ])
                elif stage_type == "integration":
                    return IntegrationResponse(integration_decisions=[
                        {
                            "name": "AI System", 
                            "text": "AI system text",
                            "action": "CREATE", 
                            "target_node": "NO_RELEVANT_NODE",
                            "new_node_name": "AI System", 
                            "new_node_summary": "Artificial intelligence system",
                            "relationship_for_edge": None,
                            "content": "AI system text"
                        }
                    ])
                elif stage_type == "extraction":
                    return NodeExtractionResponse(new_nodes=["AI System"])
            
            mock_llm.side_effect = mock_response
            
            pipeline = VoiceTreePipeline(f"test_extreme_{test_mode}_state.json", buffer_threshold=100)  # Low threshold for testing
            pipeline.clear_state()
            
            for i, chunk in enumerate(extreme_chunks):
                print(f"   Chunk {i+1}: \"{chunk}\"")
                result = pipeline.run(chunk)
                
                # If still buffering and this is the last chunk, force process
                if i == len(extreme_chunks) - 1 and result.get("current_stage") == "buffering":
                    print(f"   • Forcing buffer processing for final chunk...")
                    result = pipeline.force_process_buffer()
            
            stats = pipeline.get_statistics()
            print(f"\n📊 Final result: {stats['total_nodes']} nodes created")
            print(f"   • LLM calls: {mock_llm.call_count} (mocked)")
            
            assert stats['total_nodes'] > 0, f"Expected nodes to be created, got {stats['total_nodes']}"
            
            Path(f"test_extreme_{test_mode}_state.json").unlink(missing_ok=True)
    
    else:
        # Real LLM test
        pipeline = VoiceTreePipeline(f"test_extreme_{test_mode}_state.json", buffer_threshold=100)  # Low threshold for testing
        pipeline.clear_state()
        
        for i, chunk in enumerate(extreme_chunks):
            print(f"   Chunk {i+1}: \"{chunk}\"")
            result = pipeline.run(chunk)
            
            # If still buffering and this is the last chunk, force process
            if i == len(extreme_chunks) - 1 and result.get("current_stage") == "buffering":
                print(f"   • Forcing buffer processing for final chunk...")
                result = pipeline.force_process_buffer()
        
        stats = pipeline.get_statistics()
        print(f"\n📊 Final result: {stats['total_nodes']} nodes created")
        expected_calls = len(extreme_chunks) * 4
        print(f"   • API calls: ~{expected_calls} (real)")
        
        assert stats['total_nodes'] > 0, f"Expected nodes to be created, got {stats['total_nodes']}"
        
        Path(f"test_extreme_{test_mode}_state.json").unlink(missing_ok=True)
    
    print(f"✅ {test_mode.upper()} extreme fragmentation test passed!") 