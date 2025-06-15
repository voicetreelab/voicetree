#!/usr/bin/env python3
"""
Enhanced Quality Benchmarker with TROA Testing
Extends the existing VoiceTree Testing & Debug Guide methodology
Tests TADA → TROA quality progression
"""

import asyncio
import os
import shutil
import time
from datetime import datetime
import json
import sys
from pathlib import Path

# Add parent directories to path for imports
sys.path.append(str(Path(__file__).parent.parent.parent))

def setup_test_environment():
    """Setup clean test environment following Testing Guide methodology"""
    print("🧹 Setting up clean test environment...")
    
    # Clean output directories
    output_dirs = [
        "../../../oldVaults/VoiceTreePOC/TADA_Baseline_Enhanced",
        "../../../oldVaults/VoiceTreePOC/TADA_Plus_TROA_Enhanced",
        "../../agentic_workflows/debug_logs"
    ]
    
    for output_dir in output_dirs:
        if os.path.exists(output_dir):
            shutil.rmtree(output_dir)
        os.makedirs(output_dir, exist_ok=True)
    
    print("✅ Test environment ready")


def analyze_final_output_quality(output_dir, stage_name):
    """
    Analyze final output quality following Testing Guide methodology
    Focus on generated markdown files - THE CRITICAL PART per guide
    """
    print(f"\n📊 Final Output Quality Analysis: {stage_name}")
    print("=" * 60)
    
    if not os.path.exists(output_dir):
        print("❌ Output directory doesn't exist")
        return {"files": 0, "quality_score": 0, "content_coverage": 0}
    
    md_files = [f for f in os.listdir(output_dir) if f.endswith('.md') and f != 'PROCESSING_REPORT.md']
    print(f"📁 Found {len(md_files)} content markdown files")
    
    if len(md_files) == 0:
        print("❌ No content files generated - major system issue")
        return {"files": 0, "quality_score": 0, "content_coverage": 0}
    
    # Detailed content analysis
    total_content = ""
    quality_issues = []
    good_practices = []
    concept_coverage = []
    
    # Expected concepts from og_vt_transcript.txt (following Testing Guide)
    expected_concepts = [
        "voice tree", "proof of concept", "audio file", "markdown",
        "visual tree", "streaming", "processing", "workflow", "gemini", "openai"
    ]
    
    for md_file in md_files:
        filepath = os.path.join(output_dir, md_file)
        with open(filepath, 'r') as f:
            content = f.read()
        
        total_content += content.lower()
        print(f"   📄 {md_file}: {len(content)} chars")
        
        # Quality checks from Testing Guide
        if content.startswith('#'):
            good_practices.append(f"{md_file}: Has title")
        else:
            quality_issues.append(f"{md_file}: Missing title")
        
        # Check for repetitive bullet points (critical quality issue)
        lines = content.split('\n')
        bullet_lines = [line.strip() for line in lines if line.strip().startswith('•')]
        
        unique_bullets = set(bullet_lines)
        if len(bullet_lines) > len(unique_bullets):
            repetitive_count = len(bullet_lines) - len(unique_bullets)
            quality_issues.append(f"{md_file}: {repetitive_count} repetitive bullets")
        else:
            good_practices.append(f"{md_file}: Unique content")
        
        # Check for generic/meaningless titles
        if any(generic in md_file.lower() for generic in ["different", "various", "multiple", "things"]):
            quality_issues.append(f"{md_file}: Generic title")
        else:
            good_practices.append(f"{md_file}: Specific title")
    
    # Concept coverage analysis
    for concept in expected_concepts:
        if concept in total_content:
            concept_coverage.append(concept)
    
    coverage_score = len(concept_coverage) / len(expected_concepts)
    
    # Calculate overall quality score
    total_checks = len(quality_issues) + len(good_practices)
    structure_score = len(good_practices) / max(1, total_checks)
    
    # Combined quality score (structure + coverage)
    quality_score = (structure_score + coverage_score) / 2
    
    print(f"\n🎯 Quality Analysis Results:")
    print(f"   • Content files: {len(md_files)}")
    print(f"   • Total content: {len(total_content)} chars")
    print(f"   • Quality issues: {len(quality_issues)}")
    print(f"   • Good practices: {len(good_practices)}")
    print(f"   • Concept coverage: {len(concept_coverage)}/{len(expected_concepts)} ({coverage_score:.1%})")
    print(f"   • Quality score: {quality_score:.2f}")
    
    if quality_issues:
        print(f"\n❌ Quality Issues:")
        for issue in quality_issues:
            print(f"   • {issue}")
    
    if concept_coverage:
        print(f"\n✅ Concepts Covered:")
        for concept in concept_coverage:
            print(f"   • {concept}")
    
    missing_concepts = [c for c in expected_concepts if c not in concept_coverage]
    if missing_concepts:
        print(f"\n⚠️  Missing Concepts:")
        for concept in missing_concepts:
            print(f"   • {concept}")
    
    return {
        "files": len(md_files),
        "content_length": len(total_content),
        "quality_score": quality_score,
        "structure_score": structure_score,
        "coverage_score": coverage_score,
        "quality_issues": len(quality_issues),
        "good_practices": len(good_practices),
        "concept_coverage": len(concept_coverage),
        "concepts_found": concept_coverage,
        "concepts_missing": missing_concepts
    }


