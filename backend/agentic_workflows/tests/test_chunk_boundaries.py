#!/usr/bin/env python3
"""
Test script for chunk boundary handling in VoiceTree
"""

import sys
from pathlib import Path
import json

# Add parent directory to path for imports
sys.path.append(str(Path(__file__).parent.parent.parent))

from main import VoiceTreePipeline


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
    
    # Test specific expectations
    print("\n✅ Verification:")
    
    # Should have created nodes for main concepts
    expected_concepts = ["natural language processing", "transformer", "entity recognition", 
                        "sentiment analysis", "multi-language support"]
    
    node_names_lower = [name.lower() for name in pipeline.state_manager.nodes.keys()] if pipeline.state_manager else []
    found_concepts = []
    
    for concept in expected_concepts:
        found = any(concept in node_name for node_name in node_names_lower)
        found_concepts.append(found)
        status = "✓" if found else "✗"
        print(f"   {status} Found concept: {concept}")
    
    # Overall test result
    if all(found_concepts):
        print("\n🎉 All expected concepts were extracted despite chunk boundaries!")
    else:
        print("\n⚠️  Some concepts were missed - chunk handling may need improvement")
    
    # Cleanup
    Path(state_file).unlink(missing_ok=True)
    
    return all(found_concepts)


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
    
    return stats['total_nodes'] > 0


if __name__ == "__main__":
    # Run both tests
    test1_passed = test_chunk_boundaries()
    test2_passed = test_extreme_boundaries()
    
    print("\n" + "="*60)
    print("🏁 Overall Test Results:")
    print(f"   • Chunk boundary handling: {'✅ PASSED' if test1_passed else '❌ FAILED'}")
    print(f"   • Extreme fragmentation: {'✅ PASSED' if test2_passed else '❌ FAILED'}")
    
    if test1_passed and test2_passed:
        print("\n🎉 All chunk boundary tests passed!")
    else:
        print("\n⚠️  Some tests failed - review the implementation") 