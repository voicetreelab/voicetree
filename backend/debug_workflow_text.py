#!/usr/bin/env python3
"""Debug script to understand workflow text extraction issue"""

def simulate_extract_completed_text(workflow_result):
    """Simulate the _extract_completed_text method"""
    chunks = workflow_result.get("chunks", [])
    if not chunks:
        return ""
        
    # Extract text ONLY from complete chunks
    complete_texts = []
    for chunk in chunks:
        if chunk.get("is_complete", False):
            text = chunk.get("text", "").strip()
            if text:
                complete_texts.append(text)
            
    return " ".join(complete_texts) if complete_texts else ""


def test_workflow_text_extraction():
    """Test how workflow text extraction affects matching"""
    
    print("=== Testing Workflow Text Extraction ===\n")
    
    # Scenario 1: Text with leading/trailing spaces
    print("Scenario 1: Text with spaces")
    buffer_text = "  Hello world  "
    workflow_result = {
        "chunks": [
            {"text": "  Hello world  ", "is_complete": True}
        ]
    }
    
    completed_text = simulate_extract_completed_text(workflow_result)
    
    print(f"Buffer text: '{buffer_text}' (len={len(buffer_text)})")
    print(f"Completed text: '{completed_text}' (len={len(completed_text)})")
    print(f"Are equal: {buffer_text == completed_text}")
    print()
    
    # Scenario 2: Multiple chunks
    print("Scenario 2: Multiple chunks")
    buffer_text = "First chunk. Second chunk. Third chunk."
    workflow_result = {
        "chunks": [
            {"text": "First chunk.", "is_complete": True},
            {"text": " Second chunk.", "is_complete": True},
            {"text": " Third chunk.", "is_complete": True}
        ]
    }
    
    completed_text = simulate_extract_completed_text(workflow_result)
    
    print(f"Buffer text: '{buffer_text}'")
    print(f"Completed text: '{completed_text}'")
    print(f"Are equal: {buffer_text == completed_text}")
    print()
    
    # Scenario 3: Mixed complete/incomplete chunks
    print("Scenario 3: Mixed complete/incomplete chunks")
    buffer_text = "Complete part. Incomplete part"
    workflow_result = {
        "chunks": [
            {"text": "Complete part.", "is_complete": True},
            {"text": " Incomplete part", "is_complete": False}
        ]
    }
    
    completed_text = simulate_extract_completed_text(workflow_result)
    
    print(f"Buffer text: '{buffer_text}'")
    print(f"Completed text: '{completed_text}'")
    print(f"Completed text should be partial: True")
    print()
    
    # Scenario 4: Empty chunk text
    print("Scenario 4: Empty chunk text")
    buffer_text = "Some text"
    workflow_result = {
        "chunks": [
            {"text": "", "is_complete": True},
            {"text": "Some text", "is_complete": True}
        ]
    }
    
    completed_text = simulate_extract_completed_text(workflow_result)
    
    print(f"Buffer text: '{buffer_text}'")
    print(f"Completed text: '{completed_text}'")
    print()
    
    # Scenario 5: No chunks
    print("Scenario 5: No chunks")
    buffer_text = "Some text"
    workflow_result = {}
    
    completed_text = simulate_extract_completed_text(workflow_result)
    
    print(f"Buffer text: '{buffer_text}'")
    print(f"Completed text: '{completed_text}' (empty)")
    print()


if __name__ == "__main__":
    test_workflow_text_extraction()