#!/usr/bin/env python3
"""
Test script to run theme identification on the actual INPUT_FOREST directory
"""

import asyncio
import os
import sys

# Add the backend directory to the Python path
sys.path.insert(0, '/Users/bobbobby/repos/VoiceTree/backend')

from text_to_graph_pipeline.agentic_workflows.theme_identification_workflow_driver import ThemeIdentificationWorkflow


async def main():
    """Run theme identification on INPUT_FOREST"""
    
    # Test on smaller test dataset first to verify color writing
    input_forest_path = "/Users/bobbobby/repos/VoiceTree/backend/tests/integration_tests/theme_identification_test_data/input_forest"
    
    print(f"🌲 Testing Theme Identification on INPUT_FOREST")
    print(f"📂 Path: {input_forest_path}")
    
    # Check if directory exists
    if not os.path.exists(input_forest_path):
        print(f"❌ Directory not found: {input_forest_path}")
        return
    
    # Count files in directory
    files = [f for f in os.listdir(input_forest_path) if f.endswith('.md')]
    print(f"📄 Found {len(files)} markdown files")
    
    if len(files) == 0:
        print("❌ No markdown files found")
        return
    
    # Show first few files
    print(f"📋 Sample files: {files[:5]}...")
    
    print("\n🚀 Running Theme Identification Workflow...")
    
    try:
        # First, let's see what nodes get loaded
        from text_to_graph_pipeline.tree_manager.markdown_to_tree import load_markdown_repository_for_themes
        tree = load_markdown_repository_for_themes(input_forest_path)
        
        print(f"\n🔍 Debug Info:")
        print(f"   • Loaded {len(tree)} nodes into tree")
        node_ids = sorted(tree.keys())
        print(f"   • Node IDs: {node_ids[:10]}{'...' if len(node_ids) > 10 else ''}")
        
        # Show a sample of node titles
        sample_nodes = list(tree.values())[:5]
        print(f"   • Sample titles:")
        for node in sample_nodes:
            print(f"     - Node {node.id}: {node.title}")
        
        # Run the workflow WITH color writing enabled
        workflow = ThemeIdentificationWorkflow()
        result = await workflow.identify_themes(input_forest_path, write_colors=True)
        
        print("\n✅ Theme Identification Complete!")
        print(f"📊 Results:")
        print(f"   • Total themes: {result['total_themes']}")
        print(f"   • Total nodes processed: {result['total_nodes_processed']}")
        
        print(f"\n🎯 Identified Themes:")
        for theme_name, theme_data in result["identified_themes"].items():
            print(f"\n📌 {theme_name}")
            print(f"   Description: {theme_data['description']}")
            print(f"   Nodes: {theme_data['node_count']} ({theme_data['node_ids']})")
        
        # Show color assignments if they exist
        if "color_assignments" in result:
            print(f"\n🎨 Color Assignments Written:")
            for node_id, color in result["color_assignments"].items():
                print(f"   • Node {node_id}: {color}")
        
        return result
        
    except Exception as e:
        print(f"❌ Error running workflow: {e}")
        import traceback
        traceback.print_exc()
        return None


if __name__ == "__main__":
    result = asyncio.run(main())