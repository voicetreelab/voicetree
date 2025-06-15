#!/usr/bin/env python3
"""
Test script to isolate Node Extraction issues
"""

import sys
import os
sys.path.append('../agentic_workflows')
sys.path.append('..')

from backend.agentic_workflows.legacy_nodes import node_extraction_node

# Test integration decisions (simulating what would come from previous stage)
test_state = {
    "integration_decisions": [
        {
            "action": "CREATE",
            "target_node": "NO_RELEVANT_NODE", 
            "new_node_name": "Voice Tree POC Workflow",
            "new_node_summary": "Test summary",
            "relationship_for_edge": None,
            "content": "Test content"
        }
    ],
    "existing_nodes": "No existing nodes",
    "transcript_text": "Test transcript",
    "current_stage": "integration_decision_complete"
}

print("🧪 Testing Node Extraction in isolation...")
print("=" * 50)

try:
    result = node_extraction_node(test_state)
    print("✅ Node Extraction completed")
    print(f"Result: {result}")
    
    if "new_nodes" in result:
        print(f"📝 New nodes: {result['new_nodes']}")
    
    if "error_message" in result:
        print(f"❌ Error: {result['error_message']}")
        
except Exception as e:
    print(f"❌ Exception during test: {e}")
    import traceback
    traceback.print_exc() 