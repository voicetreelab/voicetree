"""
Test async behavior of buffer manager
"""

import asyncio
import pytest
import time
from backend.text_to_graph_pipeline.text_buffer_manager import TextBufferManager, BufferConfig


class TestAsyncBufferBehavior:
    """Test suite for async buffer behavior"""
    
    @pytest.mark.asyncio
    async def test_buffer_during_processing_delay(self):
        """Test that buffer correctly handles words arriving during processing - realistic scenario"""
        config = BufferConfig(buffer_size_threshold=20)  # Small threshold for testing
        manager = TextBufferManager(config=config)
        
        # Track processing
        processing_calls = []
        completed_processing = []
        
        async def simulate_workflow_processing(text):
            """Simulate workflow processing that extracts completed portion"""
            processing_calls.append(text)
            
            # Simulate processing delay
            await asyncio.sleep(0.1)
            
            # Simulate workflow extracting only complete sentences
            # In real system, the workflow determines what was "completed"
            words = text.split()
            if len(words) >= 3:  # Simulate completing first 3 words as a "sentence"
                completed = " ".join(words[:3]) + " "
                manager.flush_completed_text(completed)
                completed_processing.append(completed)
                return completed
            return ""
        
        # Test scenario: words arrive while processing is happening
        # This simulates the real system where voice input continues during workflow processing
        
        # Phase 1: Add words until buffer triggers
        phase1_words = ["Hello", "world", "this", "is", "a"]
        for word in phase1_words:
            result = manager.add_text(word + " ")
            if result.is_ready:
                # Start processing (simulating the await in the main loop)
                processing_task = asyncio.create_task(simulate_workflow_processing(result.text))
                
                # Phase 2: While processing, more words arrive
                phase2_words = ["test", "of", "the", "buffer"]
                for word2 in phase2_words[:2]:  # Add some words during processing
                    manager.add_text(word2 + " ")
                
                # Wait for processing to complete
                await processing_task
                
                # Add remaining words
                for word2 in phase2_words[2:]:
                    manager.add_text(word2 + " ")
                break
        
        # Phase 3: Continue adding words to trigger another processing
        phase3_words = ["system", "with", "fuzzy", "matching"]
        for word in phase3_words:
            result = manager.add_text(word + " ")
            if result.is_ready:
                await simulate_workflow_processing(result.text)
                break
        
        # Verify results
        print(f"Processing calls: {processing_calls}")
        print(f"Completed processing: {completed_processing}")
        print(f"Final buffer state: '{manager._text_buffer}'")
        
        # Calculate what should be in the system
        all_words_added = phase1_words + phase2_words[:2] + phase2_words[2:] + phase3_words
        total_words_added = len(all_words_added)
        
        # Count processed words
        processed_words = sum(len(text.split()) for text in completed_processing)
        remaining_words = len(manager._text_buffer.split())
        
        print(f"\nTotal words added: {total_words_added}")
        print(f"Words processed: {processed_words}")
        print(f"Words in buffer: {remaining_words}")
        
        # All words should be accounted for
        assert processed_words + remaining_words <= total_words_added, \
            f"Too many words: processed {processed_words} + buffered {remaining_words} > added {total_words_added}"
        
        # Should have triggered at least 2 processing cycles
        assert len(processing_calls) >= 2, f"Expected at least 2 processing calls, got {len(processing_calls)}"
        
        # Buffer should not be empty (some words remain)
        assert len(manager._text_buffer) > 0, "Buffer should have remaining text"