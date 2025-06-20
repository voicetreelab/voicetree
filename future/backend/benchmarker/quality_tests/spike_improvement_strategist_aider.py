#!/usr/bin/env python3
"""
Enhanced Improvement Strategist using Aider AI Coding Agent

This module integrates Aider as a local AI coding agent to analyze the VoiceTree system
and provide structured improvement recommendations based on the comprehensive analysis guide.
"""

import os
import sys
import json
import asyncio
import subprocess
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List, Optional

# Add project root to Python path
project_root = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(project_root))

class AiderImprovementStrategist:
    """
    AI-powered improvement strategist using Aider for codebase analysis
    """
    
    def __init__(self, project_root: Optional[str] = None):
        self.project_root = Path(project_root) if project_root else Path(__file__).parent.parent.parent.parent
        self.analysis_guide_path = self.project_root / "backend/benchmarker/Benchmarker_Agentic_feedback_loop_guide.md"
        self.output_dir = self.project_root / "backend/benchmarker/quality_tests/aider_analysis"
        self.output_dir.mkdir(exist_ok=True)
        
        # Ensure Aider is available
        self._check_aider_installation()
    
    def _check_aider_installation(self):
        """Check if Aider is installed and install if needed"""
        try:
            subprocess.run(['aider', '--version'], capture_output=True, check=True)
            print("✅ Aider is available")
        except (subprocess.CalledProcessError, FileNotFoundError):
            print("📦 Installing Aider...")
            subprocess.run([sys.executable, '-m', 'pip', 'install', 'aider-chat'], check=True)
            print("✅ Aider installed successfully")
    
    def _prepare_analysis_context(self, quality_score: float, benchmark_logs: str, debug_logs: str) -> str:
        """
        Prepare comprehensive context for Aider analysis
        """
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        context = f"""
# VoiceTree System Analysis Request - {timestamp}

## Current Quality Score: {quality_score}/5.0
{"🚨 QUALITY ISSUE DETECTED - Score below 3.0 threshold" if quality_score <= 3.0 else "✅ Quality within acceptable range"}

## Analysis Objective
You are an AI coding assistant tasked with analyzing the VoiceTree voice-to-knowledge-graph system and providing actionable improvement recommendations. 

## Your Mission
1. **Analyze the codebase** in backend/agentic_workflows/ 
2. **Review benchmark results** and debug logs
3. **Follow the systematic analysis framework** from the guide
4. **Provide structured recommendations** with specific file changes

## Key Areas to Investigate
- Prompt effectiveness in backend/agentic_workflows/prompts/
- LLM integration reliability in llm_integration.py
- Node extraction accuracy in nodes.py
- Pipeline flow logic in graph.py
- State management in state.py

## Benchmark Results Context
{benchmark_logs}

## Debug Logs Context  
{debug_logs}

## Required Output Format
Please provide:
1. **Root Cause Analysis** - What's causing quality issues?
2. **Specific File Recommendations** - Which files need changes?
3. **Priority Ranking** - Most impactful changes first
4. **Implementation Plan** - Step-by-step improvement process

Follow the systematic framework from the analysis guide to ensure comprehensive coverage.
"""
        return context
    
    def _run_aider_analysis(self, context: str) -> str:
        """
        Run Aider analysis with the prepared context
        """
        print("🤖 Starting Aider AI analysis...")
        
        # Write context to a temporary file for Aider to process
        context_file = self.output_dir / "analysis_context.txt"
        with open(context_file, 'w') as f:
            f.write(context)
        
        # Prepare Aider command - use chat mode for analysis
        cmd = [
            'aider',
            '--model', 'gemini/gemini-2.0-flash-exp',  # Use your Gemini model
            '--no-auto-commits',  # Don't auto-commit changes
            '--yes',  # Auto-accept prompts
            '--chat-mode',  # Use chat mode for analysis
            str(self.project_root / "backend/agentic_workflows"),  # Target directory
        ]
        
        # Set environment variables
        env = os.environ.copy()
        if 'GOOGLE_API_KEY' not in env:
            raise ValueError("GOOGLE_API_KEY environment variable not set")
        
        try:
            # Run Aider analysis with input
            result = subprocess.run(
                cmd,
                cwd=str(self.project_root),
                env=env,
                input=context,  # Provide context as input
                capture_output=True,
                text=True,
                timeout=600  # 10 minute timeout
            )
            
            if result.returncode == 0:
                print("✅ Aider analysis completed successfully")
                return result.stdout
            else:
                print(f"❌ Aider analysis failed: {result.stderr}")
                return f"Analysis failed: {result.stderr}"
                
        except subprocess.TimeoutExpired:
            print("⏰ Aider analysis timed out")
            return "Analysis timed out after 10 minutes"
        except Exception as e:
            print(f"❌ Error running Aider: {e}")
            return f"Error: {str(e)}"
    
    def _parse_aider_output(self, aider_output: str) -> Dict[str, Any]:
        """
        Parse Aider's analysis output into structured recommendations
        """
        # Extract key sections from Aider's output
        recommendations = {
            "timestamp": datetime.now().isoformat(),
            "analysis_method": "Aider AI Coding Agent",
            "raw_output": aider_output,
            "structured_recommendations": [],
            "priority_issues": [],
            "implementation_plan": [],
            "files_to_modify": []
        }
        
        # Simple parsing - Aider typically provides structured output
        lines = aider_output.split('\n')
        current_section = None
        
        for line in lines:
            line = line.strip()
            if not line:
                continue
                
            # Identify sections
            if "root cause" in line.lower():
                current_section = "root_cause"
            elif "recommendation" in line.lower():
                current_section = "recommendations"
            elif "priority" in line.lower():
                current_section = "priority"
            elif "implementation" in line.lower():
                current_section = "implementation"
            elif line.startswith("backend/"):
                recommendations["files_to_modify"].append(line)
            
            # Add content to appropriate section
            if current_section and line:
                if current_section not in recommendations:
                    recommendations[current_section] = []
                recommendations[current_section].append(line)
        
        return recommendations
    
    def _save_analysis_results(self, recommendations: Dict[str, Any], quality_score: float):
        """
        Save analysis results to files
        """
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        # Save JSON results
        json_file = self.output_dir / f"aider_analysis_{timestamp}.json"
        with open(json_file, 'w') as f:
            json.dump(recommendations, f, indent=2)
        
        # Save markdown report
        md_file = self.output_dir / f"aider_improvement_report_{timestamp}.md"
        with open(md_file, 'w') as f:
            f.write(f"# VoiceTree Improvement Analysis - {timestamp}\n\n")
            f.write(f"**Quality Score:** {quality_score}/5.0\n")
            f.write(f"**Analysis Method:** Aider AI Coding Agent\n\n")
            
            if "root_cause" in recommendations:
                f.write("## Root Cause Analysis\n\n")
                for item in recommendations["root_cause"]:
                    f.write(f"- {item}\n")
                f.write("\n")
            
            if recommendations["files_to_modify"]:
                f.write("## Files Requiring Changes\n\n")
                for file in recommendations["files_to_modify"]:
                    f.write(f"- `{file}`\n")
                f.write("\n")
            
            f.write("## Detailed Analysis Output\n\n")
            f.write("```\n")
            f.write(recommendations["raw_output"])
            f.write("\n```\n")
        
        print(f"📊 Analysis results saved:")
        print(f"   • JSON: {json_file}")
        print(f"   • Report: {md_file}")
        
        return json_file, md_file
    
    async def analyze_and_improve(self, quality_score: float, benchmark_logs: str = "", debug_logs: str = "") -> Dict[str, Any]:
        """
        Main analysis method - uses Aider to analyze codebase and provide improvements
        """
        print(f"\n🔍 Starting Aider-powered improvement analysis...")
        print(f"📈 Current quality score: {quality_score}/5.0")
        
        # Prepare analysis context
        context = self._prepare_analysis_context(quality_score, benchmark_logs, debug_logs)
        
        # Run Aider analysis
        aider_output = self._run_aider_analysis(context)
        
        # Parse and structure results
        recommendations = self._parse_aider_output(aider_output)
        
        # Save results
        json_file, md_file = self._save_analysis_results(recommendations, quality_score)
        
        # Return structured recommendations
        return {
            "success": True,
            "quality_score": quality_score,
            "analysis_method": "Aider AI Coding Agent",
            "recommendations": recommendations,
            "output_files": {
                "json": str(json_file),
                "markdown": str(md_file)
            }
        }


def main():
    """
    Main entry point for Aider-powered improvement analysis
    """
    # Example usage
    strategist = AiderImprovementStrategist()
    
    # Simulate quality benchmarker results
    quality_score = 2.5  # Below threshold
    benchmark_logs = "Sample benchmark results..."
    debug_logs = "Sample debug logs..."
    
    # Run analysis
    try:
        result = asyncio.run(strategist.analyze_and_improve(quality_score, benchmark_logs, debug_logs))
        
        if result["success"]:
            print("\n✅ Aider improvement analysis completed successfully!")
            print(f"📄 Check results in: {result['output_files']['markdown']}")
        else:
            print("\n❌ Analysis failed")
            
    except Exception as e:
        print(f"\n❌ Error during analysis: {e}")
        return 1
    
    return 0


if __name__ == "__main__":
    exit(main()) 