#!/usr/bin/env python3

import asyncio
import os
import sys
sys.path.insert(0, '.')

from backend.tree_manager.decision_tree_ds import DecisionTree
from backend.tree_manager.workflow_tree_manager import WorkflowTreeManager
from backend.tree_manager.tree_to_markdown import TreeToMarkdownConverter

async def test_workflow():
    print("🔧 Testing VoiceTree Workflow Components")
    print("=" * 50)
    
    # Create fresh instances with a lower buffer threshold for testing
    decision_tree = DecisionTree()
    tree_manager = WorkflowTreeManager(decision_tree, workflow_state_file="debug_test_state.json")
    
    # Set a lower buffer threshold for testing (default is 500, we'll use 100)
    tree_manager.workflow_adapter.pipeline.buffer_threshold = 100
    
    # Clear any existing state
    tree_manager.clear_workflow_state()
    
    # Read the test transcript
    transcript_file = "oldVaults/VoiceTreePOC/og_vt_transcript.txt"
    with open(transcript_file, "r") as f:
        content = f.read()
    
    print(f"📖 Original transcript (first 200 chars):")
    print(f"'{content[:200]}...'\n")
    
    # Limit to first 150 words to match benchmarker
    words = content.split()[:150]
    limited_content = ' '.join(words)
    
    print(f"📝 Limited transcript (first 100 chars):")
    print(f"'{limited_content[:100]}...'\n")
    print(f"📏 Limited transcript length: {len(limited_content)} characters\n")
    
    # Process the content
    print("🚀 Processing with WorkflowTreeManager...")
    print(f"🔧 Buffer threshold set to: {tree_manager.workflow_adapter.pipeline.buffer_threshold}")
    print(f"🔧 Current buffer size: {len(tree_manager.workflow_adapter.pipeline.text_buffer)}")
    
    try:
        await tree_manager.process_voice_input(limited_content)
        
        print("✅ Processing completed!")
        print(f"🔧 Buffer size after processing: {len(tree_manager.workflow_adapter.pipeline.text_buffer)}")
        print(f"🌳 Tree now has {len(decision_tree.tree)} nodes")
        
        # Show tree structure
        print("\n📊 Tree Structure:")
        for node_id, node in decision_tree.tree.items():
            if node_id == 0:
                print(f"  Root: {node.title}")
            else:
                parent_name = decision_tree.tree.get(node.parent_id, {}).title if node.parent_id else "Unknown"
                print(f"  Node {node_id}: {node.title} (parent: {parent_name})")
                print(f"    Summary: {node.summary[:100]}..." if node.summary else "    No summary")
        
        # Get workflow statistics
        stats = tree_manager.get_workflow_statistics()
        print(f"\n📈 Workflow Statistics: {stats}")
        
        # Test markdown conversion
        print("\n📄 Testing Markdown Conversion...")
        converter = TreeToMarkdownConverter(decision_tree.tree)
        output_dir = "debug_output"
        os.makedirs(output_dir, exist_ok=True)
        
        converter.convert_node(output_dir=output_dir, nodes_to_update=tree_manager.nodes_to_update)
        
        # Show generated files
        if os.path.exists(output_dir):
            print(f"Generated files:")
            for file in os.listdir(output_dir):
                print(f"  - {file}")
                
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
    
    # Clean up
    if os.path.exists("debug_test_state.json"):
        os.remove("debug_test_state.json")

if __name__ == "__main__":
    asyncio.run(test_workflow()) 