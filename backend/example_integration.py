"""
Example: VoiceTree with Agentic Workflow

This example demonstrates how to use VoiceTree with the agentic workflow system.
"""

import asyncio
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.append(str(Path(__file__).parent.parent))

from backend.tree_manager.decision_tree_ds import DecisionTree
from backend.tree_manager.workflow_tree_manager import WorkflowTreeManager
from backend.tree_manager.tree_to_markdown import TreeToMarkdownConverter
from backend.agentic_workflows.visualizer import WorkflowVisualizer
import process_transcription


async def demo_workflow_integration():
    """Demonstrate VoiceTree with agentic workflows"""
    
    print("🌳 VoiceTree with Agentic Workflow Demo")
    print("=" * 60)
    
    # Initialize components
    decision_tree = DecisionTree()
    
    # Create tree manager with workflow
    tree_manager = WorkflowTreeManager(
        decision_tree=decision_tree,
        workflow_state_file="demo_workflow_state.json"
    )
    
    converter = TreeToMarkdownConverter(decision_tree.tree)
    processor = process_transcription.TranscriptionProcessor(tree_manager, converter)
    
    # Example transcripts to process
    transcripts = [
        "I'm starting a new project to build a voice-controlled knowledge management system.",
        "The system should be able to process voice input and organize it into a tree structure.",
        "Each node in the tree represents a concept or idea from the voice input.",
        "The tree can grow over time as more voice input is processed.",
        "I want to use LangGraph for the agentic workflow processing."
    ]
    
    # Process each transcript
    for i, transcript in enumerate(transcripts, 1):
        print(f"\n📝 Processing transcript {i}:")
        print(f"   '{transcript[:60]}...'")
        
        # Simulate voice input processing
        await tree_manager.process_voice_input(transcript)
        
        # Get workflow statistics
        stats = tree_manager.get_workflow_statistics()
        print(f"   Workflow stats: {stats}")
    
    # Display final tree structure
    print("\n🌲 Final Tree Structure:")
    print("=" * 60)
    
    # Print tree summary
    total_nodes = len(decision_tree.tree)
    print(f"Total nodes created: {total_nodes}")
    
    for node_id, node in decision_tree.tree.items():
        if hasattr(node, 'name'):
            parent_info = f" (parent: {node.parent_id})" if hasattr(node, 'parent_id') and node.parent_id else " (root)"
            print(f"  - {node.name}{parent_info}")
    
    # Generate and save visualization
    print("\n📊 Generating Workflow Visualization...")
    visualizer = WorkflowVisualizer()
    
    # Save HTML visualization
    viz_path = Path("workflow_visualization_demo.html")
    visualizer.generate_html_visualization(viz_path)
    print(f"   Visualization saved to: {viz_path}")
    
    # Show complexity analysis
    complexity = visualizer.analyze_workflow_complexity()
    print("\n🔍 Workflow Complexity Analysis:")
    for key, value in complexity.items():
        print(f"   {key}: {value}")
    
    print("\n✅ Demo completed!")


async def demo_workflow_interface():
    """Demonstrate the workflow interface"""
    
    print("\n🔧 Workflow Interface Demo")
    print("=" * 60)
    
    from backend.agentic_workflows.workflow_interface import WorkflowInterface
    
    # Create workflow interface
    interface = WorkflowInterface()
    
    # Validate workflow
    validation = interface.validate_workflow()
    print(f"Workflow valid: {validation['valid']}")
    if not validation['valid']:
        print(f"Issues: {validation['issues']}")
    
    # Show all stages
    print("\nWorkflow Stages:")
    for stage in interface.get_all_stages():
        print(f"  - {stage['name']} ({stage['id']})")
        print(f"    Inputs: {', '.join(stage['input_keys'])}")
        print(f"    Output: {stage['output_key']}")
    
    # Execute a mock workflow
    print("\nExecuting workflow...")
    result = interface.execute_workflow(
        transcript="This is a test transcript for the workflow.",
        existing_nodes="Project Management: Main project node\nVoice Processing: Handles voice input"
    )
    
    if result.get("error_message"):
        print(f"Error: {result['error_message']}")
    else:
        print(f"Success! New nodes: {result.get('new_nodes', [])}")


async def main():
    """Run all demos"""
    
    # Run workflow integration demo
    await demo_workflow_integration()
    
    # Run workflow interface demo
    await demo_workflow_interface()


if __name__ == "__main__":
    # Note: This is a demo script. In production, you would need:
    # 1. Proper Google API key configuration for LLM calls
    # 2. Error handling and logging setup
    # 3. Voice input integration
    
    print("⚠️  Note: This demo uses mock LLM responses by default.")
    print("    To use real LLM integration, configure your API keys in settings.py")
    
    asyncio.run(main()) 