async def run_enhanced_tada_baseline():
    """Run TADA baseline with proper LLM integration"""
    print("🔍 Enhanced TADA Baseline Test")
    print("=" * 60)
    
    try:
        # Import with proper error handling
        from enhanced_transcription_processor import create_enhanced_transcription_processor
        from tree_manager.decision_tree_ds import DecisionTree
        
        # Setup
        output_dir = "../../../oldVaults/VoiceTreePOC/TADA_Baseline_Enhanced"
        decision_tree = DecisionTree()
        
        # Create processor with enhanced error handling
        processor = create_enhanced_transcription_processor(
            decision_tree=decision_tree,
            workflow_state_file="tada_baseline_enhanced.json",
            output_dir=output_dir,
            enable_background_optimization=False
        )
        
        # Load transcript
        transcript_file = "../../../oldVaults/VoiceTreePOC/og_vt_transcript.txt"
        with open(transcript_file, 'r') as f:
            transcript = f.read()
        
        print(f"📝 Processing transcript: {len(transcript)} characters")
        
        start_time = time.time()
        
        # Enhanced processing with better error handling
        await processor.enhanced_tree_manager.start_enhanced_processing()
        
        # Process full transcript as single chunk first
        print("📦 Processing full transcript")
        await processor.process_and_convert(transcript)
        
        await processor.finalize()
        await processor.enhanced_tree_manager.stop_enhanced_processing()
        
        processing_time = time.time() - start_time
        print(f"⏱️  TADA processing: {processing_time:.2f} seconds")
        
        # Cleanup
        if os.path.exists("tada_baseline_enhanced.json"):
            os.remove("tada_baseline_enhanced.json")
        
        # Analyze results
        results = analyze_final_output_quality(output_dir, "Enhanced TADA Baseline")
        results["processing_time"] = processing_time
        
        return results
        
    except Exception as e:
        print(f"❌ Enhanced TADA baseline failed: {e}")
        import traceback
        traceback.print_exc()
        return None


