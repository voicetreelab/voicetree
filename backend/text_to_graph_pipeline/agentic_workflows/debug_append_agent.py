#!/usr/bin/env python3
"""Debug script to test AppendToRelevantNodeAgent"""

import asyncio
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from backend.text_to_graph_pipeline.agentic_workflows.agents.append_to_relevant_node_agent import AppendToRelevantNodeAgent
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree, Node


async def test_agent():
    print("=== Testing AppendToRelevantNodeAgent ===\n")
    
    # Create a simple tree
    tree = DecisionTree()
    node = Node(
        name="Database Design",
        node_id=1,
        content="Initial database design discussions",
        summary="Database architecture decisions"
    )
    tree.tree[1] = node
    tree.next_node_id = 2
    
    # Create agent
    agent = AppendToRelevantNodeAgent()
    
    # Test text
    text = "We need to add an index to the users table for performance."
    
    print(f"Input text: {text}")
    print(f"Existing nodes: {[f'{k}: {v.title}' for k, v in tree.tree.items()]}")
    print("\nRunning agent...\n")
    
    try:
        # Run agent
        actions = await agent.run(
            transcript_text=text,
            decision_tree=tree
        )
        
        print(f"\nResult: {len(actions)} actions")
        for i, action in enumerate(actions):
            print(f"\nAction {i+1}:")
            print(f"  Type: {action.__class__.__name__}")
            print(f"  Action: {action.action}")
            if hasattr(action, 'target_node_id'):
                print(f"  Target Node ID: {action.target_node_id}")
            if hasattr(action, 'new_node_name'):
                print(f"  New Node Name: {action.new_node_name}")
            print(f"  Content: {action.content}")
            
    except Exception as e:
        print(f"\nError: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(test_agent())