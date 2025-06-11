#!/usr/bin/env python3
"""
Simple test runner for VoiceTree LangGraph Pipeline
"""

from main import run_voicetree_pipeline

def main():
    print("🚀 Running VoiceTree LangGraph Pipeline")
    print("=" * 50)
    
    # Test input
    transcript = """
    Today I want to work on integrating LangGraph with my voice tree system. 
    I need to create a multi-stage pipeline that can process transcripts effectively.
    The system should segment the text, analyze relationships, make integration decisions, and extract new nodes.
    I'm particularly interested in how well this performs compared to the existing single-LLM approach.
    """
    
    # Existing nodes (simulate some existing knowledge graph nodes)
    existing_nodes = [
        "System Architecture",
        "LLM Integration", 
        "Knowledge Graphs",
        "Voice Processing",
        "Pipeline Design",
        "Performance Metrics"
    ]
    
    # Run the pipeline
    try:
        result = run_voicetree_pipeline(transcript, existing_nodes)
        
        if result.get("current_stage") == "complete":
            print("✅ Pipeline completed successfully!")
            print(f"📊 Found {len(result.get('chunks', []))} chunks")
            print(f"🔗 Created {len(result.get('new_nodes', []))} new nodes:")
            
            for i, node in enumerate(result.get('new_nodes', []), 1):
                print(f"   {i}. {node}")
                
        else:
            print(f"❌ Pipeline failed: {result.get('error_message', 'Unknown error')}")
            
    except Exception as e:
        print(f"❌ Error running pipeline: {str(e)}")

if __name__ == "__main__":
    main() 