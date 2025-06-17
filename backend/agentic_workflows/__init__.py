"""
Agentic Workflows - VoiceTree Processing Pipeline

This module provides a workflow system for processing voice transcripts 
into knowledge trees through a 4-stage pipeline:

1. Segmentation - Breaking transcripts into atomic ideas
2. Relationship Analysis - Analyzing connections to existing knowledge  
3. Integration Decision - Deciding whether to create new nodes or append to existing ones
4. Node Extraction - Creating the final knowledge tree structure

Main API:
- VoiceTreePipeline: Main pipeline class with state management
- run_voicetree_pipeline: Functional interface for single runs
- Individual processing nodes: segmentation_node, relationship_analysis_node, etc.

Infrastructure:
- LLM integration for Gemini API
- State management for persistent knowledge graphs
- Debug logging and visualization tools
"""

# ==========================================
# MAIN PIPELINE API
# ==========================================

# Main pipeline components
try:
    from .main import VoiceTreePipeline, run_voicetree_pipeline
    from .nodes import (
        segmentation_node,
        relationship_analysis_node, 
        integration_decision_node,
        node_extraction_node
    )
    PIPELINE_AVAILABLE = True
except ImportError:
    # Pipeline components not available
    PIPELINE_AVAILABLE = False
    VoiceTreePipeline = None
    run_voicetree_pipeline = None

# Infrastructure components
try:
    from .infrastructure import (
        call_llm,
        call_llm_structured,
        VoiceTreeStateManager,
        log_stage_input_output,
        log_transcript_processing,
        create_workflow_diagram
    )
    INFRASTRUCTURE_AVAILABLE = True
except ImportError:
    INFRASTRUCTURE_AVAILABLE = False

# ==========================================
# EXPORTS
# ==========================================

__all__ = [
    # === MAIN PIPELINE ===
    'VoiceTreePipeline',
    'run_voicetree_pipeline',
    
    # === PROCESSING NODES ===
    'segmentation_node',
    'relationship_analysis_node',
    'integration_decision_node',
    'node_extraction_node',
    
    # === INFRASTRUCTURE ===
    'call_llm',
    'call_llm_structured',
    'VoiceTreeStateManager', 
    'log_stage_input_output',
    'log_transcript_processing',
    'create_workflow_diagram',
    
    # === AVAILABILITY FLAGS ===
    'PIPELINE_AVAILABLE',
    'INFRASTRUCTURE_AVAILABLE'
]

# ==========================================
# USAGE EXAMPLES
# ==========================================

def get_usage_examples():
    """
    Returns usage examples for the VoiceTree pipeline
    """
    return {
        'basic_usage': '''
            # Basic pipeline usage
            from backend.agentic_workflows import VoiceTreePipeline
            
            pipeline = VoiceTreePipeline("knowledge_graph.json")
            result = pipeline.run("I'm working on a new AI project")
        ''',
        
        'functional_api': '''
            # Functional API for single runs
            from backend.agentic_workflows import run_voicetree_pipeline
            
            result = run_voicetree_pipeline("transcript text", state_file="state.json")
        ''',
        
        'state_management': '''
            # Pipeline with persistent state
            pipeline = VoiceTreePipeline("persistent_state.json")
            result1 = pipeline.run("First transcript")
            result2 = pipeline.run("Second transcript")  # Builds on first
            
            stats = pipeline.get_statistics()
            print(f"Total nodes: {stats['total_nodes']}")
        '''
    }


def print_pipeline_summary():
    """Print a summary of the pipeline system"""
    print("🎯 VOICETREE PROCESSING PIPELINE")
    print("=" * 50)
    
    print(f"🔧 Pipeline: {'✅ Available' if PIPELINE_AVAILABLE else '❌ Not Available'}")
    print(f"🏗️ Infrastructure: {'✅ Available' if INFRASTRUCTURE_AVAILABLE else '❌ Limited'}")
    
    if PIPELINE_AVAILABLE:
        print("\n📋 Processing Stages:")
        print("  1. 🧩 Segmentation - Break transcripts into atomic ideas")
        print("  2. 🔗 Relationship Analysis - Analyze connections to existing knowledge")
        print("  3. 🤔 Integration Decision - Decide whether to create new nodes or append")
        print("  4. 🌳 Node Extraction - Create final knowledge tree structure")
    
    print(f"\n📝 Usage: get_usage_examples() for code examples")
    print("🧪 Test: python -m pytest backend/tests/integration_tests/agentic_workflows/") 