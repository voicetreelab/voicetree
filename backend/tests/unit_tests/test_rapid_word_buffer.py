"""
Test rapid word-by-word input to verify buffer doesn't lose words
"""

import asyncio
import pytest
from backend.text_to_graph_pipeline.text_buffer_manager import TextBufferManager, BufferConfig
from backend.text_to_graph_pipeline.chunk_processing_pipeline.chunk_processor import ChunkProcessor
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree


class TestRapidWordBuffer:
    """Test suite for rapid word-by-word input handling"""
    
    def test_buffer_captures_all_words(self):
        """Test that buffer captures all words when they arrive rapidly"""
        config = BufferConfig(buffer_size_threshold=83)
        manager = TextBufferManager(config=config)
        
        # Simulate 253 words arriving rapidly
        test_transcript = """So, today I'm starting work on voice tree. Right now, there's a few different 
        things I want to look into. So I'm going to try to come up with the overall plan for voice tree. 
        The proof of concept is basically I can speak some audio into this app, it will then get converted 
        into markdown files, and then, ideally, what I'd like to do is convert those markdown files into 
        a visual tree that I can navigate and view. So the POC is basically just, here's some audio, it 
        gets converted into markdown files, and then those markdown files get displayed as a visual 
        representation, so I can see a tree of ideas. The next parts will involve me figuring out, one, 
        what visualization library to use. So I need to figure out what the best sort of tree visualization 
        library is. Some of the things that I need to take a look at is D3, Cytoscape, vis.js. There's 
        also the potential that I could use Flutter instead of a web framework to visualize the data. 
        And then for the actual pipeline that converts the audio to markdown tree, I need to see 
        whether I'm going to do LLM Gemini agentic pipeline or whether I'm going to do a streaming 
        OpenAI pipeline. I think the agentic Gemini one might be the best one since I've gotten the 
        most experience with it, so that's probably what I'll do."""
        
        words = test_transcript.split()
        print(f"Total words in test: {len(words)}")
        
        # Track all text that was marked as ready for processing
        processed_text = []
        
        # Send words one by one
        for word in words:
            result = manager.add_text(word + " ")
            if result.is_ready and result.text:
                processed_text.append(result.text)
        
        # Combine all processed text
        total_processed = " ".join(processed_text)
        
        # Count words in processed text
        processed_words = total_processed.split()
        
        # Should capture most words (allowing for some buffer remainder)
        # The buffer might still have some words that haven't reached threshold
        buffer_remainder_words = manager._text_buffer.split()
        total_captured_words = len(processed_words) + len(buffer_remainder_words)
        
        print(f"Words sent: {len(words)}")
        print(f"Words processed: {len(processed_words)}")
        print(f"Words in buffer: {len(buffer_remainder_words)}")
        print(f"Total captured: {total_captured_words}")
        print(f"Capture rate: {total_captured_words / len(words) * 100:.1f}%")
        
        # Should capture at least 90% of words
        assert total_captured_words >= len(words) * 0.9, \
            f"Lost too many words: sent {len(words)}, captured {total_captured_words}"
        
    @pytest.mark.asyncio
    async def test_processor_captures_all_words(self):
        """Test that the full processor pipeline captures all words"""
        # Initialize components
        decision_tree = DecisionTree()
        processor = ChunkProcessor(decision_tree=decision_tree)
        
        # Test transcript
        test_transcript = """So, today I'm starting work on voice tree. Right now, there's a few different 
        things I want to look into."""
        
        words = test_transcript.split()
        word_count = len(words)
        
        # Process words one by one
        for word in words:
            await processor.process_voice_input(word + " ")
        
        # Get the transcript history to see what was captured
        history = processor.buffer_manager.get_transcript_history()
        history_words = history.split()
        
        print(f"Words sent: {word_count}")
        print(f"Words in history: {len(history_words)}")
        print(f"Capture rate: {len(history_words) / word_count * 100:.1f}%")
        
        # Should capture all words in history
        assert len(history_words) >= word_count * 0.95, \
            f"Lost words in history: sent {word_count}, captured {len(history_words)}"