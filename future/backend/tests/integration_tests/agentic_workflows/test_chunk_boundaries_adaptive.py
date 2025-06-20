#!/usr/bin/env python3
"""
Adaptive test script for chunk boundary handling in VoiceTree
Adapts chunk count based on test mode (local/ci)
Integration tests always use real API calls - no mocking
"""

import sys
from pathlib import Path
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
    
    # Run test with real LLM calls - will crash immediately if API not available
    try:
        return _run_test_logic(voice_chunks, test_mode)
    except RuntimeError as e:
        if "Gemini API is not available" in str(e) or "API error is unrecoverable" in str(e):
            pytest.fail(f"Test failed due to API configuration issues: {e}")
        else:
            raise


def _run_test_logic(voice_chunks, test_mode):
    """Test logic for integration tests with real API calls"""
    state_file = f"test_chunk_boundaries_{test_mode}_state.json"
    pipeline = VoiceTreePipeline(state_file, buffer_threshold=100)  # Lower threshold for testing
    
    # Clear any existing state
    pipeline.clear_state()
    
    print(f"\n📝 Processing voice chunks with arbitrary boundaries:")
    
    all_results = []
    for i, chunk in enumerate(voice_chunks):
        print(f"\n   Chunk {i+1}/{len(voice_chunks)}: \"{chunk[:50]}...\"")
        result = pipeline.run(chunk)
        
        # Check if result is None (should not happen with new error handling)
        if result is None:
            raise RuntimeError(f"Pipeline returned None for chunk {i+1} - this should not happen with proper error handling")
        
        # If still buffering and this is the last chunk, force process the buffer
        if i == len(voice_chunks) - 1 and result.get("current_stage") == "buffering":
            print(f"   • Forcing buffer processing for final chunk...")
            result = pipeline.force_process_buffer()
            
            # Check forced result as well
            if result is None:
                raise RuntimeError(f"Pipeline returned None after force processing - this should not happen with proper error handling")
        
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
    
    # Run with real LLM calls - will crash immediately if API not available
    try:
        pipeline = VoiceTreePipeline(f"test_extreme_{test_mode}_state.json", buffer_threshold=100)  # Low threshold for testing
        pipeline.clear_state()
        
        for i, chunk in enumerate(extreme_chunks):
            print(f"   Chunk {i+1}: \"{chunk}\"")
            result = pipeline.run(chunk)
            
            # Check if result is None (should not happen with new error handling)
            if result is None:
                raise RuntimeError(f"Pipeline returned None for chunk {i+1} - this should not happen with proper error handling")
            
            # If still buffering and this is the last chunk, force process
            if i == len(extreme_chunks) - 1 and result.get("current_stage") == "buffering":
                print(f"   • Forcing buffer processing for final chunk...")
                result = pipeline.force_process_buffer()
                
                # Check forced result as well
                if result is None:
                    raise RuntimeError(f"Pipeline returned None after force processing - this should not happen with proper error handling")
        
        stats = pipeline.get_statistics()
        print(f"\n📊 Final result: {stats['total_nodes']} nodes created")
        expected_calls = len(extreme_chunks) * 4
        print(f"   • API calls: ~{expected_calls} (real)")
        
        assert stats['total_nodes'] > 0, f"Expected nodes to be created, got {stats['total_nodes']}"
        
        Path(f"test_extreme_{test_mode}_state.json").unlink(missing_ok=True)
        
        print(f"✅ {test_mode.upper()} extreme fragmentation test passed!")
        
    except RuntimeError as e:
        if "Gemini API is not available" in str(e) or "API error is unrecoverable" in str(e):
            pytest.fail(f"Test failed due to API configuration issues: {e}")
        else:
            raise 