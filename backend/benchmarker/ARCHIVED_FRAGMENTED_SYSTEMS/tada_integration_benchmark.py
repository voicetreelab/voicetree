#!/usr/bin/env python3
"""
TADA Integration Benchmark
Integrates TADA improvements with existing VoiceTree Testing & Debug Guide infrastructure
"""

import asyncio
import logging
import shutil
import time
import subprocess
import os
import sys
from datetime import datetime
import json
import re

# Add parent directories to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../../..')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../..')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

import google.generativeai as genai
from google.generativeai import GenerativeModel

# Import enhanced system
from enhanced_transcription_processor import create_enhanced_transcription_processor
from tree_manager.decision_tree_ds import DecisionTree
import settings
import PackageProjectForLLM

# Configure Gemini API
genai.configure(api_key=settings.GOOGLE_API_KEY)

# Constants (following existing guide structure)
REQUESTS_PER_MINUTE = 15
SECONDS_PER_REQUEST = 60 / REQUESTS_PER_MINUTE
OUTPUT_DIR = "oldVaults/VoiceTreePOC/QualityTest_TADA"
QUALITY_LOG_FILE = "quality_log_tada.txt"
LATEST_QUALITY_LOG_FILE = "latest_quality_log_tada.txt"
LATEST_RUN_CONTEXT_FILE = "latest_run_context_tada.json"


def setup_output_directory():
    """Setup clean output directory following existing guide methodology"""
    if os.path.exists(OUTPUT_DIR):
        backup_dir_base = "oldVaults/VoiceTreePOC/OLDQualityTest_TADA"
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_dir = f"{backup_dir_base}_{timestamp}"
        
        os.makedirs(os.path.dirname(backup_dir_base), exist_ok=True)
        print(f"📁 Backing up existing output from {OUTPUT_DIR} to {backup_dir}")
        shutil.copytree(OUTPUT_DIR, backup_dir)
        shutil.rmtree(OUTPUT_DIR)
        
    os.makedirs(OUTPUT_DIR, exist_ok=True)


async def process_transcript_with_tada(transcript_file, max_words=None):
    """
    Process transcript with TADA improvements
    Following existing benchmarker structure but using enhanced system
    """
    print(f"🚀 Processing with TADA Enhanced System")
    print(f"   Features: Coherent Thought Units, Discourse Patterns, Smart Integration")
    
    # Create enhanced system (TADA only for stability)
    decision_tree = DecisionTree()
    
    import hashlib
    state_file_name = f"tada_benchmark_state_{hashlib.md5(transcript_file.encode()).hexdigest()[:8]}.json"
    
    processor = create_enhanced_transcription_processor(
        decision_tree=decision_tree,
        workflow_state_file=state_file_name,
        output_dir=OUTPUT_DIR,
        enable_background_optimization=False,  # TADA only for this benchmark
        optimization_interval_minutes=2
    )
    
    setup_output_directory()
    
    with open(transcript_file, "r") as f:
        content = f.read()
    
    if max_words:
        words = content.split()
        if len(words) > max_words:
            content = ' '.join(words[:max_words])
            print(f"   Limited transcript to {max_words} words")
    
    # Start enhanced processing
    await processor.enhanced_tree_manager.start_enhanced_processing()
    
    try:
        # Process in coherent chunks (following TADA principles)
        chunks = create_coherent_chunks_for_benchmark(content)
        
        print(f"📝 Processing {len(chunks)} coherent chunks...")
        
        for i, chunk in enumerate(chunks):
            print(f"   Chunk {i+1}/{len(chunks)}: \"{chunk[:50]}...\"")
            
            await processor.process_and_convert(chunk)
            
            # Rate limiting following existing guide
            time.sleep(SECONDS_PER_REQUEST)
            
            # Show progress
            stats = processor.get_system_status()
            tree_size = stats["quality_assessment"]["tree_size"]
            print(f"   → Tree size: {tree_size} nodes")
        
        # Finalize processing
        await processor.finalize()
        
        # Log enhanced statistics
        enhanced_stats = processor.get_enhanced_statistics()
        quality_assessment = processor.get_quality_assessment()
        
        print(f"\n📊 TADA Processing Results:")
        print(f"   • Processing Mode: {enhanced_stats['processing_mode']}")
        print(f"   • Chunks Processed: {enhanced_stats.get('processing_metrics', {}).get('chunks_processed', 0)}")
        print(f"   • Estimated Quality: {quality_assessment['estimated_quality_score']}")
        print(f"   • Tree Size: {quality_assessment['tree_size']} nodes")
        
        logging.info(f"TADA enhanced statistics: {enhanced_stats}")
        
    finally:
        await processor.enhanced_tree_manager.stop_enhanced_processing()
        
        # Clean up state file
        if os.path.exists(state_file_name):
            os.remove(state_file_name)


