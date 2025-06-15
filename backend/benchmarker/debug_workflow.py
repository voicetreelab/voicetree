#!/usr/bin/env python3
"""
Debug logging utilities for VoiceTree workflow analysis
Provides detailed logging and analysis functions for workflow stages
"""

import sys
import os
import time
from pathlib import Path

# Add necessary paths
sys.path.insert(0, str(Path.cwd()))
sys.path.insert(0, str(Path.cwd() / "backend"))

def setup_debug_logging():
    """Setup debug logging for workflow analysis"""
    from backend.agentic_workflows.debug_logger import clear_debug_logs, create_debug_summary
    
    # Clear any existing debug logs
    clear_debug_logs()
    return create_debug_summary

def analyze_workflow_debug_logs():
    """
    Analyze debug logs following the Benchmarker_Agentic_feedback_loop_guide methodology
    Returns systematic analysis of each workflow stage
    """
    debug_logs_dir = "backend/agentic_workflows/debug_logs"
    
    if not os.path.exists(debug_logs_dir):
        return {"error": "No debug logs found"}
    
    analysis = {
        "timestamp": "debug_analysis_" + str(int(time.time())),
        "stages": {},
        "content_flow": {},
        "quality_issues": [],
        "recommendations": []
    }
    
    # Check each stage following our guide
    stages = [
        ("segmentation", "00_transcript_input.txt", "segmentation_debug.txt"),
        ("relationship_analysis", "relationship_analysis_debug.txt", None),
        ("integration_decision", "integration_decision_debug.txt", None),
        ("node_extraction", "node_extraction_debug.txt", None)
    ]
    
    for stage_name, input_file, output_file in stages:
        stage_analysis = analyze_stage_debug_logs(debug_logs_dir, stage_name, input_file, output_file)
        analysis["stages"][stage_name] = stage_analysis
    
    # Detect content pipeline losses (8 → 7 → 6 issue we found)
    pipeline_loss = detect_pipeline_content_loss(analysis["stages"])
    if pipeline_loss:
        analysis["quality_issues"].extend(pipeline_loss)
    
    return analysis

def analyze_stage_debug_logs(debug_dir: str, stage_name: str, input_file: str, output_file: str):
    """Analyze individual stage debug logs following guide methodology"""
    import time
    
    stage_analysis = {
        "stage": stage_name,
        "input_count": 0,
        "output_count": 0,
        "content_issues": [],
        "quality_score": 0
    }
    
    try:
        if input_file and os.path.exists(os.path.join(debug_dir, input_file)):
            with open(os.path.join(debug_dir, input_file), 'r') as f:
                input_content = f.read()
                # Count meaningful content units
                if stage_name == "segmentation":
                    # For transcript input, count concepts
                    stage_analysis["input_count"] = len([line for line in input_content.split('\n') if len(line.strip()) > 20])
                
        if output_file and os.path.exists(os.path.join(debug_dir, output_file)):
            with open(os.path.join(debug_dir, output_file), 'r') as f:
                output_content = f.read()
                # Extract output counts from debug format
                if "result_count:" in output_content:
                    import re
                    count_match = re.search(r'result_count:\s*(\d+)', output_content)
                    if count_match:
                        stage_analysis["output_count"] = int(count_match.group(1))
                
                # Check for quality issues specific to each stage
                stage_analysis["content_issues"] = check_stage_quality_issues(stage_name, output_content)
        
        # Calculate basic quality score (0-100)
        stage_analysis["quality_score"] = calculate_stage_quality_score(stage_name, stage_analysis)
        
    except Exception as e:
        stage_analysis["error"] = str(e)
    
    return stage_analysis

def check_stage_quality_issues(stage_name: str, content: str) -> list:
    """Check for quality issues specific to each stage (following our guide)"""
    issues = []
    
    if stage_name == "segmentation":
        # Check for content completeness and coherence
        if "chunks:" not in content.lower():
            issues.append("No chunks found in segmentation output")
        if "[TRUNCATED]" in content:
            issues.append("Content truncated in debug logs")
    
    elif stage_name == "integration_decision":
        # Check for repetitive bullet points and raw transcript copying
        if "action': 'CREATE'" in content:
            create_count = content.count("'action': 'CREATE'")
            append_count = content.count("'action': 'APPEND'")
            total_decisions = create_count + append_count
            if total_decisions > 0:
                create_ratio = create_count / total_decisions
                if create_ratio > 0.9:  # > 90% CREATE actions
                    issues.append(f"Over-fragmentation: {create_ratio:.1%} CREATE actions")
    
    elif stage_name == "node_extraction":
        # Check for generic node names
        if "new_nodes:" in content:
            # Extract node names and check for generic terms
            generic_terms = ["things", "different", "various", "multiple", "untitled"]
            for term in generic_terms:
                if term in content.lower():
                    issues.append(f"Generic node names detected: '{term}'")
    
    return issues

def calculate_stage_quality_score(stage_name: str, stage_analysis: dict) -> float:
    """Calculate quality score for individual stage (0-100)"""
    base_score = 80.0  # Start with good baseline
    
    # Deduct points for issues
    issue_penalty = len(stage_analysis["content_issues"]) * 15
    base_score -= issue_penalty
    
    # Deduct for pipeline losses
    input_count = stage_analysis.get("input_count", 0)
    output_count = stage_analysis.get("output_count", 0)
    
    if input_count > 0 and output_count > 0:
        retention_rate = output_count / input_count
        if retention_rate < 0.8:  # Lost > 20% of content
            base_score -= (1 - retention_rate) * 50
    
    return max(0, min(100, base_score))

def detect_pipeline_content_loss(stages_analysis: dict) -> list:
    """Detect content loss through pipeline (like our 8→7→6 issue)"""
    issues = []
    
    try:
        seg_count = stages_analysis.get("segmentation", {}).get("output_count", 0)
        int_count = stages_analysis.get("integration_decision", {}).get("output_count", 0) 
        ext_count = stages_analysis.get("node_extraction", {}).get("output_count", 0)
        
        if seg_count > int_count > 0:
            loss_pct = (seg_count - int_count) / seg_count
            if loss_pct > 0.1:  # > 10% loss
                issues.append(f"Content loss: Segmentation→Integration: {seg_count}→{int_count} ({loss_pct:.1%} loss)")
        
        if int_count > ext_count > 0:
            loss_pct = (int_count - ext_count) / int_count
            if loss_pct > 0.1:
                issues.append(f"Content loss: Integration→Extraction: {int_count}→{ext_count} ({loss_pct:.1%} loss)")
    
    except (KeyError, ZeroDivisionError):
        pass
    
    return issues

# Legacy function for backwards compatibility
def run_debug_workflow():
    """Legacy function - now redirects to unified benchmarker"""
    print("🔄 debug_workflow.py has been refactored!")
    print("📋 Debug functionality is now part of unified_voicetree_benchmarker.py")
    print("🚀 Run: python backend/benchmarker/unified_voicetree_benchmarker.py")
    print("")
    print("For manual debug analysis only:")
    print("python -c \"from backend.benchmarker.debug_workflow import analyze_workflow_debug_logs; print(analyze_workflow_debug_logs())\"")

if __name__ == "__main__":
    run_debug_workflow() 