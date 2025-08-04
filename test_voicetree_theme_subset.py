#!/usr/bin/env python3
"""
Test theme identification on a focused subset of VoiceTree-related files
"""

import asyncio
import os
import sys

sys.path.insert(0, '/Users/bobbobby/repos/VoiceTree/backend')

from text_to_graph_pipeline.agentic_workflows.theme_identification_workflow_driver import ThemeIdentificationWorkflow


async def main():
    """Run theme identification on VoiceTree subset"""
    
    test_path = "/tmp/voicetree_theme_test"
    
    print(f"🌲 Testing Theme Identification on VoiceTree Subset")
    print(f"📂 Path: {test_path}")
    
    # List files
    files = sorted([f for f in os.listdir(test_path) if f.endswith('.md')])
    print(f"📄 Found {len(files)} VoiceTree-related files:")
    for f in files:
        print(f"   • {f}")
    
    print(f"\n🚀 Running Theme Identification...")
    
    try:
        # Run the workflow
        workflow = ThemeIdentificationWorkflow()
        result = await workflow.identify_themes(test_path, write_colors=True)
        
        print("\n✅ Results:")
        print(f"   • Total themes: {result['total_themes']}")
        print(f"   • Total nodes processed: {result['total_nodes_processed']}")
        
        if result['total_themes'] > 0:
            print(f"\n🎯 Identified Themes:")
            for theme_name, theme_data in result["identified_themes"].items():
                print(f"\n📌 {theme_name}")
                print(f"   Description: {theme_data['description']}")
                print(f"   Nodes: {theme_data['node_count']} ({theme_data['node_ids']})")
            
            # Show color assignments
            if "color_assignments" in result:
                print(f"\n🎨 Color Assignments:")
                for node_id, color in result["color_assignments"].items():
                    # Find the filename for this node ID
                    filename = f"{node_id}_*.md"
                    matching_files = [f for f in files if f.startswith(f"{node_id}_")]
                    if matching_files:
                        print(f"   • {matching_files[0]}: {color}")
            
            # Verify a file was updated
            sample_file = os.path.join(test_path, files[0])
            with open(sample_file, 'r') as f:
                content = f.read()
                if 'color:' in content:
                    print(f"\n✅ Colors successfully written to files!")
                else:
                    print(f"\n⚠️ Colors not found in files")
        else:
            print(f"\n⚠️ No themes identified - this might indicate the content is too diverse")
            
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())