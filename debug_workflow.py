#!/usr/bin/env python3
"""
Debug script to run the full VoiceTree workflow with detailed logging
Useful as a mini benchmark/test to quickly identify workflow issues
"""

import sys
import os
from pathlib import Path

# Add necessary paths
sys.path.insert(0, str(Path.cwd()))
sys.path.insert(0, str(Path.cwd() / "backend"))

def run_debug_workflow():
    """Run the VoiceTree workflow with debug logging enabled"""
    
    from backend.agentic_workflows.debug_logger import clear_debug_logs, create_debug_summary
    from backend.agentic_workflows.nodes import (
        segmentation_node,
        relationship_analysis_node, 
        integration_decision_node,
        node_extraction_node
    )
    
    # Clear any existing debug logs
    clear_debug_logs()
    
    # Read the actual transcript
    transcript_file = "oldVaults/VoiceTreePOC/og_vt_transcript.txt"
    with open(transcript_file, 'r') as f:
        transcript_text = f.read()
    
    print("🔍 STARTING DEBUG WORKFLOW")
    print(f"📄 Processing transcript: {transcript_file}")
    print(f"📊 Transcript length: {len(transcript_text)} characters")
    print("=" * 60)
    
    # Initialize state
    state = {
        "transcript_text": transcript_text,
        "existing_nodes": "No existing nodes in the graph yet.",
        "current_stage": "start"
    }
    
    print("\n🔵 STAGE 1: SEGMENTATION")
    print("-" * 30)
    state = segmentation_node(state)
    
    if state.get("current_stage") == "error":
        print(f"❌ Segmentation failed: {state.get('error_message')}")
        return
    
    chunks = state.get("chunks", [])
    print(f"✅ Segmentation complete: {len(chunks)} chunks")
    
    print("\n🔵 STAGE 2: RELATIONSHIP ANALYSIS")
    print("-" * 30)
    state = relationship_analysis_node(state)
    
    if state.get("current_stage") == "error":
        print(f"❌ Relationship analysis failed: {state.get('error_message')}")
        return
    
    analyzed_chunks = state.get("analyzed_chunks", [])
    print(f"✅ Relationship analysis complete: {len(analyzed_chunks)} analyzed chunks")
    
    print("\n🔵 STAGE 3: INTEGRATION DECISION")
    print("-" * 30)
    state = integration_decision_node(state)
    
    if state.get("current_stage") == "error":
        print(f"❌ Integration decision failed: {state.get('error_message')}")
        return
    
    integration_decisions = state.get("integration_decisions", [])
    print(f"✅ Integration decision complete: {len(integration_decisions)} decisions")
    
    print("\n🔵 STAGE 4: NODE EXTRACTION")
    print("-" * 30)
    state = node_extraction_node(state)
    
    if state.get("current_stage") == "error":
        print(f"❌ Node extraction failed: {state.get('error_message')}")
        return
    
    new_nodes = state.get("new_nodes", [])
    print(f"✅ Node extraction complete: {len(new_nodes)} new nodes")
    
    print("\n🎯 WORKFLOW COMPLETE")
    print("=" * 60)
    print(f"📊 Final Results:")
    print(f"   • Chunks: {len(chunks)}")
    print(f"   • Analyzed chunks: {len(analyzed_chunks)}")
    print(f"   • Integration decisions: {len(integration_decisions)}")
    print(f"   • New nodes: {len(new_nodes)}")
    
    print(f"\n📋 New Node Names:")
    for i, node_name in enumerate(new_nodes[:10], 1):  # Show first 10
        print(f"   {i}. {node_name}")
    if len(new_nodes) > 10:
        print(f"   ... and {len(new_nodes) - 10} more")
    
    # Create debug summary
    create_debug_summary()
    
    print(f"\n🔍 Debug logs created in: backend/agentic_workflows/debug_logs/")
    print("   Review the logs to find where content diverges from the original transcript.")
    
    # Quick analysis of where content diverges
    print("\n🔎 QUICK ISSUE ANALYSIS:")
    
    # Check if chunks contain VoiceTree content
    voicetree_keywords = ["voice", "tree", "proof", "concept", "audio", "flutter", "gemini"]
    chunk_relevance = any(any(keyword in chunk.get("text", "").lower() for keyword in voicetree_keywords) 
                         for chunk in chunks)
    
    # Check if final nodes contain VoiceTree content  
    node_relevance = any(any(keyword in node.lower() for keyword in voicetree_keywords) 
                        for node in new_nodes)
    
    if chunk_relevance and not node_relevance:
        print("   ❌ CONFIRMED: Content diverges after segmentation")
        print("   📍 Issue likely in: Integration Decision or Node Extraction stage")
    elif chunk_relevance and node_relevance:
        print("   ✅ Content appears consistent throughout pipeline")
    else:
        print("   ⚠️  Issue may be in segmentation stage")

if __name__ == "__main__":
    run_debug_workflow() 