#!/usr/bin/env python3
"""Debug script to understand fuzzy matcher behavior"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from text_to_graph_pipeline.text_buffer_manager import FuzzyTextMatcher

def test_similarity_calculation():
    """Test the similarity calculation between two identical texts"""
    matcher = FuzzyTextMatcher(similarity_threshold=0.8)
    
    # Test case 1: Identical texts
    text1 = "This is a test sentence."
    text2 = "This is a test sentence."
    
    # Direct similarity calculation
    score = matcher._calculate_similarity(text1, text2)
    print(f"Test 1 - Identical texts:")
    print(f"  Text 1: '{text1}'")
    print(f"  Text 2: '{text2}'")
    print(f"  Similarity: {score:.2%}")
    print()
    
    # Test case 2: Texts that appear identical but might have hidden differences
    text1 = "Hello world"
    text2 = "Hello world"
    
    score = matcher._calculate_similarity(text1, text2)
    print(f"Test 2 - Simple identical texts:")
    print(f"  Text 1: '{text1}' (len={len(text1)})")
    print(f"  Text 2: '{text2}' (len={len(text2)})")
    print(f"  Similarity: {score:.2%}")
    print()
    
    # Test case 3: Check for hidden characters
    text1 = "Hello world"
    text2 = "Hello world"  # Same text
    
    # Check byte representation
    print(f"Test 3 - Byte comparison:")
    print(f"  Text 1 bytes: {text1.encode('utf-8')}")
    print(f"  Text 2 bytes: {text2.encode('utf-8')}")
    print(f"  Are equal: {text1 == text2}")
    
    # Character-by-character comparison
    print(f"  Character comparison:")
    for i, (c1, c2) in enumerate(zip(text1, text2)):
        if c1 != c2:
            print(f"    Position {i}: '{c1}' (ord={ord(c1)}) != '{c2}' (ord={ord(c2)})")
    
    score = matcher._calculate_similarity(text1, text2)
    print(f"  Similarity: {score:.2%}")
    print()
    
    # Test case 4: Empty strings
    text1 = ""
    text2 = ""
    
    score = matcher._calculate_similarity(text1, text2)
    print(f"Test 4 - Empty strings:")
    print(f"  Similarity: {score:.2%}")
    print()
    
    # Test case 5: One empty string
    text1 = "Hello"
    text2 = ""
    
    score = matcher._calculate_similarity(text1, text2)
    print(f"Test 5 - One empty string:")
    print(f"  Text 1: '{text1}'")
    print(f"  Text 2: '{text2}'")
    print(f"  Similarity: {score:.2%}")
    print()


def test_find_best_match():
    """Test the find_best_match method"""
    matcher = FuzzyTextMatcher(similarity_threshold=0.8)
    
    # Test case 1: Simple match
    source = "Hello world. This is a test."
    target = "Hello world."
    
    match = matcher.find_best_match(target, source)
    print(f"Match Test 1 - Simple match:")
    print(f"  Source: '{source}'")
    print(f"  Target: '{target}'")
    if match:
        start, end, score = match
        print(f"  Match found: position {start}-{end}, score={score:.2%}")
        print(f"  Matched text: '{source[start:end]}'")
    else:
        print(f"  No match found!")
    print()
    
    # Test case 2: Empty target
    source = "Hello world."
    target = ""
    
    match = matcher.find_best_match(target, source)
    print(f"Match Test 2 - Empty target:")
    print(f"  Source: '{source}'")
    print(f"  Target: '{target}'")
    print(f"  Match result: {match}")
    print()
    
    # Test case 3: Empty source
    source = ""
    target = "Hello world."
    
    match = matcher.find_best_match(target, source)
    print(f"Match Test 3 - Empty source:")
    print(f"  Source: '{source}'")
    print(f"  Target: '{target}'")
    print(f"  Match result: {match}")
    print()


if __name__ == "__main__":
    print("=== Fuzzy Matcher Debug ===\n")
    test_similarity_calculation()
    print("\n" + "="*50 + "\n")
    test_find_best_match()