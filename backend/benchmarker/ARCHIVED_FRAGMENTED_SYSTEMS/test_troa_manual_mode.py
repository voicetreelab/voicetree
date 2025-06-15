#!/usr/bin/env python3
"""
TROA Manual Mode Test
Following VoiceTree Testing & Debug Guide methodology
Tests TADA → TROA quality progression
"""

import asyncio
import os
import shutil
import time
from datetime import datetime
import json

def analyze_tree_structure(output_dir, stage_name):
    """Analyze tree structure following Testing Guide methodology"""
    print(f"\n📊 Tree Structure Analysis: {stage_name}")
    print("=" * 50)
    
    if not os.path.exists(output_dir):
        print("❌ Output directory doesn't exist")
        return {"files": 0, "quality_score": 0}
    
    md_files = [f for f in os.listdir(output_dir) if f.endswith('.md')]
    print(f"📁 Found {len(md_files)} markdown files")
    
    total_content = ""
    quality_issues = []
    good_practices = []
    
    for md_file in md_files:
        filepath = os.path.join(output_dir, md_file)
        with open(filepath, 'r') as f:
            content = f.read()
        
        total_content += content
        print(f"   📄 {md_file}: {len(content)} chars")
        
        # Quality checks from Testing Guide
        if content.startswith('#'):
            good_practices.append(f"{md_file}: Has title")
        else:
            quality_issues.append(f"{md_file}: Missing title")
        
        # Check for repetitive bullet points (critical quality issue)
        lines = content.split('\n')
        bullet_lines = [line.strip() for line in lines if line.strip().startswith('•')]
        
        repetitive_bullets = []
        for bullet in bullet_lines:
            if bullet_lines.count(bullet) > 1:
                repetitive_bullets.append(bullet)
        
        if repetitive_bullets:
            quality_issues.append(f"{md_file}: {len(repetitive_bullets)} repetitive bullets")
        else:
            good_practices.append(f"{md_file}: Unique content")
    
    # Calculate quality score
    total_checks = len(quality_issues) + len(good_practices)
    quality_score = len(good_practices) / max(1, total_checks)
    
    print(f"\n🎯 Quality Summary:")
    print(f"   • Files: {len(md_files)}")
    print(f"   • Total content: {len(total_content)} chars")
    print(f"   • Quality issues: {len(quality_issues)}")
    print(f"   • Good practices: {len(good_practices)}")
    print(f"   • Quality score: {quality_score:.2f}")
    
    if quality_issues:
        print(f"\n❌ Quality Issues:")
        for issue in quality_issues:
            print(f"   • {issue}")
    
    return {
        "files": len(md_files),
        "content_length": len(total_content),
        "quality_score": quality_score,
        "quality_issues": len(quality_issues),
        "good_practices": len(good_practices)
    }


async def test_tada_baseline():
    """Test TADA-only processing (baseline)"""
    print("🔍 TADA Baseline Test (2.5-3/5 Quality)")
    print("=" * 60)
    
    from enhanced_transcription_processor import create_enhanced_transcription_processor
    from tree_manager.decision_tree_ds import DecisionTree
    
    # Setup
    output_dir = "../oldVaults/VoiceTreePOC/TADA_Baseline"
    if os.path.exists(output_dir):
        shutil.rmtree(output_dir)
    os.makedirs(output_dir, exist_ok=True)
    
    # Create TADA-only processor
    decision_tree = DecisionTree()
    processor = create_enhanced_transcription_processor(
        decision_tree=decision_tree,
        workflow_state_file="tada_baseline_state.json",
        output_dir=output_dir,
        enable_background_optimization=False  # TADA only
    )
    
    # Process transcript
    transcript_file = "../oldVaults/VoiceTreePOC/og_vt_transcript.txt"
    with open(transcript_file, 'r') as f:
        transcript = f.read()
    
    print(f"📝 Processing transcript: {len(transcript)} characters")
    
    start_time = time.time()
    
    try:
        await processor.enhanced_tree_manager.start_enhanced_processing()
        
        # Process in chunks
        chunks = create_test_chunks(transcript)
        print(f"📦 Created {len(chunks)} chunks")
        
        for i, chunk in enumerate(chunks):
            print(f"   Processing chunk {i+1}/{len(chunks)}")
            await processor.process_and_convert(chunk)
            time.sleep(0.1)
        
        await processor.finalize()
        await processor.enhanced_tree_manager.stop_enhanced_processing()
        
        processing_time = time.time() - start_time
        print(f"⏱️  TADA processing: {processing_time:.2f} seconds")
        
        # Clean up
        if os.path.exists("tada_baseline_state.json"):
            os.remove("tada_baseline_state.json")
        
        # Analyze results
        results = analyze_tree_structure(output_dir, "TADA Baseline")
        results["processing_time"] = processing_time
        
        return results
        
    except Exception as e:
        print(f"❌ TADA test failed: {e}")
        return None


