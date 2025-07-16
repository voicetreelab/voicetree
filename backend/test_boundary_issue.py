#!/usr/bin/env python3
"""Test boundary issue in mock agent"""

import random


def test_boundary_issue():
    """Test the specific case that might cause empty chunks"""
    
    # This simulates what happens in the mock agent
    words = ["hello", "world"]  # 2 words
    
    # If mock tries to create more chunks than words
    for num_chunks in range(1, 6):
        print(f"\nTrying to create {num_chunks} chunks from {len(words)} words:")
        
        if num_chunks == 1:
            print("  Single chunk - OK")
        elif num_chunks > len(words):
            print(f"  ERROR: Can't create {num_chunks} chunks from {len(words)} words!")
            print(f"  random.sample would need {num_chunks - 1} boundaries from range(1, {len(words)})")
            print(f"  But range(1, {len(words)}) only has {len(words) - 1} values")
        else:
            try:
                boundaries = sorted(random.sample(range(1, len(words)), num_chunks - 1))
                print(f"  Boundaries: {boundaries}")
            except ValueError as e:
                print(f"  ERROR: {e}")


def test_empty_transcript():
    """Test what happens with empty or whitespace-only transcript"""
    
    test_cases = [
        "",
        " ",
        "  ",
        "\n",
        "\t",
        "   \n\t  ",
    ]
    
    for transcript in test_cases:
        words = transcript.split()
        print(f"Transcript: {repr(transcript)} -> Words: {words} (count: {len(words)})")


if __name__ == "__main__":
    print("=== Testing Boundary Issues ===")
    test_boundary_issue()
    
    print("\n\n=== Testing Empty Transcripts ===")
    test_empty_transcript()