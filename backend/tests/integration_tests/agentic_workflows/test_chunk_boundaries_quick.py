#!/usr/bin/env python3
"""
Quick test script for chunk boundary handling in VoiceTree (fewer chunks for speed)
"""

import sys
from pathlib import Path

# Add project root to path for imports
current_dir = Path(__file__).parent
project_root = current_dir.parent.parent.parent  # Go up to VoiceTreePoc directory
sys.path.insert(0, str(project_root))

from backend.agentic_workflows.main import VoiceTreePipeline


def test_chunk_boundaries_quick():
    """Test chunk boundaries with fewer chunks for speed"""
    print("🧪 Testing Chunk Boundary Handling (Quick - Real LLM)")
    print("=" * 50)
    
    # Create pipeline with state file (using default buffer threshold)
    state_file = "test_chunk_boundaries_quick_state.json"
    pipeline = VoiceTreePipeline(state_file)
    
    # Clear any existing state
    pipeline.clear_state()
    
    # Longer, more realistic voice chunks that exceed the 500-character buffer threshold
    voice_chunks = [
        "I'm working on a new project for natural language processing and machine learning applications. The system will use transformer models for advanced text analysis and understanding. We need to implement entity recognition, sentiment analysis, and semantic search capabilities. The architecture should be scalable and robust to handle large volumes of text data efficiently.",
        "Additionally, we need to implement comprehensive testing frameworks and quality assurance processes. The user interface should be intuitive and responsive, providing real-time feedback to users. Documentation and training materials will be essential for successful adoption. We should also consider integration with existing enterprise systems and APIs."
    ]
    
    print(f"\n📝 Processing {len(voice_chunks)} voice chunks:")
    
    all_results = []
    for i, chunk in enumerate(voice_chunks):
        print(f"\n   Chunk {i+1}: \"{chunk[:50]}...\"")
        result = pipeline.run(chunk)
        all_results.append(result)
        
        # Show basic results
        nodes_created = len(result.get("new_nodes", []))
        print(f"   • Created {nodes_created} nodes")
    
    # Process any remaining buffer
    final_result = pipeline.force_process_buffer()
    if final_result.get("new_nodes"):
        all_results.append(final_result)
    
    # Basic verification
    total_nodes = sum(len(r.get('new_nodes', [])) for r in all_results)
    print(f"\n✅ Quick test completed:")
    print(f"   • Total nodes created: {total_nodes}")
    print(f"   • Chunks processed: {len(voice_chunks)}")
    
    # Test that some nodes were created
    assert total_nodes > 0, f"Expected nodes to be created, got {total_nodes}"
    
    # Test that no errors occurred
    for i, result in enumerate(all_results):
        assert result.get("error_message") is None, f"Chunk {i+1} had error: {result.get('error_message')}"
    
    print("   • All chunks processed successfully! ✓")
    
    # Cleanup
    Path(state_file).unlink(missing_ok=True)


if __name__ == "__main__":
    import time
    
    start_time = time.time()
    
    try:
        test_chunk_boundaries_quick()
        print("\n🎉 Quick test passed!")
    except Exception as e:
        print(f"\n❌ Quick test failed: {e}")
    
    end_time = time.time()
    print(f"\n⏱️ Total time: {end_time - start_time:.1f} seconds") 