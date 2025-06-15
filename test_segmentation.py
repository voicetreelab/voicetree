#!/usr/bin/env python3
"""Test script to debug segmentation issues"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.agentic_workflows.legacy_nodes import segmentation_node
from backend.agentic_workflows.llm_integration import call_llm

# Test transcript
test_transcript = """
So today I'm starting work on voice tree. Right now, there's a few different things.
I want to look into the first thing is I want to make a proof of concept.
"""

# Test direct LLM call
print("Testing direct LLM call...")
print("=" * 60)

# Load the segmentation prompt
from backend.agentic_workflows.legacy_nodes import load_prompt_template

try:
    prompt_template = load_prompt_template("segmentation")
    prompt = prompt_template.format(transcript_text=test_transcript)
    
    print("Prompt preview (first 500 chars):")
    print(prompt[:500])
    print("\n...")
    
    # Call LLM directly
    response = call_llm(prompt)
    
    print(f"\nLLM Response (first 500 chars):")
    print(response[:500])
    
    # Try to extract JSON
    from backend.agentic_workflows.legacy_nodes import extract_json_from_response
    json_content = extract_json_from_response(response)
    
    print(f"\nExtracted JSON (first 500 chars):")
    print(json_content[:500])
    
    # Try to parse JSON
    import json
    result = json.loads(json_content)
    print(f"\nParsed successfully! Found {len(result.get('chunks', []))} chunks")
    
except Exception as e:
    print(f"\nError: {e}")
    import traceback
    traceback.print_exc()

# Test through segmentation node
print("\n\nTesting through segmentation node...")
print("=" * 60)

state = {
    "transcript_text": test_transcript,
    "existing_nodes": "No existing nodes"
}

try:
    result = segmentation_node(state)
    print(f"Success! Found {len(result.get('chunks', []))} chunks")
    for i, chunk in enumerate(result.get('chunks', []), 1):
        print(f"\nChunk {i}:")
        print(f"  Name: {chunk.get('name')}")
        print(f"  Text: {chunk.get('text')[:100]}...")
        print(f"  Complete: {chunk.get('is_complete')}")
except Exception as e:
    print(f"\nError: {e}")
    import traceback
    traceback.print_exc()
