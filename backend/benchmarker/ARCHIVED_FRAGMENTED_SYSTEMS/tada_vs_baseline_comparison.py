#!/usr/bin/env python3
"""
TADA vs Baseline Comparison Test
Follows VoiceTree Testing & Debug Guide methodology
"""

import asyncio
import os
import sys
import time
import json
import shutil
from datetime import datetime
from pathlib import Path

# Add path for imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))

def create_baseline_test():
    """Create a baseline test using existing process_transcription.py"""
    
    print("🔍 BASELINE TEST (Existing System)")
    print("=" * 50)
    
    # Test with existing system
    import process_transcription
    
    transcript_file = "../../oldVaults/VoiceTreePOC/og_vt_transcript.txt"
    output_dir = "../../oldVaults/VoiceTreePOC/BaselineTest"
    
    # Clean output directory
    if os.path.exists(output_dir):
        shutil.rmtree(output_dir)
    os.makedirs(output_dir, exist_ok=True)
    
    # Initialize baseline processor
    processor = process_transcription.TranscriptionProcessor(
        output_dir=output_dir
    )
    
    # Read transcript
    with open(transcript_file, 'r') as f:
        transcript_content = f.read()
    
    print(f"📝 Processing transcript ({len(transcript_content)} chars)")
    print(f"   Preview: {transcript_content[:80]}...")
    
    start_time = time.time()
    
    try:
        # Process the transcript
        processor.process_transcribed_text(transcript_content)
        processor.finalize()
        
        processing_time = time.time() - start_time
        
        # Analyze output
        baseline_results = analyze_output_quality(output_dir, "Baseline System")
        baseline_results["processing_time"] = processing_time
        
        print(f"\n📊 Baseline Results:")
        print(f"   • Processing time: {processing_time:.2f}s")
        print(f"   • Files created: {baseline_results['file_count']}")
        print(f"   • Total content: {baseline_results['total_content_length']} chars")
        print(f"   • Average file size: {baseline_results['avg_file_size']:.0f} chars")
        
        return baseline_results
        
    except Exception as e:
        print(f"❌ Baseline test failed: {e}")
        return None


async def create_tada_test():
    """Create TADA test using enhanced system"""
    
    print("\n🚀 TADA TEST (Enhanced System)")  
    print("=" * 50)
    
    from enhanced_transcription_processor import create_enhanced_transcription_processor
    from tree_manager.decision_tree_ds import DecisionTree
    
    transcript_file = "../../oldVaults/VoiceTreePOC/og_vt_transcript.txt"
    output_dir = "../../oldVaults/VoiceTreePOC/TADATest"
    
    # Clean output directory
    if os.path.exists(output_dir):
        shutil.rmtree(output_dir)
    os.makedirs(output_dir, exist_ok=True)
    
    # Create enhanced processor (TADA only - no background TROA)
    decision_tree = DecisionTree()
    processor = create_enhanced_transcription_processor(
        decision_tree=decision_tree,
        workflow_state_file="tada_comparison_state.json",
        output_dir=output_dir,
        enable_background_optimization=False,  # TADA only for comparison
        optimization_interval_minutes=2
    )
    
    # Read transcript
    with open(transcript_file, 'r') as f:
        transcript_content = f.read()
    
    print(f"📝 Processing with TADA enhancements:")
    print(f"   • Coherent Thought Units ✅")
    print(f"   • Discourse Pattern Recognition ✅")
    print(f"   • Smart Integration Decisions ✅")
    print(f"   • Enhanced Buffer Management ✅")
    
    start_time = time.time()
    
    try:
        # Start enhanced processing
        await processor.enhanced_tree_manager.start_enhanced_processing()
        
        # Process coherent chunks
        chunks = create_coherent_chunks(transcript_content)
        print(f"   • Created {len(chunks)} coherent chunks")
        
        for i, chunk in enumerate(chunks):
            print(f"   Processing chunk {i+1}/{len(chunks)}: \"{chunk[:50]}...\"")
            await processor.process_and_convert(chunk)
            time.sleep(0.1)  # Small delay
        
        await processor.finalize()
        await processor.enhanced_tree_manager.stop_enhanced_processing()
        
        processing_time = time.time() - start_time
        
        # Analyze output
        tada_results = analyze_output_quality(output_dir, "TADA System")
        tada_results["processing_time"] = processing_time
        tada_results["chunks_processed"] = len(chunks)
        
        # Get enhanced metrics
        enhanced_stats = processor.get_enhanced_statistics()
        quality_assessment = processor.get_quality_assessment()
        
        print(f"\n📊 TADA Results:")
        print(f"   • Processing time: {processing_time:.2f}s")
        print(f"   • Chunks processed: {len(chunks)}")
        print(f"   • Files created: {tada_results['file_count']}")
        print(f"   • Total content: {tada_results['total_content_length']} chars")
        print(f"   • Average file size: {tada_results['avg_file_size']:.0f} chars")
        print(f"   • Estimated quality: {quality_assessment['estimated_quality_score']}")
        
        # Clean up state file
        if os.path.exists("tada_comparison_state.json"):
            os.remove("tada_comparison_state.json")
        
        return tada_results
        
    except Exception as e:
        print(f"❌ TADA test failed: {e}")
        import traceback
        traceback.print_exc()
        return None


