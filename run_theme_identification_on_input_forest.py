#!/usr/bin/env python3
"""
Run theme identification on the actual INPUT_FOREST directory with color writing enabled
"""

import asyncio
import os
import sys

# Add the backend directory to the Python path
sys.path.insert(0, '/Users/bobbobby/repos/VoiceTree/backend')

from text_to_graph_pipeline.agentic_workflows.theme_identification_workflow_driver import ThemeIdentificationWorkflow


async def main():
    """Run theme identification on the real INPUT_FOREST"""
    
    input_forest_path = "/Users/bobbobby/repos/VoiceTree/markdownTreeVaultDefault/INPUT_FOREST"
    
    print(f"🌲 Running Theme Identification on INPUT_FOREST")
    print(f"📂 Path: {input_forest_path}")
    print(f"🎨 Color writing: ENABLED")
    
    # Check current state
    print(f"\n📋 Checking current state of files...")
    sample_file = os.path.join(input_forest_path, "1_Current_Project_Work.md")
    if os.path.exists(sample_file):
        with open(sample_file, 'r') as f:
            content = f.read()
            has_color = 'color:' in content
            print(f"   Sample file has color: {has_color}")
    
    print(f"\n🚀 Running Theme Identification Workflow...")
    
    try:
        # Run the workflow with color writing ENABLED
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
                print(f"   Node IDs: {theme_data['node_ids'][:10]}{'...' if len(theme_data['node_ids']) > 10 else ''}")
        
        # Show color assignments
        if "color_assignments" in result:
            print(f"\n🎨 Color Assignments:")
            assignments = result["color_assignments"]
            print(f"   Total nodes colored: {len(assignments)}")
            # Show sample assignments
            sample_assignments = list(assignments.items())[:5]
            for node_id, color in sample_assignments:
                print(f"   • Node {node_id}: {color}")
            if len(assignments) > 5:
                print(f"   ... and {len(assignments) - 5} more")
        
        # Verify colors were written
        print(f"\n🔍 Verifying color writing...")
        if os.path.exists(sample_file):
            with open(sample_file, 'r') as f:
                content = f.read()
                if 'color:' in content:
                    print(f"   ✅ Colors successfully written to markdown files!")
                    # Extract the color
                    for line in content.split('\n'):
                        if line.startswith('color:'):
                            print(f"   Sample: {line}")
                            break
                else:
                    print(f"   ⚠️ Colors not found in sample file")
        
        return result
        
    except Exception as e:
        print(f"❌ Error running workflow: {e}")
        import traceback
        traceback.print_exc()
        return None


if __name__ == "__main__":
    result = asyncio.run(main())