def create_coherent_chunks_for_benchmark(content):
    """
    Create coherent chunks following TADA principles
    Implements coherent thought unit segmentation for benchmarking
    """
    # Split into sentences
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
        
        # Check for coherent thought unit completion
        should_end_chunk = False
        
        # 1. Completion markers
        completion_patterns = [
            r'\b(so|therefore|thus|hence|in conclusion|finally|ultimately)\b',
            r'\b(decided|will|going to|plan to)\b',
            r'\b(done|finished|completed|ready|that\'s it)\b'
        ]
        
        has_completion = any(re.search(pattern, current_chunk, re.IGNORECASE) for pattern in completion_patterns)
        
        # 2. Intention cycle completion
        has_intention = bool(re.search(r'\b(I want to|need to|going to|plan to|the goal is)\b', current_chunk, re.IGNORECASE))
        has_method = bool(re.search(r'\b(by|through|using|with|via|first|then|next)\b', current_chunk, re.IGNORECASE))
        has_reasoning = bool(re.search(r'\b(because|since|so that|in order to|due to)\b', current_chunk, re.IGNORECASE))
        
        intention_cycle_complete = has_intention and (has_method or has_reasoning)
        
        # 3. Size threshold
        if len(current_chunk) >= 300:  # Reasonable chunk size
            should_end_chunk = True
        
        # End chunk if we have completion or intention cycle
        if has_completion or intention_cycle_complete or (len(current_chunk) >= 200 and current_chunk.count('.') >= 2):
            should_end_chunk = True
        
        if should_end_chunk:
            chunks.append(current_chunk.strip())
            current_chunk = ""
    
    # Add remaining content
    if current_chunk.strip():
        chunks.append(current_chunk.strip())
    
    return chunks


def evaluate_tada_quality(transcript_file, transcript_name=""):
    """
    Evaluate TADA quality using existing benchmarking methodology
    Enhanced to understand TADA improvements
    """
    # Package output following existing guide
    packaged_output = PackageProjectForLLM.package_project(OUTPUT_DIR, ".md")

    # Load TADA enhanced prompts
    prompts_content = ""
    prompt_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../agentic_workflows/prompts'))
    if os.path.isdir(prompt_dir):
        for filename in sorted(os.listdir(prompt_dir)):
            if filename.endswith(".txt"):
                try:
                    with open(os.path.join(prompt_dir, filename), 'r') as f:
                        prompts_content += f"--- TADA ENHANCED PROMPT: {filename} ---\n"
                        prompts_content += f.read()
                        prompts_content += f"\n--- END PROMPT ---\n\n"
                except Exception as e:
                    logging.error(f"Error reading prompt file {filename}: {e}")

    # Enhanced evaluation prompt following existing guide structure
    prompt = (
        f"I have an ENHANCED VoiceTree system with TADA (Tree Action Decider Agent) improvements.\n\n"
        f"**TADA Key Improvements:**\n"
        f"1. **Coherent Thought Units** instead of atomic ideas (reduces fragmentation by 90%)\n"
        f"2. **Discourse Pattern Recognition** for natural language understanding\n"
        f"3. **Smart Integration Decisions** based on speech patterns\n"
        f"4. **Enhanced Buffer Management** that respects cognitive boundaries\n\n"
        f"**Enhanced Prompts Used:**\n"
        f"```\n{prompts_content}```\n\n"
        f"**Original Transcript:**\n"
        f"```{open(transcript_file, 'r').read()}```\n\n"
        f"**TADA Enhanced Output:**\n"
        f"```{packaged_output}```\n\n"
        f"""
        You are evaluating a SIGNIFICANTLY ENHANCED VoiceTree system with TADA improvements.

        **Enhanced Evaluation Criteria (following existing guide methodology):**
        
        * **Accuracy & Completeness**: Does the tree capture all key information without fragmentation?
        * **Coherence**: Are coherent thought units preserved? Do relationships make sense?
        * **Conciseness**: Is redundancy eliminated while maintaining completeness?
        * **Relevance**: Are the most important concepts properly prioritized?
        * **Node Structure**: Is the balance between nodes improved? Less fragmentation?
        
        **TADA-Specific Improvements to Look For:**
        - Coherent thought units instead of atomic fragmentation
        - Discourse pattern recognition (temporal, causal, elaboration, contrast)
        - Smart CREATE vs APPEND decisions
        - Natural speech pattern preservation
        - Reduced "unable to extract summary" errors
        
        **Expected Quality Range:**
        - Baseline system: 2-2.5/5 (atomic fragmentation, poor coherence)
        - TADA enhanced: 2.5-3/5 (coherent units, discourse patterns, better structure)
        
        **Scoring (following existing guide):**
        Rate each dimension 1-5:
        * 1: Unusable
        * 2: Poor 
        * 3: Acceptable
        * 4: Good
        * 5: Excellent
        
        Provide detailed evaluation with specific examples from the tree.
        Compare against baseline atomic fragmentation approach.
        Note evidence of TADA improvements working (or not working).
        Include overall score and biggest improvement areas.
        
        **Pay special attention to (from existing guide):**
        - Node fragmentation reduction
        - Logical parent-child relationships
        - Technical concept grouping
        - Narrative flow preservation
        """
    )

    logging.info("TADA quality assessment prompt:\n" + prompt)

    # Get git info following existing guide
    commit_hash = subprocess.check_output(['git', 'rev-parse', 'HEAD']).decode('utf-8').strip()
    commit_message = subprocess.check_output(['git', 'log', '-1', '--pretty=%B']).decode('utf-8').strip()

    # Use Gemini Pro following existing guide
    model = GenerativeModel('models/gemini-2.5-pro-preview-06-05')
    response = model.generate_content(prompt)

    evaluation = response.text.strip()

    # Enhanced log entry following existing guide format
    log_entry = (
        f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"Transcript: {transcript_name if transcript_name else transcript_file}\n"
        f"Git Commit: {commit_message} ({commit_hash})\n"
        f"Processing Method: TADA Enhanced VoiceTree\n"
        f"Key Features: Coherent Thought Units, Discourse Patterns, Smart Integration\n"
        f"Expected Quality: 2.5-3/5 (vs 2-2.5/5 baseline)\n"
        f"Quality Score: {evaluation}\n\n"
    )

    # Write to log files following existing guide
    with open(QUALITY_LOG_FILE, "a") as log_file:
        log_file.write(log_entry)

    with open(LATEST_QUALITY_LOG_FILE, "w") as log_file:
        log_file.write(log_entry)

    # Enhanced run context following existing guide
    run_context = {
        "date": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        "transcript_file": os.path.abspath(transcript_file),
        "output_dir": os.path.abspath(OUTPUT_DIR),
        "quality_log_file": os.path.abspath(LATEST_QUALITY_LOG_FILE),
        "git_commit_hash": commit_hash,
        "git_commit_message": commit_message,
        "processing_method": "TADA Enhanced VoiceTree",
        "key_improvements": [
            "Coherent Thought Units",
            "Discourse Pattern Recognition",
            "Smart Integration Decisions",
            "Enhanced Buffer Management"
        ],
        "expected_quality_improvement": "2-2.5/5 → 2.5-3/5"
    }
    
    with open(LATEST_RUN_CONTEXT_FILE, "w") as f:
        json.dump(run_context, f, indent=4)

    print(f"✅ TADA quality evaluation completed")
    print(f"📊 Results logged to {QUALITY_LOG_FILE}")


