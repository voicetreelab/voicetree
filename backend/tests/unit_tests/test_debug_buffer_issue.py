"""
Debug test to understand buffer issue
"""

import asyncio
import pytest
from backend.text_to_graph_pipeline.text_buffer_manager import TextBufferManager, BufferConfig


class TestDebugBufferIssue:
    """Debug test to understand the buffer issue"""
    
    def test_buffer_state_tracking(self):
        """Track buffer state through processing"""
        config = BufferConfig(buffer_size_threshold=83)
        manager = TextBufferManager(config=config)
        
        # Test transcript
        test_words = """So, today I'm starting work on voice tree. Right now, there's a few different 
        things I want to look into. So I'm going to try to come up with the overall plan for voice tree.""".split()
        
        print(f"\nProcessing {len(test_words)} words")
        print("=" * 60)
        
        processed_chunks = []
        
        for i, word in enumerate(test_words):
            print(f"\nWord {i}: '{word}'")
            result = manager.add_text(word + " ")
            
            print(f"  Buffer size: {len(manager._text_buffer)}")
            print(f"  History size: {len(manager.get_transcript_history())}")
            print(f"  Ready: {result.is_ready}")
            
            if result.is_ready:
                print(f"  >>> PROCESSING: '{result.text[:50]}...'")
                processed_chunks.append(result.text)
                
        
        print(f"\n{'=' * 60}")
        print(f"Total words: {len(test_words)}")
        print(f"Processed chunks: {len(processed_chunks)}")
        print(f"Words in final buffer: {len(manager._text_buffer.split())}")
        print(f"Words in history: {len(manager.get_transcript_history().split())}")
        
        # Print chunks
        print(f"\nProcessed chunks:")
        for i, chunk in enumerate(processed_chunks):
            words_in_chunk = len(chunk.split())
            print(f"  Chunk {i}: {words_in_chunk} words - '{chunk[:50]}...'")
        
        # Total words processed
        total_processed = sum(len(chunk.split()) for chunk in processed_chunks)
        words_in_buffer = len(manager._text_buffer.split())
        total_accounted = total_processed + words_in_buffer
        
        print(f"\nAccounting:")
        print(f"  Words processed: {total_processed}")
        print(f"  Words in buffer: {words_in_buffer}")
        print(f"  Total accounted: {total_accounted}")
        print(f"  Loss: {len(test_words) - total_accounted}")
        
        # Check history
        history = manager.get_transcript_history()
        print(f"\nHistory: '{history}'")
        
        assert total_accounted >= len(test_words) * 0.9, \
            f"Lost too many words: {len(test_words) - total_accounted} out of {len(test_words)}"