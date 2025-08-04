#!/usr/bin/env python3
"""
Run theme identification on the actual INPUT_FOREST directory
"""

import asyncio
import os
import sys

# Add the backend directory to the Python path
sys.path.insert(0, '/Users/bobbobby/repos/VoiceTree/backend')

from text_to_graph_pipeline.agentic_workflows.theme_identification_workflow_driver import ThemeIdentificationWorkflow


async def main():
    """Run theme identification on actual INPUT_FOREST"""
    
    # Use the actual INPUT_FOREST directory
    input_forest_path = "/Users/bobbobby/repos/VoiceTree/markdownTreeVaultDefault/INPUT_FOREST"
    
    print(f"🌲 Running Theme Identification on Actual INPUT_FOREST")
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
            print(f"   Nodes: {theme_data['node_count']} nodes")
            if theme_data['node_count'] > 0:
                print(f"   Node IDs: {theme_data['node_ids'][:5]}{'...' if len(theme_data['node_ids']) > 5 else ''}")
        
        # Show color assignments if they exist
        if "color_assignments" in result:
            print(f"\n🎨 Color Assignments Written: {len(result['color_assignments'])} files updated")
            # Show first few color assignments
            sample_assignments = list(result['color_assignments'].items())[:5]
            for node_id, color in sample_assignments:
                print(f"   • Node {node_id}: {color}")
            if len(result['color_assignments']) > 5:
                print(f"   ... and {len(result['color_assignments']) - 5} more")
        
        print("\n✅ Files have been updated with theme colors!")
        print(f"📁 Check the files in: {input_forest_path}")
        
        return result
        
    except Exception as e:
        print(f"❌ Error running workflow: {e}")
        import traceback
        traceback.print_exc()
        return None


if __name__ == "__main__":
    result = asyncio.run(main())