async def test_tada_plus_troa():
    """Test TADA + Manual TROA processing (enhanced)"""
    print("\n🚀 TADA + Manual TROA Test (Target 5/5 Quality)")
    print("=" * 60)
    
    from enhanced_transcription_processor import create_enhanced_transcription_processor
    from tree_manager.decision_tree_ds import DecisionTree
    
    # Setup
    output_dir = "../oldVaults/VoiceTreePOC/TADA_Plus_TROA"
    if os.path.exists(output_dir):
        shutil.rmtree(output_dir)
    os.makedirs(output_dir, exist_ok=True)
    
    # Create enhanced processor with manual TROA
    decision_tree = DecisionTree()
    processor = create_enhanced_transcription_processor(
        decision_tree=decision_tree,
        workflow_state_file="tada_troa_state.json",
        output_dir=output_dir,
        enable_background_optimization=False  # Manual TROA mode
    )
    
    # Process transcript (same as baseline)
    transcript_file = "../oldVaults/VoiceTreePOC/og_vt_transcript.txt"
    with open(transcript_file, 'r') as f:
        transcript = f.read()
    
    print(f"📝 Processing transcript: {len(transcript)} characters")
    
    start_time = time.time()
    
    try:
        await processor.enhanced_tree_manager.start_enhanced_processing()
        
        # Process in chunks
        chunks = create_test_chunks(transcript)
        print(f"📦 Created {len(chunks)} chunks")
        
        for i, chunk in enumerate(chunks):
            print(f"   Processing chunk {i+1}/{len(chunks)}")
            await processor.process_and_convert(chunk)
            time.sleep(0.1)
        
        # CRITICAL: Manual TROA reorganization
        print(f"\n🔧 Applying TROA Reorganization...")
        troa_start = time.time()
        
        # Force manual TROA reorganization
        troa_success = processor.enhanced_tree_manager.force_troa_reorganization()
        
        troa_time = time.time() - troa_start
        print(f"   TROA reorganization: {'✅ SUCCESS' if troa_success else '❌ FAILED'}")
        print(f"   TROA time: {troa_time:.2f} seconds")
        
        await processor.finalize()
        await processor.enhanced_tree_manager.stop_enhanced_processing()
        
        total_time = time.time() - start_time
        print(f"⏱️  Total processing: {total_time:.2f} seconds")
        
        # Clean up
        if os.path.exists("tada_troa_state.json"):
            os.remove("tada_troa_state.json")
        
        # Analyze results
        results = analyze_tree_structure(output_dir, "TADA + TROA")
        results["processing_time"] = total_time
        results["troa_time"] = troa_time
        results["troa_success"] = troa_success
        
        # Get TROA metrics
        if hasattr(processor.enhanced_tree_manager, 'troa_agent') and processor.enhanced_tree_manager.troa_agent:
            troa_metrics = processor.enhanced_tree_manager.troa_agent.get_metrics()
            results["troa_metrics"] = troa_metrics
            print(f"\n📊 TROA Metrics:")
            print(f"   • Reorganizations: {troa_metrics['reorganizations_performed']}")
            print(f"   • Nodes merged: {troa_metrics['nodes_merged']}")
            print(f"   • Relationships optimized: {troa_metrics['relationships_optimized']}")
        
        return results
        
    except Exception as e:
        print(f"❌ TADA + TROA test failed: {e}")
        import traceback
        traceback.print_exc()
        return None


def create_test_chunks(content):
    """Create test chunks for processing"""
    import re
    
    # Simple chunking for testing
    sentences = re.split(r'[.!?]+', content)
    chunks = []
    current_chunk = ""
    
    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
        
        if current_chunk:
            current_chunk += ". " + sentence
        else:
            current_chunk = sentence
        
        # End chunk at reasonable size
        if len(current_chunk) >= 200:
            chunks.append(current_chunk.strip())
            current_chunk = ""
    
    if current_chunk.strip():
        chunks.append(current_chunk.strip())
    
    return chunks


