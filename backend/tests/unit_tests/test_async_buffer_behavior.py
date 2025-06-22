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
        """Test that buffer correctly handles words arriving during processing"""
        config = BufferConfig(buffer_size_threshold=20)  # Small threshold for testing
        manager = TextBufferManager(config=config)
        
        # Track processing calls
        processing_calls = []
        buffer_states = []
        
        async def simulate_processing(text):
            """Simulate slow processing"""
            processing_calls.append(text)
            buffer_states.append({
                'before_delay': len(manager._text_buffer),
                'text_processing': text
            })
            await asyncio.sleep(0.1)  # Simulate processing time
            buffer_states[-1]['after_delay'] = len(manager._text_buffer)
        
        # Test words
        test_words = ["word" + str(i) for i in range(20)]
        
        # Process words with simulated delays
        for i, word in enumerate(test_words):
            result = manager.add_text(word + " ")
            if result.is_ready:
                # Start processing without awaiting (simulating concurrent arrival)
                asyncio.create_task(simulate_processing(result.text))
                
        # Wait for all processing to complete
        await asyncio.sleep(0.5)
        
        # Check results
        print(f"Processing calls: {len(processing_calls)}")
        print(f"Buffer states during processing:")
        for state in buffer_states:
            after = state.get('after_delay', 'N/A')
            print(f"  - Processing '{state['text_processing'][:30]}...', buffer before: {state['before_delay']}, after: {after}")
        
        # Get final buffer state
        final_buffer_words = manager._text_buffer.split()
        total_processed_words = sum(len(text.split()) for text in processing_calls)
        total_words_in_buffer = len(final_buffer_words)
        
        print(f"\nTotal words sent: {len(test_words)}")
        print(f"Total words processed: {total_processed_words}")
        print(f"Words remaining in buffer: {total_words_in_buffer}")
        print(f"Total accounted for: {total_processed_words + total_words_in_buffer}")
        
        # All words should be accounted for
        assert total_processed_words + total_words_in_buffer == len(test_words), \
            f"Words lost: sent {len(test_words)}, accounted for {total_processed_words + total_words_in_buffer}"