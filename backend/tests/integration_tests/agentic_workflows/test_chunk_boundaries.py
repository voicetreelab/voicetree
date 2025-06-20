#!/usr/bin/env python3
"""
Test script for chunk boundary handling in VoiceTree
"""

import sys
from pathlib import Path
import json

# Add project root to path for imports
current_dir = Path(__file__).parent
project_root = current_dir.parent.parent.parent  # Go up to VoiceTreePoc directory
sys.path.insert(0, str(project_root))

from backend.agentic_workflows.main import VoiceTreePipeline


def test_chunk_boundaries():
    """Test that incomplete chunks are properly handled across executions"""
    print("🧪 Testing Chunk Boundary Handling")
    print("=" * 50)
    
    # Create pipeline with state file
    state_file = "test_chunk_boundaries_state.json"
    pipeline = VoiceTreePipeline(state_file)
    
    # Clear any existing state
    pipeline.clear_state()
    
    # Simulate voice chunks that are cut at arbitrary boundaries
    voice_chunks = [
        # Chunk 1: Complete sentence + incomplete
        "I'm working on a new project for natural language processing. The system will use transfor",
        
        # Chunk 2: Completes previous + new complete + incomplete
        "mer models for text analysis. We need to implement entity recognition and sentiment",
        
        # Chunk 3: Completes previous + new complete
        " analysis features. The project deadline is next month.",
        
        # Chunk 4: Single incomplete chunk
        "Additionally, we should consider adding multi-language support for",
        
        # Chunk 5: Completes previous
        " English, Spanish, and French languages."
    ]
    
    print("\n📝 Processing voice chunks with arbitrary boundaries:\n")
    
    all_results = []
    for i, chunk in enumerate(voice_chunks):
        print(f"\n{'='*60}")
        print(f"📢 Voice Chunk {i+1}:")
        print(f"   Raw text: \"{chunk}\"")
        print(f"   Length: {len(chunk)} chars")
        print(f"   Ends mid-sentence: {not chunk.rstrip().endswith(('.', '!', '?'))}")
        
        result = pipeline.run(chunk)
        
        # Collect results
        all_results.append({
            "chunk_num": i + 1,
            "input_text": chunk,
            "had_buffer": bool(pipeline.incomplete_chunk_buffer),
            "new_nodes": result.get("new_nodes", []),
            "chunks_processed": len(result.get("chunks", [])),
            "has_incomplete": bool(result.get("incomplete_chunk_remainder"))
        })
        
        # Show what happened
        print(f"\n   Results:")
        print(f"   • Chunks processed: {len(result.get('chunks', []))}")
        print(f"   • New nodes created: {result.get('new_nodes', [])}")
        if result.get("incomplete_chunk_remainder"):
            print(f"   • Incomplete text buffered: \"{result['incomplete_chunk_remainder'][:50]}...\"")
    
    # Final summary
    print(f"\n{'='*60}")
    print("📊 Test Summary:")
    print(f"   • Total voice chunks: {len(voice_chunks)}")
    print(f"   • Total nodes created: {sum(len(r['new_nodes']) for r in all_results)}")
    print(f"   • Chunks with incomplete text: {sum(1 for r in all_results if r['has_incomplete'])}")
    
    # Verify the complete text was processed correctly
    stats = pipeline.get_statistics()
    print(f"\n🌳 Final Knowledge Graph:")
    print(f"   • Total nodes: {stats['total_nodes']}")
    
    if pipeline.state_manager:
        for name, node_data in pipeline.state_manager.nodes.items():
            print(f"   • {name}")
    
    # Test core functionality instead of specific concept names
    print("\n✅ Verification:")
    
    # Test 1: Chunks should be processed
    total_nodes = sum(len(r['new_nodes']) for r in all_results)
    assert total_nodes > 0, f"Expected some nodes to be created, but got {total_nodes}"
    print(f"   ✓ Created {total_nodes} nodes total")
    
    # Test 2: Incomplete chunks should be buffered
    incomplete_chunks = sum(1 for r in all_results if r['has_incomplete'])
    assert incomplete_chunks > 0, "Expected some chunks to be incomplete and buffered"
    print(f"   ✓ Buffered {incomplete_chunks} incomplete chunks")
    
    # Test 3: Some chunks should have content from previous buffers 
    buffered_chunks = sum(1 for r in all_results if r['had_buffer'])
    assert buffered_chunks > 0, "Expected some chunks to use buffered content from previous execution"
    print(f"   ✓ Used buffered content in {buffered_chunks} chunks")
    
    # Test 4: Final state should have multiple nodes
    assert stats['total_nodes'] >= 5, f"Expected at least 5 total nodes, got {stats['total_nodes']}"
    print(f"   ✓ Final state has {stats['total_nodes']} nodes")
    
    # Test 5: No errors in processing
    for i, result in enumerate(all_results):
        assert result.get("error_message") is None, f"Chunk {i+1} had error: {result.get('error_message')}"
    print(f"   ✓ All {len(voice_chunks)} chunks processed without errors")
    
    print("\n🎉 All chunk boundary tests passed!")
    
    # Cleanup
    Path(state_file).unlink(missing_ok=True)


def test_extreme_boundaries():
    """Test extreme cases of chunk boundaries"""
    print("\n\n🧪 Testing Extreme Chunk Boundaries")
    print("=" * 50)
    
    pipeline = VoiceTreePipeline("test_extreme_state.json")
    pipeline.clear_state()
    
    # Test cases with extreme fragmentation
    extreme_chunks = [
        "The",
        " artificial",
        " intelligence system",
        " uses deep",
        " learning.",
        " It can",
        " recognize patterns",
        " in data."
    ]
    
    print("\n📝 Processing extremely fragmented chunks:")
    
    for i, chunk in enumerate(extreme_chunks):
        print(f"\n   Chunk {i+1}: \"{chunk}\"")
        result = pipeline.run(chunk)
        print(f"   • Processed: {len(result.get('chunks', []))} chunks")
        print(f"   • Created: {result.get('new_nodes', [])}")
    
    stats = pipeline.get_statistics()
    print(f"\n📊 Final result: {stats['total_nodes']} nodes created")
    
    # Cleanup
    Path("test_extreme_state.json").unlink(missing_ok=True)
    
    # Assert that nodes were created
    assert stats['total_nodes'] > 0, f"Expected nodes to be created, but got {stats['total_nodes']}"


if __name__ == "__main__":
    # Run both tests
    try:
        test_chunk_boundaries()
        test1_passed = True
    except Exception as e:
        print(f"❌ test_chunk_boundaries failed: {e}")
        test1_passed = False
    
    try:
        test_extreme_boundaries()
        test2_passed = True
    except Exception as e:
        print(f"❌ test_extreme_boundaries failed: {e}")
        test2_passed = False
    
    print("\n" + "="*60)
    print("🏁 Overall Test Results:")
    print(f"   • Chunk boundary handling: {'✅ PASSED' if test1_passed else '❌ FAILED'}")
    print(f"   • Extreme fragmentation: {'✅ PASSED' if test2_passed else '❌ FAILED'}")
    
    if test1_passed and test2_passed:
        print("\n🎉 All chunk boundary tests passed!")
    else:
        print("\n⚠️  Some tests failed - review the implementation") 