#!/usr/bin/env python3
"""Test mock agent edge cases"""

import random


def simulate_mock_chunking(transcript):
    """Simulate the mock agent's chunking behavior"""
    words = transcript.split()
    print(f"\nTranscript: '{transcript}'")
    print(f"Words: {words} (count: {len(words)})")
    
    if len(words) == 0:
        print("ERROR: No words to chunk!")
        return []
    
    num_chunks = random.randint(1, min(5, len(words)))
    print(f"Attempting to create {num_chunks} chunks")
    
    chunks = []
    
    # Create random chunk boundaries
    if num_chunks == 1:
        chunk_boundaries = [(0, len(words))]
    else:
        if len(words) <= 1:
            print(f"ERROR: Can't create {num_chunks} chunks from {len(words)} words!")
            return []
            
        # This line can fail if len(words) < num_chunks
        try:
            boundaries = sorted(random.sample(range(1, len(words)), num_chunks - 1))
            chunk_boundaries = [(0, boundaries[0])]
            for i in range(len(boundaries) - 1):
                chunk_boundaries.append((boundaries[i], boundaries[i + 1]))
            chunk_boundaries.append((boundaries[-1], len(words)))
        except ValueError as e:
            print(f"ERROR: {e}")
            return []
    
    for i, (start, end) in enumerate(chunk_boundaries):
        chunk_text = " ".join(words[start:end])
        is_complete = True if i != 2 else random.random() > 0.5
        
        chunks.append({
            "text": chunk_text,
            "is_complete": is_complete
        })
        print(f"  Chunk {i}: '{chunk_text}' (complete: {is_complete})")
    
    return chunks


def extract_completed_text(chunks):
    """Simulate workflow adapter's text extraction"""
    if not chunks:
        return ""
        
    complete_texts = []
    for chunk in chunks:
        if chunk.get("is_complete", False):
            text = chunk.get("text", "").strip()
            if text:
                complete_texts.append(text)
            
    return " ".join(complete_texts) if complete_texts else ""


# Test various edge cases
test_cases = [
    "",  # Empty
    "a",  # Single word
    "a b",  # Two words
    "a b c",  # Three words
    "This is a normal sentence with multiple words",
]

random.seed(42)  # For reproducibility

for transcript in test_cases:
    chunks = simulate_mock_chunking(transcript)
    if chunks:
        completed = extract_completed_text(chunks)
        print(f"Completed text: '{completed}'")
        print(f"Original == Completed: {transcript == completed}")