def create_coherent_chunks(content):
    """Create coherent thought units for TADA processing"""
    import re
    
    # Split into sentences
    sentences = re.split(r'[.!?]+', content)
    chunks = []
    current_chunk = ""
    
    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
            
        # Add to current chunk
        if current_chunk:
            current_chunk += ". " + sentence
        else:
            current_chunk = sentence
        
        # Check for coherent completion
        has_completion = bool(re.search(r'\b(so|therefore|finally|okay|cool)\b', current_chunk, re.IGNORECASE))
        has_intention = bool(re.search(r'\b(I want|need to|going to|first thing)\b', current_chunk, re.IGNORECASE))
        has_method = bool(re.search(r'\b(by|using|to do|will|can)\b', current_chunk, re.IGNORECASE))
        
        # End chunk on completion or intention + method
        if has_completion or (has_intention and has_method) or len(current_chunk) >= 200:
            if current_chunk.strip():
                chunks.append(current_chunk.strip())
            current_chunk = ""
    
    # Add remaining content
    if current_chunk.strip():
        chunks.append(current_chunk.strip())
    
    return chunks


def analyze_output_quality(output_dir, system_name):
    """Analyze output quality following VoiceTree Testing & Debug Guide methodology"""
    
    results = {
        "system": system_name,
        "timestamp": datetime.now().isoformat(),
        "file_count": 0,
        "total_content_length": 0,
        "files": [],
        "quality_issues": [],
        "coherence_score": 0
    }
    
    if not os.path.exists(output_dir):
        return results
    
    # Analyze each markdown file
    md_files = [f for f in os.listdir(output_dir) if f.endswith('.md')]
    results["file_count"] = len(md_files)
    
    total_content = 0
    coherent_files = 0
    
    for md_file in md_files:
        filepath = os.path.join(output_dir, md_file)
        
        try:
            with open(filepath, 'r') as f:
                content = f.read()
            
            file_info = {
                "filename": md_file,
                "size": len(content),
                "has_title": bool(content.startswith('#')),
                "has_content": len(content.strip()) > 50,
                "bullet_points": content.count('•') + content.count('-'),
                "has_links": '_Links:' in content
            }
            
            results["files"].append(file_info)
            total_content += len(content)
            
            # Check for quality issues
            if not file_info["has_title"]:
                results["quality_issues"].append(f"{md_file}: No title")
            
            if not file_info["has_content"]:
                results["quality_issues"].append(f"{md_file}: Minimal content")
            
            # Check for repetitive content (quality issue)
            lines = content.split('\n')
            repeated_lines = []
            for line in lines:
                if line.strip() and lines.count(line) > 1:
                    repeated_lines.append(line.strip())
            
            if repeated_lines:
                results["quality_issues"].append(f"{md_file}: Repetitive content")
            else:
                coherent_files += 1
                
        except Exception as e:
            results["quality_issues"].append(f"{md_file}: Read error - {e}")
    
    results["total_content_length"] = total_content
    results["avg_file_size"] = total_content / max(1, len(md_files))
    results["coherence_score"] = coherent_files / max(1, len(md_files))
    
    return results


