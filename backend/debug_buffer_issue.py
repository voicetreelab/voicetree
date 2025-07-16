#!/usr/bin/env python3
"""Debug script to understand buffer manager issue"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from text_to_graph_pipeline.text_buffer_manager import TextBufferManager


def test_buffer_flush_scenario():
    """Test the scenario where completed text can't be found in buffer"""
    
    # Initialize buffer manager
    buffer_manager = TextBufferManager()
    buffer_manager.init(bufferFlushLength=50)  # Small buffer for testing
    
    print("=== Testing Buffer Flush Scenario ===\n")
    
    # Scenario 1: Normal case
    print("Scenario 1: Normal case")
    test_text = "This is a test sentence that should be long enough to trigger the buffer flush."
    buffer_manager.addText(test_text)
    
    print(f"Added text: '{test_text}'")
    print(f"Buffer content: '{buffer_manager.getBuffer()}'")
    print(f"Should process: '{buffer_manager.getBufferTextWhichShouldBeProcessed()}'")
    
    # Simulate workflow returning the same text as completed
    completed_text = test_text
    print(f"\nSimulating workflow completion with: '{completed_text}'")
    
    try:
        remaining = buffer_manager.flushCompletelyProcessedText(completed_text)
        print(f"Success! Remaining buffer: '{remaining}'")
    except RuntimeError as e:
        print(f"ERROR: {e}")
    
    print("\n" + "="*50 + "\n")
    
    # Scenario 2: Empty completed text
    buffer_manager.clear()
    print("Scenario 2: Empty completed text")
    buffer_manager.addText("Another test sentence.")
    
    print(f"Buffer content: '{buffer_manager.getBuffer()}'")
    print(f"Flushing with empty text...")
    
    remaining = buffer_manager.flushCompletelyProcessedText("")
    print(f"Remaining buffer: '{remaining}'")
    
    print("\n" + "="*50 + "\n")
    
    # Scenario 3: Workflow returns partial text
    buffer_manager.clear()
    print("Scenario 3: Workflow returns partial text")
    full_text = "This is a long sentence that will be processed by the workflow system."
    buffer_manager.addText(full_text)
    
    print(f"Buffer content: '{buffer_manager.getBuffer()}'")
    
    # Simulate workflow only completing part of the text
    completed_text = "This is a long sentence"
    print(f"\nSimulating partial completion: '{completed_text}'")
    
    try:
        remaining = buffer_manager.flushCompletelyProcessedText(completed_text)
        print(f"Success! Remaining buffer: '{remaining}'")
    except RuntimeError as e:
        print(f"ERROR: {e}")
    
    print("\n" + "="*50 + "\n")
    
    # Scenario 4: Check what happens with whitespace differences
    buffer_manager.clear()
    print("Scenario 4: Whitespace differences")
    buffer_text = "Hello    world   test"  # Multiple spaces
    completed_text = "Hello world test"      # Single spaces
    
    buffer_manager._buffer = buffer_text  # Direct assignment for testing
    
    print(f"Buffer content: '{buffer_manager.getBuffer()}'")
    print(f"Completed text: '{completed_text}'")
    
    # Check similarity
    from text_to_graph_pipeline.text_buffer_manager import FuzzyTextMatcher
    matcher = FuzzyTextMatcher()
    score = matcher._calculate_similarity(completed_text, buffer_text)
    print(f"Similarity score: {score:.2%}")
    
    try:
        remaining = buffer_manager.flushCompletelyProcessedText(completed_text)
        print(f"Success! Remaining buffer: '{remaining}'")
    except RuntimeError as e:
        print(f"ERROR: {e}")


def test_edge_cases():
    """Test edge cases that might cause 0% similarity"""
    from text_to_graph_pipeline.text_buffer_manager import FuzzyTextMatcher
    
    print("\n=== Testing Edge Cases ===\n")
    
    matcher = FuzzyTextMatcher()
    
    # Case 1: Unicode characters
    print("Case 1: Unicode characters")
    text1 = "Hello—world"  # Em dash
    text2 = "Hello-world"  # Regular dash
    score = matcher._calculate_similarity(text1, text2)
    print(f"Text 1: '{text1}' (bytes: {text1.encode('utf-8')})")
    print(f"Text 2: '{text2}' (bytes: {text2.encode('utf-8')})")
    print(f"Similarity: {score:.2%}")
    print()
    
    # Case 2: Zero-width characters
    print("Case 2: Zero-width characters")
    text1 = "Hello\u200bworld"  # Zero-width space
    text2 = "Helloworld"
    score = matcher._calculate_similarity(text1, text2)
    print(f"Text 1: '{text1}' (len={len(text1)})")
    print(f"Text 2: '{text2}' (len={len(text2)})")
    print(f"Similarity: {score:.2%}")
    print()
    
    # Case 3: Different line endings
    print("Case 3: Line endings")
    text1 = "Hello\nworld"
    text2 = "Hello world"
    score = matcher._calculate_similarity(text1, text2)
    print(f"Text 1: '{repr(text1)}'")
    print(f"Text 2: '{repr(text2)}'")
    print(f"Similarity: {score:.2%}")
    print()
    
    # Case 4: Empty vs whitespace
    print("Case 4: Empty vs whitespace")
    text1 = ""
    text2 = " "
    score = matcher._calculate_similarity(text1, text2)
    print(f"Text 1: '{text1}' (empty)")
    print(f"Text 2: '{text2}' (space)")
    print(f"Similarity: {score:.2%}")


if __name__ == "__main__":
    test_buffer_flush_scenario()
    test_edge_cases()