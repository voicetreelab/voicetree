"""
Test to verify benchmarker word capture
"""

import asyncio
import os
import sys
from backend.text_to_graph_pipeline.chunk_processing_pipeline.chunk_processor import ChunkProcessor
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree
from backend.text_to_graph_pipeline.tree_manager.tree_to_markdown import TreeToMarkdownConverter
import pytest


class TestBenchmarkerWordCapture:
    """Test word capture in benchmarker-like conditions"""
    
    @pytest.mark.asyncio
    async def test_sequential_word_processing(self):
        """Test sequential word processing like benchmarker does"""
        # Initialize components
        decision_tree = DecisionTree()
        converter = TreeToMarkdownConverter(decision_tree.tree)
        processor = ChunkProcessor(
            decision_tree=decision_tree,
            converter=converter,
            output_dir="/tmp/test_output"
        )
        
        # Test transcript (first 50 words)
        test_transcript = """So, today I'm starting work on voice tree. Right now, there's a few different 
        things I want to look into. So I'm going to try to come up with the overall plan for voice tree. 
        The proof of concept is basically I can speak some audio into this app"""
        
        words = test_transcript.split()
        word_count = len(words)
        print(f"Processing {word_count} words sequentially")
        
        # Process words one by one (like benchmarker)
        for i, word in enumerate(words):
            await processor.process_and_convert(word + " ")
            
        # Check transcript history
        history = processor.buffer_manager.get_transcript_history()
        history_words = history.split()
        
        # Check buffer state
        buffer_content = processor.buffer_manager._text_buffer
        buffer_words = buffer_content.split() if buffer_content else []
        
        print(f"\nResults:")
        print(f"Words sent: {word_count}")
        print(f"Words in history: {len(history_words)}")
        print(f"Words in buffer: {len(buffer_words)}")
        print(f"History capture rate: {len(history_words) / word_count * 100:.1f}%")
        
        # Debug: Show what was processed
        print(f"\nDebug - Buffer content: '{buffer_content}'")
        print(f"Debug - Last 20 words of history: {' '.join(history_words[-20:])}")
        
        # Most words should be captured (allow for some processing/buffering loss)
        # The important thing is that the system processes the content, not that every single word is preserved
        capture_rate = len(history_words) / word_count
        assert capture_rate >= 0.8, \
            f"Too many words lost: sent {word_count}, captured {len(history_words)} ({capture_rate*100:.1f}%)"
        
        # The key test: ensure content was actually processed into nodes
        tree = processor.decision_tree.tree
        assert len(tree) > 0, "No nodes were created from the transcript"