def compare_results(baseline, enhanced):
    """Compare TADA vs TADA+TROA results following Testing Guide methodology"""
    print("\n🔍 COMPARATIVE ANALYSIS (Following Testing Guide)")
    print("=" * 60)
    
    if not baseline or not enhanced:
        print("❌ Cannot compare - missing results")
        return
    
    # File count comparison
    file_diff = enhanced["files"] - baseline["files"]
    print(f"📄 File Count:")
    print(f"   TADA Baseline:  {baseline['files']} files")
    print(f"   TADA + TROA:    {enhanced['files']} files")
    print(f"   Difference:     {file_diff:+d} files")
    
    # Content volume
    content_diff = enhanced["content_length"] - baseline["content_length"]
    content_pct = (content_diff / baseline["content_length"]) * 100 if baseline["content_length"] > 0 else 0
    print(f"\n📝 Content Volume:")
    print(f"   TADA Baseline:  {baseline['content_length']} chars")
    print(f"   TADA + TROA:    {enhanced['content_length']} chars")
    print(f"   Difference:     {content_diff:+d} chars ({content_pct:+.1f}%)")
    
    # Quality comparison
    quality_diff = enhanced["quality_score"] - baseline["quality_score"]
    print(f"\n🎯 Quality Score:")
    print(f"   TADA Baseline:  {baseline['quality_score']:.2f}")
    print(f"   TADA + TROA:    {enhanced['quality_score']:.2f}")
    print(f"   Improvement:    {quality_diff:+.2f}")
    
    # Quality issues
    issue_diff = enhanced["quality_issues"] - baseline["quality_issues"]
    print(f"\n🔍 Quality Issues:")
    print(f"   TADA Baseline:  {baseline['quality_issues']} issues")
    print(f"   TADA + TROA:    {enhanced['quality_issues']} issues")
    print(f"   Change:         {issue_diff:+d} issues")
    
    # Processing time
    time_diff = enhanced["processing_time"] - baseline["processing_time"]
    print(f"\n⏱️  Processing Time:")
    print(f"   TADA Baseline:  {baseline['processing_time']:.2f}s")
    print(f"   TADA + TROA:    {enhanced['processing_time']:.2f}s")
    print(f"   Overhead:       {time_diff:+.2f}s")
    
    if "troa_time" in enhanced:
        print(f"   TROA Time:      {enhanced['troa_time']:.2f}s")
    
    # Overall assessment
    print(f"\n🏆 OVERALL ASSESSMENT:")
    improvements = []
    regressions = []
    
    if quality_diff > 0.05:
        improvements.append(f"Quality improved by {quality_diff:.2f}")
    elif quality_diff < -0.05:
        regressions.append(f"Quality decreased by {abs(quality_diff):.2f}")
    
    if issue_diff < 0:
        improvements.append(f"Fewer quality issues ({abs(issue_diff)})")
    elif issue_diff > 0:
        regressions.append(f"More quality issues (+{issue_diff})")
    
    if time_diff < baseline["processing_time"] * 0.3:  # Less than 30% overhead
        improvements.append(f"Acceptable processing overhead ({time_diff:.2f}s)")
    else:
        regressions.append(f"High processing overhead ({time_diff:.2f}s)")
    
    if improvements:
        print("   ✅ Improvements:")
        for improvement in improvements:
            print(f"      • {improvement}")
    
    if regressions:
        print("   ❌ Concerns:")
        for regression in regressions:
            print(f"      • {regression}")
    
    if not improvements and not regressions:
        print("   ➡️  No significant changes detected")
    
    # Save detailed results
    comparison_data = {
        "timestamp": datetime.now().isoformat(),
        "baseline": baseline,
        "enhanced": enhanced,
        "improvements": improvements,
        "regressions": regressions
    }
    
    with open("../troa_comparison_results.json", "w") as f:
        json.dump(comparison_data, f, indent=2)
    
    print(f"\n💾 Detailed results saved to troa_comparison_results.json")


async def main():
    """Run complete TROA manual mode test"""
    print("🎯 TROA Manual Mode Validation")
    print("=" * 70)
    print("Following VoiceTree Testing & Debug Guide methodology")
    print("Testing quality progression: TADA (2.5-3/5) → TROA (5/5)")
    print()
    
    # Step 1: TADA Baseline
    baseline_results = await test_tada_baseline()
    
    # Step 2: TADA + Manual TROA
    enhanced_results = await test_tada_plus_troa()
    
    # Step 3: Comparative Analysis
    compare_results(baseline_results, enhanced_results)
    
    print(f"\n🎉 TROA Manual Mode Test Complete!")
    print(f"📁 Check generated files:")
    print(f"   • TADA Baseline: ../oldVaults/VoiceTreePOC/TADA_Baseline/")
    print(f"   • TADA + TROA:   ../oldVaults/VoiceTreePOC/TADA_Plus_TROA/")
    print(f"   • Comparison:    ../troa_comparison_results.json")


if __name__ == "__main__":
    asyncio.run(main()) 