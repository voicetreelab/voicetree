#!/usr/bin/env python3
"""
Simple test to verify state persistence is working correctly
"""

import sys
from pathlib import Path

# Add project root to path for imports
current_dir = Path(__file__).parent
project_root = current_dir.parent.parent.parent  # Go up to VoiceTreePoc directory
sys.path.insert(0, str(project_root))

from backend.tests.integration_tests.agentic_workflows.test_helpers import PipelineHelper


def test_state_persistence():
    """Test that state persists between executions"""
    print("🧪 Testing State Persistence")
    print("=" * 50)
    
    # Create pipeline with state file
    state_file = "test_state.json"
    pipeline = PipelineHelper(state_file)
    
    # Clear any existing state
    pipeline.clear_state()
    
    # First execution
    print("\n📝 First execution:")
    transcript1 = "I'm working on a new machine learning project using Python."
    result1 = pipeline.run(transcript1)
    stats1 = pipeline.get_statistics()
    
    print(f"New nodes created: {result1.get('new_nodes', [])}")
    print(f"Total nodes: {stats1.get('total_nodes', 0)}")
    
    # Second execution - should recognize existing concepts
    print("\n📝 Second execution:")
    transcript2 = "For the machine learning project, I need to implement data preprocessing."
    result2 = pipeline.run(transcript2)
    stats2 = pipeline.get_statistics()
    
    print(f"New nodes created: {result2.get('new_nodes', [])}")
    print(f"Total nodes: {stats2.get('total_nodes', 0)}")
    
    # Third execution - should build on existing structure
    print("\n📝 Third execution:")
    transcript3 = "The Python code will use scikit-learn for the algorithms."
    result3 = pipeline.run(transcript3)
    stats3 = pipeline.get_statistics()
    
    print(f"New nodes created: {result3.get('new_nodes', [])}")
    print(f"Total nodes: {stats3.get('total_nodes', 0)}")
    
    # Display final state
    print("\n📊 Final State Summary:")
    print(f"Total executions: {len(pipeline.state_manager.execution_history)}")
    print(f"Total nodes: {len(pipeline.state_manager.nodes)}")
    print("\nNode hierarchy:")
    for name, node_data in pipeline.state_manager.nodes.items():
        parent = node_data.get('parent', 'root')
        print(f"  - {name} (parent: {parent})")
    
    # Test persistence by creating new pipeline instance
    print("\n🔄 Testing persistence with new pipeline instance...")
    pipeline2 = PipelineHelper(state_file)
    stats_reloaded = pipeline2.get_statistics()
    
    print(f"Nodes after reload: {stats_reloaded.get('total_nodes', 0)}")
    
    if stats_reloaded.get('total_nodes') == stats3.get('total_nodes'):
        print("✅ State persistence working correctly!")
    else:
        print("❌ State persistence issue detected")
    
    # Cleanup
    Path(state_file).unlink(missing_ok=True)


if __name__ == "__main__":
    test_state_persistence() 