"""
Agentic Workflows Package

Multi-agent LLM processing pipeline for VoiceTree voice-to-knowledge-graph conversion.

This package provides a 4-stage pipeline for processing voice transcripts:
1. Segmentation - Breaking transcripts into atomic ideas
2. Relationship Analysis - Analyzing connections to existing knowledge  
3. Integration Decision - Deciding whether to create new nodes or append to existing ones
4. Node Extraction - Creating the final knowledge tree structure

Main Components:
- VoiceTreePipeline: Main pipeline class with state management
- Infrastructure: LLM integration, state management, debugging tools
- Nodes: Individual processing stages

Usage:
    from backend.agentic_workflows import VoiceTreePipeline
    from backend.agentic_workflows.infrastructure import call_llm
"""

# Core pipeline components
try:
    from .main import VoiceTreePipeline, run_voicetree_pipeline
    PIPELINE_AVAILABLE = True
except ImportError:
    PIPELINE_AVAILABLE = False
    VoiceTreePipeline = None
    run_voicetree_pipeline = None

# Infrastructure components - always try to import
try:
    from .infrastructure import (
        call_llm,
        call_llm_structured,
        VoiceTreeStateManager,
    )
    INFRASTRUCTURE_AVAILABLE = True
except ImportError:
    INFRASTRUCTURE_AVAILABLE = False
    call_llm = None
    call_llm_structured = None
    VoiceTreeStateManager = None

# Export main components
__all__ = [
    # Main Pipeline
    "VoiceTreePipeline", 
    "run_voicetree_pipeline",
    
    # Infrastructure
    "call_llm",
    "call_llm_structured", 
    "VoiceTreeStateManager",
    
    # Status flags
    "PIPELINE_AVAILABLE",
    "INFRASTRUCTURE_AVAILABLE",
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