def compare_results(baseline_results, tada_results):
    """Compare baseline vs TADA results"""
    
    print("\n🔍 COMPARISON ANALYSIS")
    print("=" * 50)
    
    if not baseline_results or not tada_results:
        print("❌ Cannot compare - missing results")
        return
    
    # File count comparison
    file_diff = tada_results["file_count"] - baseline_results["file_count"]
    print(f"📄 File Count:")
    print(f"   Baseline: {baseline_results['file_count']} files")
    print(f"   TADA:     {tada_results['file_count']} files")
    print(f"   Change:   {file_diff:+d} files")
    
    # Content analysis
    content_diff = tada_results["total_content_length"] - baseline_results["total_content_length"]
    print(f"\n📝 Content Volume:")
    print(f"   Baseline: {baseline_results['total_content_length']} chars")
    print(f"   TADA:     {tada_results['total_content_length']} chars")
    print(f"   Change:   {content_diff:+d} chars ({content_diff/baseline_results['total_content_length']*100:+.1f}%)")
    
    # Quality analysis
    baseline_issues = len(baseline_results["quality_issues"])
    tada_issues = len(tada_results["quality_issues"])
    issue_diff = tada_issues - baseline_issues
    
    print(f"\n🔍 Quality Issues:")
    print(f"   Baseline: {baseline_issues} issues")
    print(f"   TADA:     {tada_issues} issues")
    print(f"   Change:   {issue_diff:+d} issues")
    
    # Coherence comparison
    baseline_coherence = baseline_results.get("coherence_score", 0)
    tada_coherence = tada_results.get("coherence_score", 0)
    coherence_diff = tada_coherence - baseline_coherence
    
    print(f"\n🎯 Coherence Score:")
    print(f"   Baseline: {baseline_coherence:.2f}")
    print(f"   TADA:     {tada_coherence:.2f}")
    print(f"   Change:   {coherence_diff:+.2f}")
    
    # Processing time
    time_diff = tada_results["processing_time"] - baseline_results["processing_time"]
    print(f"\n⏱️  Processing Time:")
    print(f"   Baseline: {baseline_results['processing_time']:.2f}s")
    print(f"   TADA:     {tada_results['processing_time']:.2f}s")
    print(f"   Change:   {time_diff:+.2f}s")
    
    # Overall assessment
    print(f"\n🏆 OVERALL ASSESSMENT:")
    
    improvements = []
    regressions = []
    
    if issue_diff < 0:
        improvements.append(f"Fewer quality issues ({-issue_diff})")
    elif issue_diff > 0:
        regressions.append(f"More quality issues (+{issue_diff})")
    
    if coherence_diff > 0.1:
        improvements.append(f"Better coherence (+{coherence_diff:.2f})")
    elif coherence_diff < -0.1:
        regressions.append(f"Worse coherence ({coherence_diff:.2f})")
    
    if content_diff > 0:
        improvements.append(f"More content generated (+{content_diff} chars)")
    
    if improvements:
        print("   ✅ Improvements:")
        for improvement in improvements:
            print(f"      • {improvement}")
    
    if regressions:
        print("   ❌ Regressions:")
        for regression in regressions:
            print(f"      • {regression}")
    
    if not improvements and not regressions:
        print("   ➡️  No significant changes detected")
    
    # Save detailed comparison
    comparison_data = {
        "timestamp": datetime.now().isoformat(),
        "baseline": baseline_results,
        "tada": tada_results,
        "improvements": improvements,
        "regressions": regressions
    }
    
    with open("../../comparison_results.json", "w") as f:
        json.dump(comparison_data, f, indent=2)
    
    print(f"\n💾 Detailed results saved to comparison_results.json")


async def main():
    """Run complete comparison test"""
    
    print("🎯 TADA vs Baseline Quality Comparison")
    print("=" * 60)
    print("Following VoiceTree Testing & Debug Guide methodology")
    print()
    
    # Run baseline test
    baseline_results = create_baseline_test()
    
    # Run TADA test  
    tada_results = await create_tada_test()
    
    # Compare results
    compare_results(baseline_results, tada_results)
    
    print(f"\n🎉 Comparison complete!")
    print(f"Check the generated markdown files in:")
    print(f"   • Baseline: ../../oldVaults/VoiceTreePOC/BaselineTest/")
    print(f"   • TADA:     ../../oldVaults/VoiceTreePOC/TADATest/")


if __name__ == "__main__":
    asyncio.run(main()) 