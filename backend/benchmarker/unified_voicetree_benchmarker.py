#!/usr/bin/env python3
"""
Unified VoiceTree Benchmarker
Consolidates all fragmented benchmarking systems into one comprehensive tool

Features:
- TADA baseline testing
- TROA integration testing  
- Quality progression analysis (2.5-3/5 → 5/5)
- LLM quality assessment
- Debug log analysis
- Comparative analysis
- Following VoiceTree Testing & Debug Guide methodology

Replaces:
- quality_LLM_benchmarker.py
- enhanced_quality_benchmarker.py
- enhanced_quality_benchmarker_with_troa.py
- tada_integration_benchmark.py
- tada_vs_baseline_comparison.py
- improved_quality_benchmark.py
- test_benchmarker.py
- test_troa_manual_mode.py
"""

import asyncio
import os
import shutil
import time
import json
import subprocess
import logging
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import argparse

# Add parent directories to path
sys.path.append(str(Path(__file__).parent.parent))
sys.path.append(str(Path(__file__).parent.parent.parent))  # Add project root

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class UnifiedVoiceTreeBenchmarker:
    """
    Single, comprehensive benchmarking system for VoiceTree
    Consolidates all previous fragmented approaches
    """
    
    def __init__(self, config: Dict = None):
        self.config = config or self._get_default_config()
        self.results = {}
        self.test_start_time = time.time()
        
        # Setup directories
        self._setup_directories()
        
        # Import dependencies
        self._setup_imports()
    
    def _get_default_config(self) -> Dict:
        """Default configuration for benchmarking"""
        return {
            "test_modes": ["tada_baseline", "tada_troa", "quality_assessment"],
            "transcript_files": [
                {
                    "file": "../../oldVaults/VoiceTreePOC/og_vt_transcript.txt",
                    "name": "VoiceTree Original",
                    "max_words": None
                }
            ],
            "output_base_dir": "../../oldVaults/VoiceTreePOC",
            "enable_llm_quality_assessment": True,
            "enable_debug_analysis": True,
            "enable_comparative_analysis": True,
            "cleanup_temp_files": True,
            "rate_limit_seconds": 4.0,  # 15 RPM limit
            "expected_concepts": [
                "voice tree", "proof of concept", "audio file", "markdown",
                "visual tree", "streaming", "processing", "workflow", 
                "gemini", "openai", "continuous", "atomic"
            ]
        }
    
    def _setup_directories(self):
        """Setup clean test directories"""
        logger.info("🧹 Setting up clean test environment...")
        
        self.output_dirs = {
            "tada_baseline": f"{self.config['output_base_dir']}/UNIFIED_TADA_Baseline",
            "tada_troa": f"{self.config['output_base_dir']}/UNIFIED_TADA_TROA",
            "debug_logs": "backend/agentic_workflows/debug_logs",
            "reports": "unified_benchmark_reports"
        }
        
        # Clean and create directories
        for dir_name, dir_path in self.output_dirs.items():
            if os.path.exists(dir_path):
                shutil.rmtree(dir_path)
            os.makedirs(dir_path, exist_ok=True)
        
        logger.info("✅ Test environment ready")
    
    def _setup_imports(self):
        """Setup all necessary imports with error handling"""
        try:
            from enhanced_transcription_processor import create_enhanced_transcription_processor
            from tree_manager.decision_tree_ds import DecisionTree
            self.create_enhanced_transcription_processor = create_enhanced_transcription_processor
            self.DecisionTree = DecisionTree
            logger.info("✅ Core VoiceTree imports successful")
        except ImportError as e:
            logger.error(f"❌ Failed to import VoiceTree components: {e}")
            raise
        
        # Optional LLM imports
        try:
            import google.generativeai as genai
            from google.generativeai import GenerativeModel
            import settings
            genai.configure(api_key=settings.GOOGLE_API_KEY)
            self.genai_available = True
            logger.info("✅ Gemini API available for quality assessment")
        except (ImportError, AttributeError) as e:
            logger.warning(f"⚠️  Gemini API not available: {e}")
            self.genai_available = False
    
    async def run_tada_baseline_test(self, transcript_info: Dict) -> Dict:
        """Run TADA baseline test (2.5-3/5 quality target)"""
        logger.info("🔍 Running TADA Baseline Test")
        logger.info("=" * 60)
        
        try:
            # Setup
            output_dir = self.output_dirs["tada_baseline"]
            decision_tree = self.DecisionTree()
            
            processor = self.create_enhanced_transcription_processor(
                decision_tree=decision_tree,
                workflow_state_file="unified_tada_baseline.json",
                output_dir=output_dir,
                enable_background_optimization=False  # TADA only
            )
            
            # Load and process transcript
            with open(transcript_info["file"], 'r') as f:
                transcript = f.read()
            
            # Apply word limit if specified
            if transcript_info.get("max_words"):
                words = transcript.split()
                if len(words) > transcript_info["max_words"]:
                    transcript = ' '.join(words[:transcript_info["max_words"]])
                    logger.info(f"Limited transcript to {transcript_info['max_words']} words")
            
            logger.info(f"📝 Processing transcript: {len(transcript)} characters")
            
            start_time = time.time()
            
            # Process transcript
            await processor.enhanced_tree_manager.start_enhanced_processing()
            
            # Process in intelligent chunks
            chunks = self._create_intelligent_chunks(transcript)
            logger.info(f"📦 Created {len(chunks)} intelligent chunks")
            
            for i, chunk in enumerate(chunks):
                logger.info(f"   Processing chunk {i+1}/{len(chunks)}")
                await processor.process_and_convert(chunk)
                time.sleep(0.1)  # Brief pause between chunks
            
            await processor.finalize()
            await processor.enhanced_tree_manager.stop_enhanced_processing()
            
            processing_time = time.time() - start_time
            logger.info(f"⏱️  TADA processing: {processing_time:.2f} seconds")
            
            # Cleanup
            if os.path.exists("unified_tada_baseline.json"):
                os.remove("unified_tada_baseline.json")
            
            # Analyze results
            results = self._analyze_output_quality(output_dir, "TADA Baseline")
            results["processing_time"] = processing_time
            results["transcript_info"] = transcript_info
            
            return results
            
        except Exception as e:
            logger.error(f"❌ TADA baseline test failed: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    async def run_tada_troa_test(self, transcript_info: Dict) -> Dict:
        """Run TADA + TROA test (5/5 quality target)"""
        logger.info("🚀 Running TADA + TROA Test")
        logger.info("=" * 60)
        
        try:
            # Setup
            output_dir = self.output_dirs["tada_troa"]
            decision_tree = self.DecisionTree()
            
            processor = self.create_enhanced_transcription_processor(
                decision_tree=decision_tree,
                workflow_state_file="unified_tada_troa.json",
                output_dir=output_dir,
                enable_background_optimization=False  # Manual TROA mode
            )
            
            # Load and process transcript (same as baseline)
            with open(transcript_info["file"], 'r') as f:
                transcript = f.read()
            
            if transcript_info.get("max_words"):
                words = transcript.split()
                if len(words) > transcript_info["max_words"]:
                    transcript = ' '.join(words[:transcript_info["max_words"]])
            
            logger.info(f"📝 Processing transcript: {len(transcript)} characters")
            
            start_time = time.time()
            
            # Process with TADA
            await processor.enhanced_tree_manager.start_enhanced_processing()
            
            chunks = self._create_intelligent_chunks(transcript)
            logger.info(f"📦 Created {len(chunks)} intelligent chunks")
            
            for i, chunk in enumerate(chunks):
                logger.info(f"   Processing chunk {i+1}/{len(chunks)}")
                await processor.process_and_convert(chunk)
                time.sleep(0.1)
            
            # CRITICAL: Manual TROA reorganization
            logger.info(f"\n🔧 Applying TROA Reorganization...")
            troa_start = time.time()
            
            troa_success = False
            try:
                # Multiple TROA activation strategies
                if hasattr(processor.enhanced_tree_manager, 'troa_agent') and processor.enhanced_tree_manager.troa_agent:
                    logger.info("   ✅ TROA agent found, attempting reorganization...")
                    troa_success = processor.enhanced_tree_manager.force_troa_reorganization()
                else:
                    logger.info("   ⚠️  TROA agent not found, trying alternative activation...")
                    # Try direct TROA instantiation
                    from tree_reorganization_agent import TreeReorganizationAgent
                    troa_agent = TreeReorganizationAgent(processor.enhanced_tree_manager.decision_tree)
                    troa_success = troa_agent.reorganize_tree()
                    
                    # Update tree manager with reorganized tree
                    if troa_success:
                        processor.enhanced_tree_manager.decision_tree = troa_agent.decision_tree
                        # Regenerate markdown files
                        await processor.finalize()
                
            except Exception as troa_error:
                logger.error(f"   ❌ TROA reorganization failed: {troa_error}")
                troa_success = False
            
            troa_time = time.time() - troa_start
            logger.info(f"   TROA reorganization: {'✅ SUCCESS' if troa_success else '❌ FAILED'}")
            logger.info(f"   TROA time: {troa_time:.2f} seconds")
            
            await processor.finalize()
            await processor.enhanced_tree_manager.stop_enhanced_processing()
            
            total_time = time.time() - start_time
            logger.info(f"⏱️  Total processing: {total_time:.2f} seconds")
            
            # Cleanup
            if os.path.exists("unified_tada_troa.json"):
                os.remove("unified_tada_troa.json")
            
            # Analyze results
            results = self._analyze_output_quality(output_dir, "TADA + TROA")
            results["processing_time"] = total_time
            results["troa_time"] = troa_time
            results["troa_success"] = troa_success
            results["transcript_info"] = transcript_info
            
            # Get TROA metrics if available
            if troa_success and hasattr(processor.enhanced_tree_manager, 'troa_agent'):
                try:
                    troa_metrics = processor.enhanced_tree_manager.troa_agent.get_metrics()
                    results["troa_metrics"] = troa_metrics
                    logger.info(f"\n📊 TROA Metrics:")
                    logger.info(f"   • Reorganizations: {troa_metrics.get('reorganizations_performed', 0)}")
                    logger.info(f"   • Nodes merged: {troa_metrics.get('nodes_merged', 0)}")
                    logger.info(f"   • Relationships optimized: {troa_metrics.get('relationships_optimized', 0)}")
                except Exception as e:
                    logger.warning(f"Could not get TROA metrics: {e}")
            
            return results
            
        except Exception as e:
            logger.error(f"❌ TADA + TROA test failed: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def _create_intelligent_chunks(self, content: str) -> List[str]:
        """Create intelligent chunks based on semantic boundaries"""
        import re
        
        # Split on sentence boundaries but maintain context
        sentences = re.split(r'[.!?]+', content)
        chunks = []
        current_chunk = ""
        
        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue
            
            # Add sentence to current chunk
            if current_chunk:
                current_chunk += ". " + sentence
            else:
                current_chunk = sentence
            
            # Create chunk when we have enough content or complete thoughts
            if len(current_chunk) >= 300 or self._is_complete_thought(current_chunk):
                chunks.append(current_chunk.strip())
                current_chunk = ""
        
        # Add remaining content
        if current_chunk.strip():
            chunks.append(current_chunk.strip())
        
        return chunks
    
    def _is_complete_thought(self, text: str) -> bool:
        """Determine if text represents a complete thought"""
        # Simple heuristics for complete thoughts
        complete_indicators = [
            "so", "therefore", "then", "next", "finally", 
            "first", "second", "third", "also", "however"
        ]
        
        words = text.lower().split()
        return any(indicator in words for indicator in complete_indicators)
    
    def _analyze_output_quality(self, output_dir: str, stage_name: str) -> Dict:
        """
        Comprehensive output quality analysis
        Following VoiceTree Testing & Debug Guide methodology
        """
        logger.info(f"\n📊 Output Quality Analysis: {stage_name}")
        logger.info("=" * 60)
        
        if not os.path.exists(output_dir):
            logger.error("❌ Output directory doesn't exist")
            return {"files": 0, "quality_score": 0, "content_coverage": 0}
        
        # Get content files (exclude processing reports)
        all_files = os.listdir(output_dir)
        md_files = [f for f in all_files if f.endswith('.md') and not f.startswith('PROCESSING_REPORT')]
        
        logger.info(f"📁 Found {len(md_files)} content markdown files")
        logger.info(f"📄 All files: {all_files}")
        
        if len(md_files) == 0:
            logger.warning("⚠️  No content files generated - checking for processing issues")
            # Check for processing report
            processing_files = [f for f in all_files if 'PROCESSING' in f.upper()]
            if processing_files:
                logger.info(f"📋 Found processing files: {processing_files}")
            return {"files": 0, "quality_score": 0, "content_coverage": 0}
        
        # Analyze each file
        total_content = ""
        quality_issues = []
        good_practices = []
        concept_coverage = []
        file_details = []
        
        for md_file in md_files:
            filepath = os.path.join(output_dir, md_file)
            with open(filepath, 'r') as f:
                content = f.read()
            
            file_info = {
                "name": md_file,
                "size": len(content),
                "content": content
            }
            file_details.append(file_info)
            
            total_content += content.lower()
            logger.info(f"   📄 {md_file}: {len(content)} chars")
            
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
            generic_terms = ["different", "various", "multiple", "things", "untitled"]
            if any(generic in md_file.lower() for generic in generic_terms):
                quality_issues.append(f"{md_file}: Generic title")
            else:
                good_practices.append(f"{md_file}: Specific title")
        
        # Concept coverage analysis
        for concept in self.config["expected_concepts"]:
            if concept in total_content:
                concept_coverage.append(concept)
        
        coverage_score = len(concept_coverage) / len(self.config["expected_concepts"])
        
        # Calculate quality scores
        total_checks = len(quality_issues) + len(good_practices)
        structure_score = len(good_practices) / max(1, total_checks)
        quality_score = (structure_score + coverage_score) / 2
        
        # Log results
        logger.info(f"\n🎯 Quality Analysis Results:")
        logger.info(f"   • Content files: {len(md_files)}")
        logger.info(f"   • Total content: {len(total_content)} chars")
        logger.info(f"   • Quality issues: {len(quality_issues)}")
        logger.info(f"   • Good practices: {len(good_practices)}")
        logger.info(f"   • Concept coverage: {len(concept_coverage)}/{len(self.config['expected_concepts'])} ({coverage_score:.1%})")
        logger.info(f"   • Quality score: {quality_score:.2f}")
        
        if quality_issues:
            logger.info(f"\n❌ Quality Issues:")
            for issue in quality_issues:
                logger.info(f"   • {issue}")
        
        if concept_coverage:
            logger.info(f"\n✅ Concepts Covered:")
            for concept in concept_coverage:
                logger.info(f"   • {concept}")
        
        missing_concepts = [c for c in self.config["expected_concepts"] if c not in concept_coverage]
        if missing_concepts:
            logger.info(f"\n⚠️  Missing Concepts:")
            for concept in missing_concepts:
                logger.info(f"   • {concept}")
        
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
            "concepts_missing": missing_concepts,
            "file_details": file_details,
            "quality_issues_list": quality_issues,
            "good_practices_list": good_practices
        }
    
    async def run_llm_quality_assessment(self, baseline_results: Dict, enhanced_results: Dict, transcript_info: Dict) -> Dict:
        """Run LLM-based quality assessment (consolidates quality_LLM_benchmarker.py)"""
        if not self.genai_available:
            logger.warning("⚠️  Skipping LLM quality assessment - Gemini API not available")
            return {"llm_assessment": "Skipped - API not available"}
        
        logger.info("🤖 Running LLM Quality Assessment")
        logger.info("=" * 60)
        
        try:
            # Load transcript
            with open(transcript_info["file"], 'r') as f:
                transcript_content = f.read()
            
            # Package outputs
            baseline_output = self._package_markdown_output(self.output_dirs["tada_baseline"])
            enhanced_output = self._package_markdown_output(self.output_dirs["tada_troa"])
            
            # Create comprehensive evaluation prompt
            prompt = self._create_llm_evaluation_prompt(
                transcript_content, baseline_output, enhanced_output, 
                baseline_results, enhanced_results
            )
            
            # Get Git information
            try:
                commit_hash = subprocess.check_output(['git', 'rev-parse', 'HEAD']).decode('utf-8').strip()
                commit_message = subprocess.check_output(['git', 'log', '-1', '--pretty=%B']).decode('utf-8').strip()
            except:
                commit_hash = "unknown"
                commit_message = "unknown"
            
            # Call Gemini API
            from google.generativeai import GenerativeModel
            model = GenerativeModel('models/gemini-2.5-pro-preview-06-05')
            response = model.generate_content(prompt)
            
            evaluation = response.text.strip()
            
            # Create comprehensive log entry
            log_entry = {
                "timestamp": datetime.now().isoformat(),
                "transcript": transcript_info["name"],
                "git_commit": commit_message,
                "git_hash": commit_hash,
                "baseline_quality": baseline_results.get("quality_score", 0),
                "enhanced_quality": enhanced_results.get("quality_score", 0),
                "troa_success": enhanced_results.get("troa_success", False),
                "llm_evaluation": evaluation,
                "processing_times": {
                    "baseline": baseline_results.get("processing_time", 0),
                    "enhanced": enhanced_results.get("processing_time", 0),
                    "troa": enhanced_results.get("troa_time", 0)
                }
            }
            
            # Save to quality log
            quality_log_file = os.path.join(self.output_dirs["reports"], "unified_quality_log.json")
            with open(quality_log_file, "w") as f:
                json.dump(log_entry, f, indent=2)
            
            logger.info("✅ LLM quality assessment completed")
            return log_entry
            
        except Exception as e:
            logger.error(f"❌ LLM quality assessment failed: {e}")
            return {"llm_assessment": f"Failed: {e}"}
    
    def _package_markdown_output(self, output_dir: str) -> str:
        """Package markdown files for LLM evaluation"""
        if not os.path.exists(output_dir):
            return "No output directory found"
        
        md_files = [f for f in os.listdir(output_dir) if f.endswith('.md')]
        packaged_content = ""
        
        for md_file in md_files:
            filepath = os.path.join(output_dir, md_file)
            with open(filepath, 'r') as f:
                content = f.read()
            
            packaged_content += f"--- FILE: {md_file} ---\n"
            packaged_content += content
            packaged_content += f"\n--- END FILE: {md_file} ---\n\n"
        
        return packaged_content
    
    def _create_llm_evaluation_prompt(self, transcript: str, baseline_output: str, 
                                    enhanced_output: str, baseline_results: Dict, 
                                    enhanced_results: Dict) -> str:
        """Create comprehensive LLM evaluation prompt"""
        return f"""
I have a VoiceTree system that converts spoken transcripts into knowledge trees using a two-agent architecture:

1. **TADA (Tree Action Decider Agent)**: Real-time processing targeting 2.5-3/5 quality
2. **TROA (Tree Reorganization Agent)**: Background optimization targeting 5/5 quality

Please evaluate both outputs and assess the quality progression.

**Original Transcript:**
```
{transcript}
```

**TADA Baseline Output (Target: 2.5-3/5 quality):**
```
{baseline_output}
```

**TADA + TROA Enhanced Output (Target: 5/5 quality):**
```
{enhanced_output}
```

**System Metrics:**
- TADA Quality Score: {baseline_results.get('quality_score', 0):.2f}
- TROA Quality Score: {enhanced_results.get('quality_score', 0):.2f}
- TROA Success: {enhanced_results.get('troa_success', False)}
- Processing Time - TADA: {baseline_results.get('processing_time', 0):.2f}s
- Processing Time - TROA: {enhanced_results.get('processing_time', 0):.2f}s

**Evaluation Criteria:**
1. **Accuracy & Completeness**: Does the output capture all key information?
2. **Coherence**: Are the relationships logical and easy to follow?
3. **Conciseness**: Is there redundancy or repetitive content?
4. **Quality Progression**: Did TROA improve upon TADA's output?
5. **Technical Integration**: Did the two-agent system work as intended?

**Scoring**: Rate each dimension 1-5 where:
- 1: Unusable
- 2: Poor  
- 3: Acceptable
- 4: Good
- 5: Excellent

Please provide:
1. Detailed evaluation of both outputs
2. Specific examples of improvements (or lack thereof) from TADA to TROA
3. Assessment of whether the 2.5-3/5 → 5/5 quality progression was achieved
4. Overall system effectiveness score
5. Key recommendations for improvement

Focus particularly on whether TROA successfully optimized the tree structure, reduced redundancy, and improved content organization.
"""
    
    def generate_comprehensive_report(self, baseline_results: Dict, enhanced_results: Dict, 
                                    llm_assessment: Dict = None) -> Dict:
        """Generate comprehensive comparison report"""
        logger.info("\n📋 COMPREHENSIVE UNIFIED BENCHMARK REPORT")
        logger.info("=" * 70)
        logger.info("Consolidating all previous benchmarking approaches")
        
        if not baseline_results or not enhanced_results:
            logger.error("❌ Cannot generate report - missing test results")
            return {}
        
        # Calculate improvements
        quality_improvement = enhanced_results['quality_score'] - baseline_results['quality_score']
        file_change = enhanced_results['files'] - baseline_results['files']
        content_change = enhanced_results['content_length'] - baseline_results['content_length']
        issue_change = enhanced_results['quality_issues'] - baseline_results['quality_issues']
        
        # Performance analysis
        time_overhead = enhanced_results['processing_time'] - baseline_results['processing_time']
        troa_time = enhanced_results.get('troa_time', 0)
        
        # Log comprehensive results
        logger.info(f"\n📊 QUALITY PROGRESSION ANALYSIS:")
        logger.info(f"   TADA Baseline:  {baseline_results['quality_score']:.2f}")
        logger.info(f"   TADA + TROA:    {enhanced_results['quality_score']:.2f}")
        logger.info(f"   Improvement:    {quality_improvement:+.2f}")
        logger.info(f"   Target Met:     {'✅ YES' if enhanced_results['quality_score'] >= 0.8 else '❌ NO'}")
        
        logger.info(f"\n📄 CONTENT GENERATION:")
        logger.info(f"   File Change:    {file_change:+d} files")
        logger.info(f"   Content Change: {content_change:+d} chars")
        logger.info(f"   Issue Change:   {issue_change:+d} issues")
        
        logger.info(f"\n🔧 TROA PERFORMANCE:")
        logger.info(f"   TROA Success:   {'✅ YES' if enhanced_results.get('troa_success') else '❌ NO'}")
        logger.info(f"   TROA Time:      {troa_time:.2f}s")
        logger.info(f"   Total Overhead: {time_overhead:+.2f}s")
        
        logger.info(f"\n🎯 CONCEPT COVERAGE:")
        logger.info(f"   TADA Coverage:  {baseline_results['concept_coverage']}/{len(self.config['expected_concepts'])}")
        logger.info(f"   TROA Coverage:  {enhanced_results['concept_coverage']}/{len(self.config['expected_concepts'])}")
        
        # Overall assessment
        logger.info(f"\n🏆 OVERALL ASSESSMENT:")
        
        success_criteria = []
        failure_criteria = []
        
        if quality_improvement > 0.1:
            success_criteria.append("Significant quality improvement")
        elif quality_improvement > 0:
            success_criteria.append("Minor quality improvement")
        else:
            failure_criteria.append("No quality improvement")
        
        if enhanced_results.get('troa_success'):
            success_criteria.append("TROA integration working")
        else:
            failure_criteria.append("TROA integration failed")
        
        if enhanced_results['quality_score'] >= 0.8:
            success_criteria.append("Quality target achieved")
        else:
            failure_criteria.append("Quality target missed")
        
        if time_overhead < baseline_results['processing_time'] * 0.5:
            success_criteria.append("Acceptable performance overhead")
        else:
            failure_criteria.append("High performance overhead")
        
        if success_criteria:
            logger.info("   ✅ Successes:")
            for success in success_criteria:
                logger.info(f"      • {success}")
        
        if failure_criteria:
            logger.info("   ❌ Issues:")
            for failure in failure_criteria:
                logger.info(f"      • {failure}")
        
        # Create comprehensive report data
        report_data = {
            "timestamp": datetime.now().isoformat(),
            "test_duration": time.time() - self.test_start_time,
            "system_architecture": "TADA + TROA Two-Agent System",
            "methodology": "Unified VoiceTree Benchmarker",
            "baseline_results": baseline_results,
            "enhanced_results": enhanced_results,
            "llm_assessment": llm_assessment or {},
            "quality_progression": {
                "baseline_score": baseline_results['quality_score'],
                "enhanced_score": enhanced_results['quality_score'],
                "improvement": quality_improvement,
                "target_met": enhanced_results['quality_score'] >= 0.8
            },
            "troa_performance": {
                "success": enhanced_results.get('troa_success', False),
                "time": troa_time,
                "overhead": time_overhead
            },
            "success_criteria": success_criteria,
            "failure_criteria": failure_criteria,
            "recommendations": self._generate_recommendations(baseline_results, enhanced_results)
        }
        
        # Save comprehensive report
        report_file = os.path.join(self.output_dirs["reports"], "unified_benchmark_report.json")
        with open(report_file, "w") as f:
            json.dump(report_data, f, indent=2)
        
        logger.info(f"\n💾 Comprehensive report saved to: {report_file}")
        
        return report_data
    
    def _generate_recommendations(self, baseline_results: Dict, enhanced_results: Dict) -> List[str]:
        """Generate specific recommendations based on results"""
        recommendations = []
        
        if not enhanced_results.get('troa_success'):
            recommendations.append("Fix TROA integration - reorganization failed")
        
        if enhanced_results['quality_score'] < 0.8:
            recommendations.append("Improve content quality - score below 0.8 threshold")
        
        if enhanced_results['files'] < 3:
            recommendations.append("Increase content generation - too few files created")
        
        if enhanced_results['quality_issues'] > baseline_results['quality_issues']:
            recommendations.append("Address quality regressions introduced by TROA")
        
        if enhanced_results['concept_coverage'] < len(self.config['expected_concepts']) * 0.8:
            recommendations.append("Improve concept coverage - missing key topics")
        
        if enhanced_results.get('troa_time', 0) > 10:
            recommendations.append("Optimize TROA performance - reorganization too slow")
        
        return recommendations
    
    async def run_full_benchmark(self, test_modes: List[str] = None) -> Dict:
        """Run complete unified benchmark"""
        test_modes = test_modes or self.config["test_modes"]
        
        logger.info("🎯 UNIFIED VOICETREE BENCHMARK")
        logger.info("=" * 70)
        logger.info("Consolidating all fragmented benchmarking systems")
        logger.info(f"Test modes: {test_modes}")
        logger.info("")
        
        all_results = {}
        
        for transcript_info in self.config["transcript_files"]:
            logger.info(f"\n{'='*70}")
            logger.info(f"Testing: {transcript_info['name']}")
            logger.info(f"{'='*70}")
            
            transcript_results = {}
            
            # Run TADA baseline
            if "tada_baseline" in test_modes:
                baseline_results = await self.run_tada_baseline_test(transcript_info)
                transcript_results["baseline"] = baseline_results
            
            # Run TADA + TROA
            if "tada_troa" in test_modes:
                enhanced_results = await self.run_tada_troa_test(transcript_info)
                transcript_results["enhanced"] = enhanced_results
            
            # Run LLM quality assessment
            if "quality_assessment" in test_modes and self.genai_available:
                if transcript_results.get("baseline") and transcript_results.get("enhanced"):
                    llm_results = await self.run_llm_quality_assessment(
                        transcript_results["baseline"], 
                        transcript_results["enhanced"], 
                        transcript_info
                    )
                    transcript_results["llm_assessment"] = llm_results
            
            # Generate comprehensive report
            if transcript_results.get("baseline") and transcript_results.get("enhanced"):
                report = self.generate_comprehensive_report(
                    transcript_results["baseline"],
                    transcript_results["enhanced"],
                    transcript_results.get("llm_assessment", {})
                )
                transcript_results["report"] = report
            
            all_results[transcript_info["name"]] = transcript_results
        
        # Final summary
        logger.info(f"\n🎉 UNIFIED BENCHMARK COMPLETE!")
        logger.info(f"📁 Results saved to: {self.output_dirs['reports']}")
        logger.info(f"⏱️  Total time: {time.time() - self.test_start_time:.2f} seconds")
        
        return all_results


def main():
    """Main entry point with command line arguments"""
    parser = argparse.ArgumentParser(description="Unified VoiceTree Benchmarker")
    parser.add_argument("--modes", nargs="+", 
                       choices=["tada_baseline", "tada_troa", "quality_assessment"],
                       default=["tada_baseline", "tada_troa"],
                       help="Test modes to run")
    parser.add_argument("--transcript", type=str,
                       help="Path to transcript file")
    parser.add_argument("--max-words", type=int,
                       help="Limit transcript to max words")
    
    args = parser.parse_args()
    
    # Create config based on default, then override
    benchmarker = UnifiedVoiceTreeBenchmarker()
    config = benchmarker.config.copy()
    
    if args.transcript:
        config["transcript_files"] = [{
            "file": args.transcript,
            "name": os.path.basename(args.transcript),
            "max_words": args.max_words
        }]
    
    # Recreate benchmarker with updated config
    benchmarker = UnifiedVoiceTreeBenchmarker(config)
    results = asyncio.run(benchmarker.run_full_benchmark(args.modes))
    
    print("\n✅ Unified benchmarking complete!")
    print("This single tool replaces all previous fragmented benchmarking systems.")


if __name__ == "__main__":
    main() 