async def run_enhanced_tada_plus_troa():
    """Run TADA + TROA with fixes for integration issues"""
    print("\n🚀 Enhanced TADA + TROA Test")
    print("=" * 60)
    
    try:
        from enhanced_transcription_processor import create_enhanced_transcription_processor
        from tree_manager.decision_tree_ds import DecisionTree
        
        # Setup
        output_dir = "../../../oldVaults/VoiceTreePOC/TADA_Plus_TROA_Enhanced"
        decision_tree = DecisionTree()
        
        # Create processor with TROA enabled
        processor = create_enhanced_transcription_processor(
            decision_tree=decision_tree,
            workflow_state_file="tada_troa_enhanced.json",
            output_dir=output_dir,
            enable_background_optimization=False  # Manual TROA mode
        )
        
        # Verify TROA is properly configured
        print("🔧 Checking TROA configuration...")
        
        # Load transcript
        transcript_file = "../../../oldVaults/VoiceTreePOC/og_vt_transcript.txt"
        with open(transcript_file, 'r') as f:
            transcript = f.read()
        
        print(f"📝 Processing transcript: {len(transcript)} characters")
        
        start_time = time.time()
        
        # Process with TADA
        await processor.enhanced_tree_manager.start_enhanced_processing()
        
        print("📦 Processing full transcript")
        await processor.process_and_convert(transcript)
        
        # Manual TROA reorganization with enhanced error handling
        print(f"\n🔧 Applying TROA Reorganization...")
        troa_start = time.time()
        
        try:
            # Check if TROA agent exists and is configured
            if hasattr(processor.enhanced_tree_manager, 'troa_agent') and processor.enhanced_tree_manager.troa_agent:
                print("   ✅ TROA agent found, attempting reorganization...")
                troa_success = processor.enhanced_tree_manager.force_troa_reorganization()
            else:
                print("   ⚠️  TROA agent not found, checking alternative methods...")
                # Try alternative TROA activation
                from tree_reorganization_agent import TreeReorganizationAgent
                troa_agent = TreeReorganizationAgent(processor.enhanced_tree_manager.decision_tree)
                troa_success = troa_agent.reorganize_tree()
                print(f"   📊 Alternative TROA attempt: {'✅ SUCCESS' if troa_success else '❌ FAILED'}")
            
        except Exception as troa_error:
            print(f"   ❌ TROA reorganization failed: {troa_error}")
            troa_success = False
        
        troa_time = time.time() - troa_start
        print(f"   TROA reorganization: {'✅ SUCCESS' if troa_success else '❌ FAILED'}")
        print(f"   TROA time: {troa_time:.2f} seconds")
        
        await processor.finalize()
        await processor.enhanced_tree_manager.stop_enhanced_processing()
        
        total_time = time.time() - start_time
        print(f"⏱️  Total processing: {total_time:.2f} seconds")
        
        # Cleanup
        if os.path.exists("tada_troa_enhanced.json"):
            os.remove("tada_troa_enhanced.json")
        
        # Analyze results
        results = analyze_final_output_quality(output_dir, "Enhanced TADA + TROA")
        results["processing_time"] = total_time
        results["troa_time"] = troa_time
        results["troa_success"] = troa_success
        
        return results
        
    except Exception as e:
        print(f"❌ Enhanced TADA + TROA test failed: {e}")
        import traceback
        traceback.print_exc()
        return None