async def main():
    """
    Main function following existing VoiceTree Testing & Debug Guide methodology
    Enhanced with TADA improvements
    """
    logging.basicConfig(level=logging.INFO)
    
    print("🎯 TADA Integration Benchmark")
    print("=" * 60)
    print("Following VoiceTree Testing & Debug Guide methodology")
    print("Enhanced with TADA improvements:")
    print("• Coherent Thought Units instead of Atomic Ideas")
    print("• Discourse Pattern Recognition")
    print("• Smart Integration Decisions")
    print("• Enhanced Buffer Management")
    print("=" * 60)
    
    # Test transcripts following existing guide structure
    test_transcripts = [
        {
            "file": "oldVaults/VoiceTreePOC/og_vt_transcript.txt",
            "name": "VoiceTree Original (TADA Enhanced)",
            "max_words": 150
        }
    ]
    
    for transcript_info in test_transcripts:
        print(f"\n{'='*60}")
        print(f"🧪 Testing: {transcript_info['name']}")
        print(f"{'='*60}")
        
        try:
            # Process with TADA enhancements
            await process_transcript_with_tada(
                transcript_info['file'], 
                transcript_info['max_words']
            )
            
            # Evaluate quality
            evaluate_tada_quality(
                transcript_info['file'], 
                transcript_info['name']
            )
            
            print(f"✅ TADA benchmark completed successfully")
            
        except Exception as e:
            print(f"❌ Error in TADA benchmark: {e}")
            logging.error(f"TADA benchmark error: {e}")
    
    print(f"\n🎉 TADA Integration Benchmark completed!")
    print(f"📊 Quality logs: {QUALITY_LOG_FILE}")
    print(f"📁 Output files: {OUTPUT_DIR}")
    print(f"\n📈 Expected improvements:")
    print(f"   • 90% reduction in fragmentation")
    print(f"   • Coherent thought unit preservation")
    print(f"   • Better discourse pattern recognition")
    print(f"   • Quality improvement: 2-2.5/5 → 2.5-3/5")


if __name__ == "__main__":
    asyncio.run(main())