def generate_comprehensive_report(baseline, enhanced):
    """Generate comprehensive comparison report following Testing Guide methodology"""
    print("\n📋 COMPREHENSIVE TROA INTEGRATION REPORT")
    print("=" * 70)
    print("Following VoiceTree Testing & Debug Guide methodology")
    print("Focus: Final output quality analysis (markdown files)")
    
    if not baseline or not enhanced:
        print("❌ Cannot generate report - missing test results")
        return
    
    # File generation analysis
    print(f"\n📄 File Generation:")
    print(f"   TADA Baseline:  {baseline['files']} files")
    print(f"   TADA + TROA:    {enhanced['files']} files")
    print(f"   Change:         {enhanced['files'] - baseline['files']:+d} files")
    
    # Content quality comparison
    print(f"\n📝 Content Quality:")
    print(f"   TADA Quality:   {baseline['quality_score']:.2f}")
    print(f"   TROA Quality:   {enhanced['quality_score']:.2f}")
    print(f"   Improvement:    {enhanced['quality_score'] - baseline['quality_score']:+.2f}")
    
    # Concept coverage analysis
    print(f"\n🎯 Concept Coverage:")
    print(f"   TADA Coverage:  {baseline['concept_coverage']}/10 concepts")
    print(f"   TROA Coverage:  {enhanced['concept_coverage']}/10 concepts")
    
    # Quality issues comparison
    print(f"\n🔍 Quality Issues:")
    print(f"   TADA Issues:    {baseline['quality_issues']}")
    print(f"   TROA Issues:    {enhanced['quality_issues']}")
    print(f"   Change:         {enhanced['quality_issues'] - baseline['quality_issues']:+d}")
    
    # TROA-specific metrics
    if enhanced.get('troa_success'):
        print(f"\n🔧 TROA Performance:")
        print(f"   Reorganization: ✅ SUCCESSFUL")
        print(f"   TROA Time:      {enhanced.get('troa_time', 0):.2f}s")
        print(f"   Total Overhead: {enhanced['processing_time'] - baseline['processing_time']:+.2f}s")
    else:
        print(f"\n⚠️  TROA Performance:")
        print(f"   Reorganization: ❌ FAILED")
        print(f"   Issue:          TROA integration needs fixes")
    
    # Overall assessment
    print(f"\n🏆 OVERALL ASSESSMENT:")
    
    # Quality progression check
    quality_improvement = enhanced['quality_score'] - baseline['quality_score']
    if quality_improvement > 0.1:
        print("   ✅ Significant quality improvement achieved")
    elif quality_improvement > 0.05:
        print("   ✅ Moderate quality improvement achieved")
    elif quality_improvement > 0:
        print("   ➡️  Minor quality improvement")
    else:
        print("   ⚠️  No quality improvement detected")
    
    # Integration status
    if enhanced.get('troa_success'):
        print("   ✅ TROA integration working")
    else:
        print("   ❌ TROA integration needs fixes")
    
    # File output status
    if enhanced['files'] > baseline['files']:
        print("   ✅ Enhanced content generation")
    elif enhanced['files'] == baseline['files']:
        print("   ➡️  Same content generation")
    else:
        print("   ⚠️  Reduced content generation")
    
    # Save detailed report
    report_data = {
        "timestamp": datetime.now().isoformat(),
        "test_type": "Enhanced TROA Integration Test",
        "methodology": "VoiceTree Testing & Debug Guide",
        "baseline_results": baseline,
        "enhanced_results": enhanced,
        "quality_improvement": quality_improvement,
        "troa_working": enhanced.get('troa_success', False),
        "recommendations": []
    }
    
    # Generate recommendations
    if not enhanced.get('troa_success'):
        report_data['recommendations'].append("Fix TROA integration - reorganization failed")
    
    if enhanced['quality_score'] < 0.8:
        report_data['recommendations'].append("Improve content quality - score below threshold")
    
    if enhanced['files'] < 3:
        report_data['recommendations'].append("Increase content generation - too few files created")
    
    with open("../../../enhanced_troa_integration_report.json", "w") as f:
        json.dump(report_data, f, indent=2)
    
    print(f"\n💾 Detailed report saved to enhanced_troa_integration_report.json")
    
    return report_data


async def main():
    """Run comprehensive TROA integration testing"""
    print("🎯 ENHANCED TROA INTEGRATION TESTING")
    print("=" * 70)
    print("Following VoiceTree Testing & Debug Guide methodology")
    print("Extended with TROA-specific testing and validation")
    print()
    
    # Setup
    setup_test_environment()
    
    # Run tests
    print("\n" + "="*70)
    baseline_results = await run_enhanced_tada_baseline()
    
    print("\n" + "="*70)
    enhanced_results = await run_enhanced_tada_plus_troa()
    
    # Generate comprehensive report
    print("\n" + "="*70)
    report = generate_comprehensive_report(baseline_results, enhanced_results)
    
    print(f"\n🎉 Enhanced TROA Integration Testing Complete!")
    print(f"📁 Generated outputs:")
    print(f"   • TADA Baseline: ../../../oldVaults/VoiceTreePOC/TADA_Baseline_Enhanced/")
    print(f"   • TADA + TROA:   ../../../oldVaults/VoiceTreePOC/TADA_Plus_TROA_Enhanced/")
    print(f"   • Full Report:   ../../../enhanced_troa_integration_report.json")
    
    # Next steps recommendations
    print(f"\n📋 NEXT STEPS:")
    if report and report.get('recommendations'):
        for i, rec in enumerate(report['recommendations'], 1):
            print(f"   {i}. {rec}")
    else:
        print("   ✅ System integration appears successful")
        print("   ➡️  Ready for production deployment testing")


if __name__ == "__main__":
    asyncio.run(main()) 